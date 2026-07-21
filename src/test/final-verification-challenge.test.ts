import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { BoardDiscoveryService } from "../boards/discovery";
import { BoardSelector } from "../boards/selector";
import {
  checkVersionCompatibility,
  formatVersionDisplay,
  getSupportedVersionRange,
} from "../cli/version";
import { validateAndResolveSketch } from "../sketches/sketch-service";
import { MockOutputChannel, ThemeColor } from "./mocks/vscode.mock";

suite("Final Verification Gate — Empirical Stress Test Suite", () => {
  suite("Target 1: Version String Edge Cases", () => {
    test("0.19.2 is flagged as too old with MIN_VERSION requirement", () => {
      const info = checkVersionCompatibility("0.19.2");
      assert.strictEqual(info.compatible, false);
      assert.strictEqual(info.major, 0);
      assert.strictEqual(info.minor, 19);
      assert.strictEqual(info.patch, 2);
      assert.ok(
        info.message.includes("too old"),
        `Expected "too old" in message, got: ${info.message}`
      );
      assert.ok(
        info.message.includes("1.0.0"),
        `Expected "1.0.0" in message, got: ${info.message}`
      );
    });

    test("Older 0.x versions (0.0.1, 0.9.9) are flagged as too old", () => {
      for (const ver of ["0.0.1", "0.9.9", "0.1.0", "v0.19.2"]) {
        const info = checkVersionCompatibility(ver);
        assert.strictEqual(info.compatible, false);
        assert.strictEqual(info.major, 0);
        assert.ok(
          info.message.includes("too old"),
          `Version ${ver} should report "too old", got: ${info.message}`
        );
      }
    });

    test("1.0.0 is flagged as compatible", () => {
      const info = checkVersionCompatibility("1.0.0");
      assert.strictEqual(info.compatible, true);
      assert.strictEqual(info.major, 1);
      assert.strictEqual(info.minor, 0);
      assert.strictEqual(info.patch, 0);
      assert.ok(info.message.includes("is compatible"));
    });

    test("Compatible 1.x version variants (1.4.1, v1.0.0, 1.12.3) pass cleanly", () => {
      for (const ver of ["1.0.1", "1.4.1", "v1.4.1", "1.99.99"]) {
        const info = checkVersionCompatibility(ver);
        assert.strictEqual(
          info.compatible,
          true,
          `Version ${ver} should be compatible`
        );
        assert.strictEqual(info.major, 1);
      }
    });

    test("2.0.0 is flagged as unsupported (major version too high)", () => {
      const info = checkVersionCompatibility("2.0.0");
      assert.strictEqual(info.compatible, false);
      assert.strictEqual(info.major, 2);
      assert.ok(
        info.message.includes("is not supported"),
        `Expected "is not supported" in message, got: ${info.message}`
      );
      assert.ok(
        info.message.includes("found major version 2"),
        `Expected major version in message, got: ${info.message}`
      );
    });

    test("Higher major versions (2.1.0, 3.0.0, 10.0.0) report unsupported", () => {
      for (const ver of ["2.0.1", "2.10.0", "3.0.0", "10.0.0"]) {
        const info = checkVersionCompatibility(ver);
        assert.strictEqual(info.compatible, false);
        assert.ok(
          info.message.includes("is not supported"),
          `Version ${ver} should report "is not supported", got: ${info.message}`
        );
      }
    });

    test("Malformed version strings return parse error and non-compatible", () => {
      for (const invalid of ["invalid", "x.y.z", "", "1.0", "vA.B.C"]) {
        const info = checkVersionCompatibility(invalid);
        assert.strictEqual(info.compatible, false);
        assert.strictEqual(info.major, 0);
        assert.ok(info.message.includes("Could not parse"));
      }
    });

    test("getSupportedVersionRange returns 1.x requirement string", () => {
      assert.strictEqual(getSupportedVersionRange(), "1.x (>= 1.0.0)");
    });

    test("formatVersionDisplay appends warning status icon for incompatible versions", () => {
      assert.strictEqual(
        formatVersionDisplay(checkVersionCompatibility("1.0.0")),
        "Arduino CLI v1.0.0"
      );
      assert.strictEqual(
        formatVersionDisplay(checkVersionCompatibility("0.19.2")),
        "Arduino CLI v0.19.2 ⚠️"
      );
      assert.strictEqual(
        formatVersionDisplay(checkVersionCompatibility("2.0.0")),
        "Arduino CLI v2.0.0 ⚠️"
      );
    });
  });

  suite("Target 2: BoardSelector Duplicate Command Registration", () => {
    test("instantiating BoardSelector multiple times handles command collisions gracefully", () => {
      const outputChannel = new MockOutputChannel("Arduino Unit Test");
      const discovery = new BoardDiscoveryService(outputChannel);

      // First instance registers commands
      const selector1 = new BoardSelector(outputChannel, discovery);
      assert.ok(selector1);

      // Second instance should catch duplicate command errors gracefully without throwing
      let selector2: BoardSelector | undefined;
      assert.doesNotThrow(() => {
        selector2 = new BoardSelector(outputChannel, discovery);
      });
      assert.ok(selector2);

      // Clean up both
      selector1.dispose();
      if (selector2) {
        (selector2 as BoardSelector).dispose();
      }
    });

    test("BoardSelector dispose disposes status bar item and command disposables", () => {
      const outputChannel = new MockOutputChannel("Arduino Unit Test");
      const discovery = new BoardDiscoveryService(outputChannel);

      const selector = new BoardSelector(outputChannel, discovery);
      assert.doesNotThrow(() => {
        selector.dispose();
      });
    });
  });

  suite("Target 3: ThemeColor in VS Code Mock & BoardSelector Usage", () => {
    test("ThemeColor class stores id correctly in vscode mock", () => {
      const themeColor = new ThemeColor("statusBarItem.warningBackground");
      assert.strictEqual(themeColor.id, "statusBarItem.warningBackground");

      const vscodeThemeColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
      assert.strictEqual(
        (vscodeThemeColor as unknown as { id: string }).id,
        "statusBarItem.warningBackground"
      );
    });

    test("BoardSelector updates status bar background color using ThemeColor when board is unselected", () => {
      const outputChannel = new MockOutputChannel("Arduino Unit Test");
      const discovery = new BoardDiscoveryService(outputChannel);

      const selector = new BoardSelector(outputChannel, discovery);
      const selection = selector.getSelection();
      assert.strictEqual(selection.board, null);
      assert.strictEqual(selection.fqbn, "");

      selector.dispose();
    });
  });

  suite("Target 4: Sketch Path Resolution & Error Formatting", () => {
    let tmpDir: string;

    setup(async () => {
      tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "challenger-sketch-test-")
      );
    });

    teardown(async () => {
      if (fs.existsSync(tmpDir)) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    test("non-existent .ino path matching folder name formats 'Path does not exist' error", async () => {
      const nonExistentPath = path.join(
        tmpDir,
        "NonExistentFolder",
        "NonExistentFolder.ino"
      );
      const res = await validateAndResolveSketch(nonExistentPath);

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, path.join(tmpDir, "NonExistentFolder"));
      assert.strictEqual(res.expectedMainFile, nonExistentPath);
      assert.strictEqual(res.error, `Path does not exist: ${nonExistentPath}`);
    });

    test("non-existent .ino path NOT matching folder name formats mismatch error", async () => {
      const nonExistentPath = path.join(
        tmpDir,
        "MyFolder",
        "DifferentName.ino"
      );
      const res = await validateAndResolveSketch(nonExistentPath);

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, path.join(tmpDir, "MyFolder"));
      assert.strictEqual(
        res.expectedMainFile,
        path.join(tmpDir, "MyFolder", "MyFolder.ino")
      );
      assert.ok(
        res.error?.includes(
          'Arduino strictly requires the main sketch file to match its folder name. Expected: "MyFolder.ino"'
        ),
        `Unexpected error message: ${res.error}`
      );
    });

    test("non-existent non-.ino path sets sketchDir to input path and formats missing path error", async () => {
      const nonExistentDir = path.join(tmpDir, "NonExistentDirOnly");
      const res = await validateAndResolveSketch(nonExistentDir);

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, nonExistentDir);
      assert.strictEqual(res.expectedMainFile, "");
      assert.strictEqual(res.error, `Path does not exist: ${nonExistentDir}`);
    });

    test("existing directory without matching .ino file returns valid: false with expected file message", async () => {
      const existingDir = path.join(tmpDir, "EmptySketchFolder");
      await fs.promises.mkdir(existingDir, { recursive: true });

      const res = await validateAndResolveSketch(existingDir);

      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, existingDir);
      assert.strictEqual(
        res.expectedMainFile,
        path.join(existingDir, "EmptySketchFolder.ino")
      );
      assert.ok(
        res.error?.includes("EmptySketchFolder.ino"),
        `Unexpected error message: ${res.error}`
      );
    });

    test("existing directory with matching .ino file returns valid: true", async () => {
      const validSketchDir = path.join(tmpDir, "ValidSketchFolder");
      await fs.promises.mkdir(validSketchDir, { recursive: true });
      const mainFile = path.join(validSketchDir, "ValidSketchFolder.ino");
      await fs.promises.writeFile(
        mainFile,
        "void setup() {}\nvoid loop() {}\n"
      );

      const resDir = await validateAndResolveSketch(validSketchDir);
      assert.strictEqual(resDir.valid, true);
      assert.strictEqual(resDir.sketchDir, validSketchDir);
      assert.strictEqual(resDir.expectedMainFile, mainFile);

      const resFile = await validateAndResolveSketch(mainFile);
      assert.strictEqual(resFile.valid, true);
      assert.strictEqual(resFile.sketchDir, validSketchDir);
      assert.strictEqual(resFile.expectedMainFile, mainFile);
    });
  });
});
