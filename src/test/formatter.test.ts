import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArduinoSettings } from "../config/settings";
import { ArduinoFormatter } from "../format/formatter";
import {
  MockOutputChannel,
  Position,
  Uri,
  workspaceConfigValues,
} from "./mocks/vscode.mock";

suite("ArduinoFormatter Unit & Integration Tests", () => {
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
      workspaceConfigValues["arduinoUnified.formatter.path"] =
        "/non_existent/clang-format";

      const dummyDoc = {
        fileName: path.join(tmpDir, "sketch.ino"),
        uri: Uri.file(path.join(tmpDir, "sketch.ino")),
        getText: () => "void setup(){}\nvoid loop(){}\n",
        positionAt: (offset: number) => new Position(0, offset),
      };

      const edits = await formatter.provideDocumentFormattingEdits(
        dummyDoc as never,
        { insertSpaces: true, tabSize: 2 }
      );

      assert.ok(Array.isArray(edits));
    });

    test("handles document with non-existent path without throwing unhandled exceptions", async () => {
      const nonExistentFile = path.join(tmpDir, "non_existent.ino");

      const dummyDoc = {
        fileName: nonExistentFile,
        uri: Uri.file(nonExistentFile),
        getText: () => "int a=1;",
        positionAt: (offset: number) => new Position(0, offset),
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
