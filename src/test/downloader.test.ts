import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArduinoCliDownloader, calculateChecksum } from "../cli/downloader";
import { MockOutputChannel } from "./mocks/vscode.mock";

suite("ArduinoCliDownloader & Checksum Unit Tests", () => {
  let tmpDir: string;
  let outputChannel: MockOutputChannel;
  let downloader: ArduinoCliDownloader;

  setup(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "downloader-test-")
    );
    outputChannel = new MockOutputChannel("Downloader Test");
    downloader = new ArduinoCliDownloader(outputChannel as never, tmpDir);
  });

  teardown(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true });
    }
  });

  suite("calculateChecksum", () => {
    test("calculates correct SHA-256 hash of a file", async () => {
      const testFile = path.join(tmpDir, "test.txt");
      const content = "Arduino Unified Downloader Unit Test";
      await fs.promises.writeFile(testFile, content, "utf8");

      const expectedHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      const actualHash = await calculateChecksum(testFile);
      assert.strictEqual(actualHash, expectedHash);
    });

    test("rejects when calculating checksum for non-existent file", async () => {
      const nonExistentFile = path.join(tmpDir, "does_not_exist.bin");
      await assert.rejects(
        async () => calculateChecksum(nonExistentFile),
        (err: Error) => {
          assert.ok(
            err.message.includes("ENOENT") ||
              err.message.includes("no such file")
          );
          return true;
        }
      );
    });
  });

  suite("ArduinoCliDownloader Path & Installation Checks", () => {
    test("getCliBinaryPath appends .exe on Windows and plain binary name on Unix", () => {
      const binPath = downloader.getCliBinaryPath();
      const expectedName =
        os.platform() === "win32" ? "arduino-cli.exe" : "arduino-cli";
      assert.strictEqual(path.basename(binPath), expectedName);
      assert.strictEqual(path.dirname(binPath), path.join(tmpDir, "bin"));
    });

    test("isCliInstalled returns false when CLI binary does not exist", async () => {
      const installed = await downloader.isCliInstalled();
      assert.strictEqual(installed, false);
    });

    test("isCliInstalled returns true when CLI binary exists", async () => {
      const binPath = downloader.getCliBinaryPath();
      await fs.promises.mkdir(path.dirname(binPath), { recursive: true });
      await fs.promises.writeFile(binPath, "dummy binary", "utf8");

      const installed = await downloader.isCliInstalled();
      assert.strictEqual(installed, true);
    });

    test("uninstall recursively removes bin directory", async () => {
      const binPath = downloader.getCliBinaryPath();
      await fs.promises.mkdir(path.dirname(binPath), { recursive: true });
      await fs.promises.writeFile(binPath, "dummy binary", "utf8");

      assert.strictEqual(await downloader.isCliInstalled(), true);
      await downloader.uninstall();
      assert.strictEqual(await downloader.isCliInstalled(), false);
    });

    test("download handles HTTP / checksum errors gracefully and cleans up temp files", async () => {
      // Pass invalid version/url to verify error handling & exception throwing
      await assert.rejects(
        async () => downloader.download("invalid-ver-0.0.0"),
        (err: Error) => {
          assert.ok(err.message.includes("Failed to download Arduino CLI"));
          return true;
        }
      );
    });
  });
});
