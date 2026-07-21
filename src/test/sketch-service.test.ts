import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ArduinoGrpcClient } from "../cli/grpc-client";
import { ArduinoSettings } from "../config/settings";
import {
  ensureSketchMainFile,
  SketchService,
  validateAndResolveSketch,
  validateBoardAndPortSelection,
} from "../sketches/sketch-service";
import { MockOutputChannel } from "./mocks/vscode.mock";

suite("SketchService & Validation Unit Tests", () => {
  let tmpDir: string;
  let outputChannel: MockOutputChannel;
  let client: ArduinoGrpcClient;
  let settings: ArduinoSettings;
  let service: SketchService;

  setup(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sketch-test-"));
    outputChannel = new MockOutputChannel("Sketch Test");
    client = new ArduinoGrpcClient(outputChannel as never);
    settings = new ArduinoSettings();
    service = new SketchService(outputChannel as never, client, settings);
    (vscode.window as unknown as Record<string, unknown>).showErrorMessage =
      async () => undefined;
    (
      vscode.window as unknown as Record<string, unknown>
    ).showInformationMessage = async () => undefined;
  });

  teardown(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true });
    }
  });

  suite("validateAndResolveSketch Resolution & Edge Cases", () => {
    test("returns valid for an existing folder with matching .ino main file", async () => {
      const sketchDir = path.join(tmpDir, "ValidSketch");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      const mainFile = path.join(sketchDir, "ValidSketch.ino");
      await fs.promises.writeFile(mainFile, "void setup(){}", "utf8");

      const res = await validateAndResolveSketch(sketchDir);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.sketchDir, sketchDir);
      assert.strictEqual(res.expectedMainFile, mainFile);
      assert.strictEqual(res.error, undefined);
    });

    test("returns valid when given the path to the main .ino file directly", async () => {
      const sketchDir = path.join(tmpDir, "ValidSketch2");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      const mainFile = path.join(sketchDir, "ValidSketch2.ino");
      await fs.promises.writeFile(mainFile, "void setup(){}", "utf8");

      const res = await validateAndResolveSketch(mainFile);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.sketchDir, sketchDir);
      assert.strictEqual(res.expectedMainFile, mainFile);
    });

    test("returns invalid when folder exists but main .ino file is missing or mismatched", async () => {
      const sketchDir = path.join(tmpDir, "MismatchedSketch");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sketchDir, "wrong_name.ino"),
        "void setup(){}",
        "utf8"
      );

      const res = await validateAndResolveSketch(sketchDir);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, sketchDir);
      assert.strictEqual(
        res.expectedMainFile,
        path.join(sketchDir, "MismatchedSketch.ino")
      );
      assert.ok(res.error?.includes("folder name"));
    });

    test("TASK 1 FIX: non-existent file ending in .ino sets sketchDir to path.dirname(inputPath)", async () => {
      const sketchDir = path.join(tmpDir, "NonExistentFolder");
      const nonExistentFile = path.join(sketchDir, "NonExistentFolder.ino");

      const res = await validateAndResolveSketch(nonExistentFile);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, sketchDir);
      assert.strictEqual(res.expectedMainFile, nonExistentFile);
      assert.ok(
        res.error?.includes("folder name") ||
          res.error?.includes("Path does not exist")
      );
    });

    test("non-existent folder path not ending in .ino sets sketchDir to inputPath and reports missing path", async () => {
      const nonExistentPath = path.join(tmpDir, "no_such_directory");
      const res = await validateAndResolveSketch(nonExistentPath);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.sketchDir, nonExistentPath);
      assert.strictEqual(res.expectedMainFile, "");
      assert.ok(res.error?.includes("Path does not exist"));
    });
  });

  suite("validateBoardAndPortSelection", () => {
    test("returns false when no board (fqbn) is selected", async () => {
      const result = await validateBoardAndPortSelection({});
      assert.strictEqual(result, false);
    });

    test("returns false when board is selected but port is required and missing", async () => {
      const result = await validateBoardAndPortSelection(
        { fqbn: "arduino:avr:uno" },
        { requirePort: true }
      );
      assert.strictEqual(result, false);
    });

    test("returns true when fqbn is present and port is not required", async () => {
      const result = await validateBoardAndPortSelection({
        fqbn: "arduino:avr:uno",
      });
      assert.strictEqual(result, true);
    });

    test("returns true when fqbn and port address are both present and required", async () => {
      const result = await validateBoardAndPortSelection(
        { fqbn: "arduino:avr:uno", portAddress: "/dev/ttyACM0" },
        { requirePort: true }
      );
      assert.strictEqual(result, true);
    });
  });

  suite("ensureSketchMainFile Prompt Handling", () => {
    test("returns result directly if sketch is already valid", async () => {
      const sketchDir = path.join(tmpDir, "EnsureValid");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sketchDir, "EnsureValid.ino"),
        "void setup(){}",
        "utf8"
      );

      const res = await ensureSketchMainFile(sketchDir);
      assert.ok(res);
      assert.strictEqual(res?.valid, true);
    });

    test("returns null if sketch is invalid and user cancels error prompt", async () => {
      const sketchDir = path.join(tmpDir, "EnsureInvalid");
      await fs.promises.mkdir(sketchDir, { recursive: true });

      const res = await ensureSketchMainFile(sketchDir);
      assert.strictEqual(res, null);
    });
  });

  suite("SketchService Fallbacks & Sketch Operations", () => {
    test("createNewSketch creates new sketch folder and .ino main file with template when gRPC fails", async () => {
      const mainFile = await service.createNewSketch("TestCustomSketch");
      assert.ok(mainFile.endsWith("TestCustomSketch.ino"));

      const exists = await fs.promises.access(mainFile).then(
        () => true,
        () => false
      );
      assert.strictEqual(exists, true);

      const content = await fs.promises.readFile(mainFile, "utf8");
      assert.ok(content.includes("void setup()"));
    });

    test("createNewSketch generates random name when name parameter is omitted", async () => {
      const mainFile = await service.createNewSketch();
      assert.ok(path.basename(mainFile).startsWith("sketch_"));
      assert.ok(mainFile.endsWith(".ino"));
    });

    test("loadSketch loads sketch structure via manual fallback when gRPC fails", async () => {
      const sketchDir = path.join(tmpDir, "ManualLoadSketch");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sketchDir, "ManualLoadSketch.ino"),
        "void setup(){}",
        "utf8"
      );
      await fs.promises.writeFile(
        path.join(sketchDir, "util.cpp"),
        "void util(){}",
        "utf8"
      );
      await fs.promises.writeFile(
        path.join(sketchDir, "util.h"),
        "#pragma once",
        "utf8"
      );

      const info = await service.loadSketch(sketchDir);
      assert.strictEqual(info.name, "ManualLoadSketch");
      assert.strictEqual(
        info.mainFile,
        path.join(sketchDir, "ManualLoadSketch.ino")
      );
      assert.strictEqual(info.rootFolder, sketchDir);
      assert.strictEqual(info.additionalFiles.length, 2);
    });

    test("validateSketchFolder returns valid status and main file path for valid sketch", async () => {
      const sketchDir = path.join(tmpDir, "ValidFolderCheck");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sketchDir, "ValidFolderCheck.ino"),
        "void setup(){}",
        "utf8"
      );

      const res = await service.validateSketchFolder(sketchDir);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(
        res.mainFile,
        path.join(sketchDir, "ValidFolderCheck.ino")
      );
    });

    test("copySketch duplicates directory files and renames main .ino file to destination name", async () => {
      const sourceDir = path.join(tmpDir, "SourceSketch");
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sourceDir, "SourceSketch.ino"),
        "// source ino",
        "utf8"
      );
      await fs.promises.writeFile(
        path.join(sourceDir, "header.h"),
        "// header",
        "utf8"
      );

      const destParent = path.join(tmpDir, "destination");
      const copiedMain = await service.copySketch(
        sourceDir,
        destParent,
        "CopiedSketch"
      );

      const expectedDir = path.join(destParent, "CopiedSketch");
      assert.strictEqual(
        copiedMain,
        path.join(expectedDir, "CopiedSketch.ino")
      );

      const mainExists = await fs.promises.access(copiedMain).then(
        () => true,
        () => false
      );
      const headerExists = await fs.promises
        .access(path.join(expectedDir, "header.h"))
        .then(
          () => true,
          () => false
        );

      assert.strictEqual(mainExists, true);
      assert.strictEqual(headerExists, true);
    });

    test("recent sketches list manages deduplication, ordering, and max 20 limit", async () => {
      for (let i = 1; i <= 25; i++) {
        await service.addToRecent(`/tmp/sketch_dir_${i}/sketch_dir_${i}.ino`);
      }

      const list1 = service.getRecentSketches();
      assert.strictEqual(list1.length, 20);
      assert.strictEqual(list1[0], "/tmp/sketch_dir_25");
      assert.strictEqual(list1[19], "/tmp/sketch_dir_6");

      // Re-add an existing item to test deduplication & moving to top
      await service.addToRecent("/tmp/sketch_dir_6/sketch_dir_6.ino");
      const list2 = service.getRecentSketches();
      assert.strictEqual(list2.length, 20);
      assert.strictEqual(list2[0], "/tmp/sketch_dir_6");

      // Test setRecentSketches
      service.setRecentSketches(["/custom/path/1", "/custom/path/2"]);
      assert.deepStrictEqual(service.getRecentSketches(), [
        "/custom/path/1",
        "/custom/path/2",
      ]);
    });
  });
});
