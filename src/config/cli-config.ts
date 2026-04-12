import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { ArduinoSettings } from "./settings";

/**
 * Manages the `arduino-cli.yaml` configuration file.
 * Syncs relevant VSCode settings to the CLI config and handles
 * runtime configuration updates via gRPC.
 */
export class ArduinoCliConfig {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly settings: ArduinoSettings;
  private configDir: string;

  constructor(
    outputChannel: vscode.OutputChannel,
    settings: ArduinoSettings,
    storagePath: string
  ) {
    this.outputChannel = outputChannel;
    this.settings = settings;
    this.configDir = path.join(storagePath, "config");
  }

  /**
   * Returns the path to the arduino-cli.yaml configuration file.
   */
  getConfigFilePath(): string {
    return path.join(this.configDir, "arduino-cli.yaml");
  }

  /**
   * Returns the default data directory for Arduino CLI.
   */
  getDefaultDataDir(): string {
    switch (os.platform()) {
      case "darwin":
        return path.join(os.homedir(), "Library", "Arduino15");
      case "win32":
        return path.join(
          process.env.LOCALAPPDATA ??
            path.join(os.homedir(), "AppData", "Local"),
          "Arduino15"
        );
      default:
        return path.join(os.homedir(), ".arduino15");
    }
  }

  /**
   * Returns the default sketchbook directory.
   */
  getDefaultSketchbookDir(): string {
    const userPath = this.settings.sketchbookPath;
    if (userPath) {
      return userPath;
    }

    switch (os.platform()) {
      case "darwin":
        return path.join(os.homedir(), "Documents", "Arduino");
      default:
        return path.join(os.homedir(), "Arduino");
    }
  }

  /**
   * Ensures the config directory exists and writes a default
   * `arduino-cli.yaml` if one doesn't exist.
   */
  async ensureConfigFile(): Promise<string> {
    await fs.promises.mkdir(this.configDir, { recursive: true });

    const configPath = this.getConfigFilePath();

    let configExists = false;
    try {
      await fs.promises.access(configPath);
      configExists = true;
    } catch {
      configExists = false;
    }

    if (!configExists) {
      const config = this.buildConfigYaml();
      await fs.promises.writeFile(configPath, config, "utf8");
      this.outputChannel.appendLine(
        `[Config] Created config file: ${configPath}`
      );
    }

    return configPath;
  }

  /**
   * Syncs VSCode settings to the arduino-cli daemon via gRPC.
   * Called after initialization and on settings changes.
   */
  async syncToCliDaemon(client: ArduinoGrpcClient): Promise<void> {
    try {
      // Sync additional board manager URLs
      const urls = this.settings.additionalUrls;
      if (urls.length > 0) {
        await client.settingsSetValue(
          "board_manager.additional_urls",
          JSON.stringify(urls)
        );
        this.outputChannel.appendLine(
          `[Config] Synced ${urls.length} additional board manager URLs`
        );
      }

      // Sync sketchbook path
      const sketchbookPath = this.settings.sketchbookPath;
      if (sketchbookPath) {
        await client.settingsSetValue(
          "directories.user",
          JSON.stringify(sketchbookPath)
        );
        this.outputChannel.appendLine(
          `[Config] Synced sketchbook path: ${sketchbookPath}`
        );
      }

      this.outputChannel.appendLine("[Config] Settings synced to CLI daemon");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(
        `[Config] Failed to sync settings: ${message}`
      );
    }
  }

  /**
   * Rebuilds and writes the config file from current settings.
   */
  async updateConfigFile(): Promise<void> {
    const config = this.buildConfigYaml();
    const configPath = this.getConfigFilePath();
    await fs.promises.writeFile(configPath, config, "utf8");
    this.outputChannel.appendLine("[Config] Updated config file");
  }

  /**
   * Builds the YAML content for arduino-cli.yaml.
   */
  private buildConfigYaml(): string {
    const dataDir = this.getDefaultDataDir();
    const sketchbookDir = this.getDefaultSketchbookDir();
    const additionalUrls = this.settings.additionalUrls;

    const lines = ["board_manager:", "  additional_urls:"];

    for (const url of additionalUrls) {
      lines.push(`    - ${url}`);
    }

    lines.push(
      "",
      "daemon:",
      '  port: "0"',
      "",
      "directories:",
      `  data: "${dataDir}"`,
      `  downloads: "${path.join(dataDir, "staging")}"`,
      `  user: "${sketchbookDir}"`,
      "",
      "logging:",
      "  level: info",
      "  format: json",
      "",
      "metrics:",
      "  enabled: false"
    );

    return `${lines.join("\n")}\n`;
  }
}
