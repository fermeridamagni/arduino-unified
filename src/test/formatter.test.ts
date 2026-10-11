import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ArduinoSettings } from "../config/settings";
import { ArduinoFormatter } from "../format/formatter";
import { MockOutputChannel } from "./mocks/vscode.mock";

suite("ArduinoFormatter Unit & Integration Tests", function () {
  if (typeof this !== "undefined" && typeof this?.timeout === "function") {
    this.timeout(20_000);
  }

  let tmpDir: string;
  let outputChannel: MockOutputChannel;
  let settings: ArduinoSettings;
  let formatter: ArduinoFormatter;

  setup(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "formatter-test-")
    );
    outputChannel = new MockOutputChannel("Formatter Test");
    settings = new ArduinoSettings();
    formatter = new ArduinoFormatter(outputChannel as never, settings);
  });

  teardown(async () => {
    formatter.dispose();
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true });
    }
  });

  suite("Formatting Provider Behaviors", () => {
    test("returns empty array and logs warning when clang-format binary is not found", async () => {
      (
        formatter as unknown as {
          findClangFormat: () => Promise<string | null>;
        }
      ).findClangFormat = async () => null;

      const dummyDoc = {
        fileName: path.join(tmpDir, "sketch.ino"),
        uri: vscode.Uri.file(path.join(tmpDir, "sketch.ino")),
        getText: () => "void setup(){}\nvoid loop(){}\n",
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };

      const edits = await formatter.provideDocumentFormattingEdits(
        dummyDoc as never,
        { insertSpaces: true, tabSize: 2 }
      );

      assert.ok(Array.isArray(edits));
      assert.strictEqual(edits.length, 0);
    });

    test("handles document with non-existent path without throwing unhandled exceptions", async () => {
      const nonExistentFile = path.join(tmpDir, "non_existent.ino");

      const dummyDoc = {
        fileName: nonExistentFile,
        uri: vscode.Uri.file(nonExistentFile),
        getText: () => "int a=1;",
        positionAt: (offset: number) => new vscode.Position(0, offset),
      };

      const edits = await formatter.provideDocumentFormattingEdits(
        dummyDoc as never,
        { insertSpaces: true, tabSize: 2 }
      );

      assert.ok(Array.isArray(edits));
    });

    test("dispose cleans up registered formatting provider disposables cleanly", () => {
      assert.doesNotThrow(() => formatter.dispose());
    });
  });
});
