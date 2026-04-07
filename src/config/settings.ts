import * as vscode from "vscode";

/**
 * Namespace for all Arduino Unified settings.
 */
const SETTINGS_NAMESPACE = "arduinoUnified";

/**
 * Compiler warning levels.
 */
export type WarningLevel = "none" | "default" | "more" | "all";

/**
 * Line ending options for serial monitor.
 */
export type LineEnding = "none" | "nl" | "cr" | "nlcr";

/**
 * Provides typed access to all Arduino Unified VSCode settings.
 * All settings are namespaced under `arduinoUnified.*`.
 */
export class ArduinoSettings {
  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);
  }

  // ── CLI Settings ──────────────────────────────────────────

  /** Custom path to arduino-cli binary. Empty = auto-managed. */
  get cliPath(): string {
    return this.config.get<string>("cli.path", "");
  }

  /** Arduino CLI version to auto-download. */
  get cliVersion(): string {
    return this.config.get<string>("cli.version", "1.4.1");
  }

  // ── Compile Settings ──────────────────────────────────────

  /** Show verbose output during compilation. */
  get compileVerbose(): boolean {
    return this.config.get<boolean>("compile.verbose", false);
  }

  /** Compiler warning level. */
  get compileWarnings(): WarningLevel {
    return this.config.get<WarningLevel>("compile.warnings", "none");
  }

  /** Optimize compilation output for debugging. */
  get compileOptimizeForDebug(): boolean {
    return this.config.get<boolean>("compile.optimizeForDebug", false);
  }

  // ── Upload Settings ───────────────────────────────────────

  /** Show verbose output during upload. */
  get uploadVerbose(): boolean {
    return this.config.get<boolean>("upload.verbose", false);
  }

  /** Verify uploaded binary. */
  get uploadVerify(): boolean {
    return this.config.get<boolean>("upload.verify", false);
  }

  /** Auto-compile before uploading. */
  get uploadAutoVerify(): boolean {
    return this.config.get<boolean>("upload.autoVerify", true);
  }

  // ── Sketchbook Settings ───────────────────────────────────

  /** Path to the Arduino sketchbook folder. */
  get sketchbookPath(): string {
    return this.config.get<string>("sketchbook.path", "");
  }

  // ── Board Manager Settings ────────────────────────────────

  /** Additional board manager URLs for 3rd-party platforms (e.g., ESP32). */
  get additionalUrls(): string[] {
    return this.config.get<string[]>("boardManager.additionalUrls", []);
  }

  // ── Serial Monitor Settings ───────────────────────────────

  /** Default baud rate for serial monitor. */
  get monitorBaudRate(): number {
    return this.config.get<number>("monitor.baudRate", 9600);
  }

  /** Line ending to append when sending data. */
  get monitorLineEnding(): LineEnding {
    return this.config.get<LineEnding>("monitor.lineEnding", "nl");
  }

  /** Auto-scroll serial monitor output. */
  get monitorAutoScroll(): boolean {
    return this.config.get<boolean>("monitor.autoScroll", true);
  }

  /** Show timestamps in serial monitor. */
  get monitorTimestamp(): boolean {
    return this.config.get<boolean>("monitor.timestamp", false);
  }

  // ── Formatter Settings ────────────────────────────────────

  /** Path to custom clang-format binary. */
  get formatterPath(): string {
    return this.config.get<string>("formatter.path", "");
  }

  // ── Language Server Settings ──────────────────────────────

  /** Path to arduino-language-server binary. */
  get languageServerPath(): string {
    return this.config.get<string>("languageServer.path", "");
  }

  /** Path to clangd binary. */
  get clangdPath(): string {
    return this.config.get<string>("clangd.path", "");
  }

  // ── General ───────────────────────────────────────────────

  /** Template for new sketches (custom .ino content). */
  get sketchTemplate(): string {
    return this.config.get<string>(
      "sketch.template",
      "void setup() {\n  // put your setup code here, to run once:\n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n}\n"
    );
  }

  /**
   * Registers a listener for settings changes.
   * Returns a disposable to unregister.
   */
  onDidChange(
    callback: (e: vscode.ConfigurationChangeEvent) => void
  ): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SETTINGS_NAMESPACE)) {
        callback(e);
      }
    });
  }

  /**
   * Updates a setting value programmatically.
   */
  async update(key: string, value: unknown, global = true): Promise<void> {
    const target = global
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;
    await this.config.update(key, value, target);
  }
}

/**
 * Returns the full settings contribution for package.json.
 * This is used as documentation; the actual values are in package.json.
 */
export function getSettingsSchema(): Record<string, unknown> {
  return {
    "arduinoUnified.cli.path": {
      type: "string",
      default: "",
      description:
        "Custom path to arduino-cli binary. Leave empty to auto-download.",
    },
    "arduinoUnified.cli.version": {
      type: "string",
      default: "1.4.1",
      description: "Arduino CLI version to auto-download.",
    },
    "arduinoUnified.compile.verbose": {
      type: "boolean",
      default: false,
      description: "Show verbose output during compilation.",
    },
    "arduinoUnified.compile.warnings": {
      type: "string",
      default: "none",
      enum: ["none", "default", "more", "all"],
      description: "Compiler warning level.",
    },
    "arduinoUnified.compile.optimizeForDebug": {
      type: "boolean",
      default: false,
      description: "Optimize compilation for debugging.",
    },
    "arduinoUnified.upload.verbose": {
      type: "boolean",
      default: false,
      description: "Show verbose output during upload.",
    },
    "arduinoUnified.upload.verify": {
      type: "boolean",
      default: false,
      description: "Verify uploaded binary after upload.",
    },
    "arduinoUnified.upload.autoVerify": {
      type: "boolean",
      default: true,
      description: "Automatically compile sketch before uploading.",
    },
    "arduinoUnified.sketchbook.path": {
      type: "string",
      default: "",
      description:
        "Path to Arduino sketchbook folder. Leave empty for default.",
    },
    "arduinoUnified.boardManager.additionalUrls": {
      type: "array",
      items: { type: "string" },
      default: [],
      description:
        "Additional board manager URLs for 3rd-party platforms (ESP32, STM32, etc.).",
    },
    "arduinoUnified.monitor.baudRate": {
      type: "number",
      default: 9600,
      enum: [
        300, 1200, 2400, 4800, 9600, 19_200, 38_400, 57_600, 115_200, 230_400,
        460_800, 921_600,
      ],
      description: "Default baud rate for serial monitor.",
    },
    "arduinoUnified.monitor.lineEnding": {
      type: "string",
      default: "nl",
      enum: ["none", "nl", "cr", "nlcr"],
      enumDescriptions: [
        "No line ending",
        "Newline (\\n)",
        "Carriage return (\\r)",
        "Both (\\r\\n)",
      ],
      description: "Line ending to append when sending serial data.",
    },
    "arduinoUnified.monitor.autoScroll": {
      type: "boolean",
      default: true,
      description: "Auto-scroll serial monitor output.",
    },
    "arduinoUnified.monitor.timestamp": {
      type: "boolean",
      default: false,
      description: "Show timestamps in serial monitor output.",
    },
  };
}
