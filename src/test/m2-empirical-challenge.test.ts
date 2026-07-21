import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ArduinoDaemon } from "../cli/daemon";
import { ArduinoCliDownloader } from "../cli/downloader";
import { ArduinoGrpcClient } from "../cli/grpc-client";
import { ArduinoCliConfig } from "../config/cli-config";
import { ArduinoSettings } from "../config/settings";
import { ArduinoFormatter } from "../format/formatter";
import {
  SketchService,
  validateAndResolveSketch,
} from "../sketches/sketch-service";

const mockOutputChannel: vscode.OutputChannel = {
  name: "Test Output",
  append() {},
  appendLine() {},
  replace() {},
  clear() {},
  show() {},
  hide() {},
  dispose() {},
};

suite("Milestone 2 Empirical Challenge Test Suite", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "m2-challenge-test-")
    );
  });

  teardown(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true });
    }
  });

  // ── 1. gRPC Client Empirical Validation ───────────────────────────
  suite("gRPC Client Instance & Connection Guards", () => {
    test("ensureInstance throws if createInstance was not called prior to RPC", async () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);

      const instanceRequiredMethods: Array<() => Promise<unknown>> = [
        () => client.initInstance(),
        () => client.updateIndex(),
        () => client.updateLibrariesIndex(),
        () =>
          client.compile({
            sketchPath: "/tmp/sketch",
            fqbn: "arduino:avr:uno",
          }),
        () =>
          client.upload({
            sketchPath: "/tmp/sketch",
            fqbn: "arduino:avr:uno",
            port: { address: "/dev/ttyACM0", protocol: "serial" },
          }),
        () =>
          client.uploadUsingProgrammer({
            sketchPath: "/tmp/sketch",
            fqbn: "arduino:avr:uno",
            port: { address: "/dev/ttyACM0", protocol: "serial" },
            programmer: "usbasp",
          }),
        () =>
          client.burnBootloader({
            fqbn: "arduino:avr:uno",
            port: { address: "/dev/ttyACM0", protocol: "serial" },
            programmer: "usbasp",
          }),
        () => client.boardList(),
        () => client.boardDetails("arduino:avr:uno"),
        () => client.boardListAll(),
        () => client.boardSearch("uno"),
        () => client.platformSearch("avr"),
        () => client.platformInstall("arduino", "avr"),
        () => client.platformUninstall("arduino", "avr"),
        () => client.librarySearch("Servo"),
        () => client.libraryList(),
        () => client.libraryInstall("Servo"),
        () => client.libraryUninstall("Servo", "1.0.0"),
        () => client.libraryResolveDependencies("Servo"),
        () =>
          client.enumerateMonitorPortSettings(
            { address: "/dev/ttyACM0", protocol: "serial" },
            "arduino:avr:uno"
          ),
        () => client.isDebugSupported("arduino:avr:uno"),
        () =>
          client.getDebugConfig("/tmp/sketch", "arduino:avr:uno", {
            address: "/dev/ttyACM0",
            protocol: "serial",
          }),
        () => client.listProgrammers("arduino:avr:uno"),
      ];

      for (const callFn of instanceRequiredMethods) {
        await assert.rejects(
          async () => callFn(),
          (err: Error) => {
            assert.strictEqual(
              err.message,
              "No instance created. Call createInstance() first."
            );
            return true;
          }
        );
      }
    });

    test("unaryCall and serverStreamCall reject when client is not connected", async () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);

      await assert.rejects(
        async () => client.getVersion(),
        (err: Error) => {
          assert.strictEqual(err.message, "gRPC client not connected");
          return true;
        }
      );

      await assert.rejects(
        async () => client.configurationGet(),
        (err: Error) => {
          assert.strictEqual(err.message, "gRPC client not connected");
          return true;
        }
      );
    });

    test("disconnect resets instance and service state cleanly", () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      assert.strictEqual(client.getInstance(), null);
      client.disconnect();
      assert.strictEqual(client.getInstance(), null);
    });

    test("boardListWatch throws when not connected", () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      assert.throws(
        () => client.boardListWatch(() => {}),
        /Client not connected/
      );
    });

    test("openMonitor throws when not connected", () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      assert.throws(
        () =>
          client.openMonitor(
            { address: "/dev/ttyUSB0", protocol: "serial" },
            "arduino:avr:uno"
          ),
        /Client not connected/
      );
    });
  });

  // ── 2. Sketch Validation Service Empirical Validation ──────────────
  suite("Sketch Validation & Async File Operations", () => {
    test("validateAndResolveSketch handles non-existent directory gracefully", async () => {
      const nonExistentPath = path.join(tmpDir, "does_not_exist_folder");
      const result = await validateAndResolveSketch(nonExistentPath);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.sketchDir, nonExistentPath);
      assert.strictEqual(result.expectedMainFile, "");
      assert.ok(result.error?.includes("Path does not exist"));
    });

    test("validateAndResolveSketch handles existing non-matching sketch file gracefully", async () => {
      const sketchDir = path.join(tmpDir, "MySketch");
      await fs.promises.mkdir(sketchDir, { recursive: true });

      const nonMatchingFile = path.join(sketchDir, "some_other.ino");
      await fs.promises.writeFile(nonMatchingFile, "void setup(){}", "utf8");

      const result = await validateAndResolveSketch(nonMatchingFile);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.sketchDir, sketchDir);
      assert.strictEqual(
        result.expectedMainFile,
        path.join(sketchDir, "MySketch.ino")
      );
      assert.ok(result.error?.includes("folder name"));
    });

    test("validateAndResolveSketch handles non-existent file path edge case", async () => {
      const sketchDir = path.join(tmpDir, "MySketch");
      await fs.promises.mkdir(sketchDir, { recursive: true });

      const nonExistentFile = path.join(sketchDir, "non_existent.ino");
      const result = await validateAndResolveSketch(nonExistentFile);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.sketchDir, sketchDir);
      assert.strictEqual(
        result.expectedMainFile,
        path.join(sketchDir, "MySketch.ino")
      );
      assert.ok(result.error?.includes("folder name"));
    });

    test("validateAndResolveSketch validates valid sketch matching folder name", async () => {
      const sketchDir = path.join(tmpDir, "BlinkTest");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      const mainFile = path.join(sketchDir, "BlinkTest.ino");
      await fs.promises.writeFile(mainFile, "void setup(){}", "utf8");

      const result = await validateAndResolveSketch(sketchDir);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.sketchDir, sketchDir);
      assert.strictEqual(result.expectedMainFile, mainFile);
    });

    test("SketchService createNewSketch fallback executes async fs creation when gRPC fails", async () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      const settings = new ArduinoSettings();
      const service = new SketchService(mockOutputChannel, client, settings);

      const sketchFile = await service.createNewSketch("TestFallbackSketch");
      assert.ok(sketchFile.endsWith("TestFallbackSketch.ino"));

      const exists = await fs.promises
        .access(sketchFile, fs.constants.F_OK)
        .then(
          () => true,
          () => false
        );
      assert.strictEqual(exists, true);

      const content = await fs.promises.readFile(sketchFile, "utf8");
      assert.ok(content.includes("void setup()"));
    });

    test("SketchService loadSketch fallback reads files asynchronously without gRPC", async () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      const settings = new ArduinoSettings();
      const service = new SketchService(mockOutputChannel, client, settings);

      const sketchDir = path.join(tmpDir, "SensorSketch");
      await fs.promises.mkdir(sketchDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sketchDir, "SensorSketch.ino"),
        "void setup(){}",
        "utf8"
      );
      await fs.promises.writeFile(
        path.join(sketchDir, "helper.cpp"),
        "void help(){}",
        "utf8"
      );
      await fs.promises.writeFile(
        path.join(sketchDir, "helper.h"),
        "#define HELP",
        "utf8"
      );

      const info = await service.loadSketch(sketchDir);
      assert.strictEqual(info.name, "SensorSketch");
      assert.strictEqual(
        info.mainFile,
        path.join(sketchDir, "SensorSketch.ino")
      );
      assert.strictEqual(info.rootFolder, sketchDir);
      assert.strictEqual(info.additionalFiles.length, 2);
    });

    test("SketchService copySketch copies files and renames main ino to match dest dir", async () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      const settings = new ArduinoSettings();
      const service = new SketchService(mockOutputChannel, client, settings);

      const sourceDir = path.join(tmpDir, "OldSketch");
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(sourceDir, "OldSketch.ino"),
        "// main code",
        "utf8"
      );
      await fs.promises.writeFile(
        path.join(sourceDir, "config.h"),
        "// config",
        "utf8"
      );

      const destParent = path.join(tmpDir, "dest_folder");
      const newMainFile = await service.copySketch(
        sourceDir,
        destParent,
        "NewSketch"
      );

      const expectedNewDir = path.join(destParent, "NewSketch");
      assert.strictEqual(
        newMainFile,
        path.join(expectedNewDir, "NewSketch.ino")
      );

      const newInoExists = await fs.promises.access(newMainFile).then(
        () => true,
        () => false
      );
      const configExists = await fs.promises
        .access(path.join(expectedNewDir, "config.h"))
        .then(
          () => true,
          () => false
        );

      assert.strictEqual(newInoExists, true);
      assert.strictEqual(configExists, true);
    });

    test("SketchService recent sketches maintains deduplicated max 20 limit", async () => {
      const client = new ArduinoGrpcClient(mockOutputChannel);
      const settings = new ArduinoSettings();
      const service = new SketchService(mockOutputChannel, client, settings);

      for (let i = 1; i <= 25; i++) {
        await service.addToRecent(`/tmp/sketch_${i}/sketch_${i}.ino`);
      }

      const recents = service.getRecentSketches();
      assert.strictEqual(recents.length, 20);
      assert.strictEqual(recents[0], "/tmp/sketch_25");
      assert.strictEqual(recents[19], "/tmp/sketch_6");

      // Test deduplication
      await service.addToRecent("/tmp/sketch_6/sketch_6.ino");
      const updated = service.getRecentSketches();
      assert.strictEqual(updated.length, 20);
      assert.strictEqual(updated[0], "/tmp/sketch_6");
    });
  });

  // ── 3. Daemon Lifecycle Management Empirical Validation ───────────
  suite("Daemon Lifecycle Management", () => {
    test("daemon.start rejects gracefully on non-existent binary path", async () => {
      const daemon = new ArduinoDaemon(mockOutputChannel);
      const invalidPath = path.join(tmpDir, "non_existent_binary");

      await assert.rejects(
        async () => daemon.start(invalidPath),
        (err: Error) => {
          assert.ok(
            err.message.includes("arduino-cli not found at:"),
            `Unexpected error message: ${err.message}`
          );
          return true;
        }
      );

      assert.strictEqual(daemon.isRunning(), false);
      assert.strictEqual(daemon.getPort(), null);
    });

    test("daemon.start rejects duplicate start requests while running or starting", async () => {
      const daemon = new ArduinoDaemon(mockOutputChannel);
      // Mock starting state
      (daemon as unknown as { starting: boolean }).starting = true;

      await assert.rejects(
        async () => daemon.start("/bin/ls"),
        (err: Error) => {
          assert.strictEqual(err.message, "Daemon is already starting");
          return true;
        }
      );

      (daemon as unknown as { starting: boolean }).starting = false;
      (daemon as unknown as { process: object }).process = {};

      await assert.rejects(
        async () => daemon.start("/bin/ls"),
        (err: Error) => {
          assert.strictEqual(err.message, "Daemon is already running");
          return true;
        }
      );
    });

    test("daemon.stop on non-running daemon returns without throwing", async () => {
      const daemon = new ArduinoDaemon(mockOutputChannel);
      assert.strictEqual(daemon.isRunning(), false);
      await daemon.stop();
      assert.strictEqual(daemon.isRunning(), false);
    });
  });

  // ── 4. VS Code Extension Command Activation Synchronicity ─────────
  suite("Extension Command Activation", () => {
    test("All 19 package.json contributed commands are registered synchronously", async () => {
      // Ensure extension is active
      const ext = vscode.extensions.getExtension(
        "fermeridamagni.arduino-unified"
      );
      assert.ok(ext, "Extension not found");

      if (!ext.isActive) {
        await ext.activate();
      }

      const registeredCommands = await vscode.commands.getCommands(true);

      const requiredCommands = [
        "arduinoUnified.compile",
        "arduinoUnified.upload",
        "arduinoUnified.uploadUsingProgrammer",
        "arduinoUnified.burnBootloader",
        "arduinoUnified.exportBinary",
        "arduinoUnified.selectBoard",
        "arduinoUnified.selectPort",
        "arduinoUnified.newSketch",
        "arduinoUnified.openRecentSketch",
        "arduinoUnified.archiveSketch",
        "arduinoUnified.saveSketchAs",
        "arduinoUnified.openSerialMonitor",
        "arduinoUnified.closeSerialMonitor",
        "arduinoUnified.changeBaudRate",
        "arduinoUnified.installLibrary",
        "arduinoUnified.installPlatform",
        "arduinoUnified.startDebug",
        "arduinoUnified.checkDebugSupport",
        "arduinoUnified.showOutput",
      ];

      for (const cmd of requiredCommands) {
        assert.ok(
          registeredCommands.includes(cmd),
          `Command missing from runtime registration: ${cmd}`
        );
      }
    });
  });

  // ── 5. Async FS Operations & Edge Cases ───────────────────────────
  suite("Async FS Operations Edge Cases", () => {
    test("ArduinoCliDownloader.isCliInstalled handles non-existent storage path", async () => {
      const nonExistentStorage = path.join(tmpDir, "nested", "storage");
      const downloader = new ArduinoCliDownloader(
        mockOutputChannel,
        nonExistentStorage
      );

      const installed = await downloader.isCliInstalled();
      assert.strictEqual(installed, false);
    });

    test("ArduinoCliConfig.ensureConfigFile creates parent directories recursively", async () => {
      const deepStoragePath = path.join(
        tmpDir,
        "deeply",
        "nested",
        "storage",
        "path"
      );
      const settings = new ArduinoSettings();
      const configManager = new ArduinoCliConfig(
        mockOutputChannel,
        settings,
        deepStoragePath
      );

      const configFile = await configManager.ensureConfigFile();
      assert.ok(configFile.endsWith("arduino-cli.yaml"));

      const fileExists = await fs.promises.access(configFile).then(
        () => true,
        () => false
      );
      assert.strictEqual(fileExists, true);
    });

    test("ArduinoFormatter handles non-existent file path gracefully", async () => {
      const settings = new ArduinoSettings();
      const formatter = new ArduinoFormatter(mockOutputChannel, settings);
      const nonExistentFile = path.join(tmpDir, "non_existent_code.ino");

      const document = {
        fileName: nonExistentFile,
        getText: () => "void setup(){}\nvoid loop(){}\n",
      } as vscode.TextDocument;

      const edits = await formatter.provideDocumentFormattingEdits(document, {
        insertSpaces: true,
        tabSize: 2,
      });
      // Returns empty array on error instead of throwing an unhandled exception
      assert.ok(Array.isArray(edits));
    });
  });
});
