import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArduinoCliConfig } from "../config/cli-config";
import { ArduinoSettings } from "../config/settings";
import { MockOutputChannel } from "./mocks/vscode.mock";

class TestArduinoCliConfig extends ArduinoCliConfig {
  private readonly dataDir: string;
  private readonly sketchbookDir: string;

  constructor(
    outputChannel: { appendLine(value?: string): void },
    settings: ArduinoSettings,
    storagePath: string,
    dataDir: string,
    sketchbookDir: string
  ) {
    super(outputChannel as never, settings, storagePath);
    this.dataDir = dataDir;
    this.sketchbookDir = sketchbookDir;
  }

  override getDefaultDataDir(): string {
    return this.dataDir;
  }

  override getDefaultSketchbookDir(): string {
    return this.sketchbookDir;
  }
}

suite("ArduinoCliConfig Unit & YAML Tests", () => {
  let tmpDir: string;
  let outputChannel: MockOutputChannel;
  let settings: ArduinoSettings;

  setup(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "cli-config-test-")
    );
    outputChannel = new MockOutputChannel("CLI Config Test");
    settings = new ArduinoSettings();
  });

  teardown(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { force: true, recursive: true });
    }
  });

  suite("Path & Directory Resolution", () => {
    test("getConfigFilePath returns path to arduino-cli.yaml under storage config dir", () => {
      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        settings,
        tmpDir
      );
      assert.strictEqual(
        configManager.getConfigFilePath(),
        path.join(tmpDir, "config", "arduino-cli.yaml")
      );
    });

    test("getDefaultDataDir returns platform-specific location", () => {
      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        settings,
        tmpDir
      );
      const dataDir = configManager.getDefaultDataDir();
      assert.ok(typeof dataDir === "string" && dataDir.length > 0);
    });

    test("getDefaultSketchbookDir uses custom setting when provided", () => {
      const customPath = "/custom/sketchbook/path";
      const customSettings = {
        sketchbookPath: customPath,
        additionalUrls: [],
      } as unknown as ArduinoSettings;

      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        customSettings,
        tmpDir
      );
      assert.strictEqual(configManager.getDefaultSketchbookDir(), customPath);
    });
  });

  suite("YAML Generation & File Operations", () => {
    test("ensureConfigFile creates config directory recursively and writes valid YAML", async () => {
      const deepStoragePath = path.join(tmpDir, "nested", "storage", "path");
      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        settings,
        deepStoragePath
      );

      const configFile = await configManager.ensureConfigFile();
      assert.strictEqual(
        configFile,
        path.join(deepStoragePath, "config", "arduino-cli.yaml")
      );

      const exists = await fs.promises.access(configFile).then(
        () => true,
        () => false
      );
      assert.strictEqual(exists, true);
    });

    test("ensureConfigFile does not overwrite existing config file", async () => {
      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        settings,
        tmpDir
      );
      const configFile = await configManager.ensureConfigFile();
      await fs.promises.writeFile(
        configFile,
        "custom_key: custom_value\n",
        "utf8"
      );

      const secondCallResult = await configManager.ensureConfigFile();
      assert.strictEqual(secondCallResult, configFile);

      const content = await fs.promises.readFile(configFile, "utf8");
      assert.strictEqual(content, "custom_key: custom_value\n");
    });

    test("updateConfigFile overwrites config file with current settings", async () => {
      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        settings,
        tmpDir
      );
      await configManager.ensureConfigFile();
      await configManager.updateConfigFile();

      const configFile = configManager.getConfigFilePath();
      const content = await fs.promises.readFile(configFile, "utf8");
      assert.ok(content.includes("directories:"));
    });

    test("quotes directory paths so YAML does not reinterpret backslashes", async () => {
      const dataDir = "C:\\Users\\Test\\AppData\\Local\\Arduino15";
      const sketchbookDir = "/Users/test/Documents/Arduino";

      const config = new TestArduinoCliConfig(
        outputChannel,
        settings,
        tmpDir,
        dataDir,
        sketchbookDir
      );

      const configPath = await config.ensureConfigFile();
      const yaml = await fs.promises.readFile(configPath, "utf8");
      const expectedDownloads = path.join(dataDir, "staging");

      assert.ok(yaml.includes("daemon:\n  port: 0\n"));
      assert.ok(yaml.includes(`  data: '${dataDir}'`));
      assert.ok(yaml.includes(`  downloads: '${expectedDownloads}'`));
      assert.ok(yaml.includes(`  user: '${sketchbookDir}'`));
      assert.ok(!yaml.includes(`  data: "${dataDir}"`));
      assert.ok(!yaml.includes(`  downloads: "${expectedDownloads}"`));
      assert.ok(!yaml.includes(`  user: "${sketchbookDir}"`));
    });
  });

  suite("Daemon Syncing", () => {
    test("syncToCliDaemon handles disconnected client gracefully without crashing", async () => {
      const configManager = new ArduinoCliConfig(
        outputChannel as never,
        settings,
        tmpDir
      );

      const mockClient = {
        settingsSetValue: async () => {
          throw new Error("gRPC client not connected");
        },
      };

      await assert.doesNotReject(async () => {
        await configManager.syncToCliDaemon(mockClient as never);
      });
    });
  });
});
