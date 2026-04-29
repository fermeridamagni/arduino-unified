import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArduinoCliConfig } from "../config/cli-config";
import type { ArduinoSettings } from "../config/settings";

const outputChannel = {
  appendLine() {},
} as const;

class TestArduinoCliConfig extends ArduinoCliConfig {
  private readonly dataDir: string;
  private readonly sketchbookDir: string;

  constructor(
    outputChannel: { appendLine(): void },
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

suite("ArduinoCliConfig YAML generation", () => {
  test("quotes directory paths so YAML does not reinterpret backslashes", async () => {
    const storagePath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "arduino-cli-config-")
    );

    try {
      const settings = {
        additionalUrls: [],
        sketchbookPath: "",
      } as unknown as ArduinoSettings;

      // Use a backslash-heavy path to reproduce YAML escape parsing issues.
      const dataDir = "C:\\Users\\Test\\AppData\\Local\\Arduino15";
      // Include a normal POSIX-style path to show the quoting rule is generic.
      const sketchbookDir = "/Users/test/Documents/Arduino";

      const config = new TestArduinoCliConfig(
        outputChannel,
        settings,
        storagePath,
        dataDir,
        sketchbookDir
      );

      const configPath = await config.ensureConfigFile();
      const yaml = await fs.promises.readFile(configPath, "utf8");

      const expectedDownloads = path.join(dataDir, "staging");

      // The daemon port should remain numeric, not a quoted string.
      assert.ok(yaml.includes("daemon:\n  port: 0\n"));
      // All directory values should be wrapped in single quotes.
      assert.ok(yaml.includes(`  data: '${dataDir}'`));
      assert.ok(yaml.includes(`  downloads: '${expectedDownloads}'`));
      assert.ok(yaml.includes(`  user: '${sketchbookDir}'`));
      // Double quotes would let YAML treat backslashes as escapes.
      assert.ok(!yaml.includes(`  data: "${dataDir}"`));
      assert.ok(!yaml.includes(`  downloads: "${expectedDownloads}"`));
      assert.ok(!yaml.includes(`  user: "${sketchbookDir}"`));
    } finally {
      await fs.promises.rm(storagePath, { force: true, recursive: true });
    }
  });
});
