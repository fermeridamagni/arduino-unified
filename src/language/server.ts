import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  type ClientCapabilities,
  LanguageClient,
  type LanguageClientOptions,
  NotificationType,
  type ServerOptions,
  type StaticFeature,
} from "vscode-languageclient/node";
import type { BoardConfigStore } from "../boards/config-store";
import type { BoardSelection } from "../boards/selector";
import type { ArduinoSettings } from "../config/settings";
import type { LanguageBinariesManager } from "./binaries";

let hasWarnedClangdConflict = false;

/**
 * Checks if the external clangd extension is active and warns once if present.
 */
export function checkClangdConflict(): void {
  if (hasWarnedClangdConflict) {
    return;
  }
  const clangdExt = vscode.extensions.getExtension(
    "llvm-vs-code-extensions.vscode-clangd"
  );
  if (clangdExt) {
    hasWarnedClangdConflict = true;
    vscode.window.showWarningMessage(
      "The Clangd extension (llvm-vs-code-extensions.vscode-clangd) is enabled alongside Arduino Unified. Two language servers managing IntelliSense may conflict."
    );
  }
}

/**
 * Parameters sent to ALS after a full build (Compile/Verify) finishes outside
 * the language server. ALS copies the fresh `libraries.cache` from the build
 * output and re-runs library discovery, so library headers used by the
 * sketch become available to IntelliSense.
 */
export interface DidCompleteBuildParams {
  buildOutputUri: string;
}

/**
 * `ino/didCompleteBuild` — IDE-to-ALS notification sent after a full build.
 */
export const DidCompleteBuildNotification =
  new NotificationType<DidCompleteBuildParams>("ino/didCompleteBuild");

/** Glob matching C/C++ sources inside the sketch or library folders. */
const CPP_SOURCE_GLOB = "**/*.{c,cc,cpp,cxx,h,hh,hpp}";
const CPP_LANGUAGE_IDS = ["c", "cpp"];

/**
 * Builds the document selector for the language client.
 *
 * `.ino`/`.pde` documents are always attached. C/C++ documents are attached
 * only when they live inside the sketch folder, an installed-library folder,
 * or the board platform folder. Scoping by directory prevents ALS from
 * claiming C/C++ files of unrelated projects in multi-root workspaces
 * (e.g. monorepo web apps).
 */
export function buildDocumentSelector(
  sketchDir: string,
  libraryDirs: string[] = []
): vscode.DocumentFilter[] {
  const filters: vscode.DocumentFilter[] = [
    { language: "ino", scheme: "file" },
    { language: "ino", scheme: "untitled" },
  ];
  const seenDirs = new Set<string>();
  for (const dir of [sketchDir, ...libraryDirs]) {
    if (!dir || seenDirs.has(dir)) {
      continue;
    }
    seenDirs.add(dir);
    for (const language of CPP_LANGUAGE_IDS) {
      filters.push({
        language,
        scheme: "file",
        pattern: new vscode.RelativePattern(
          vscode.Uri.file(dir),
          CPP_SOURCE_GLOB
        ),
      });
    }
  }
  return filters;
}

/**
 * Builds the client options for the language client factory.
 */
function buildClientOptions(
  alsLogOutputChannel: vscode.LogOutputChannel,
  sketchDir: string,
  libraryDirs: string[]
): LanguageClientOptions {
  return {
    // vscode.DocumentFilter[] is runtime-compatible with the LSP selector
    // (v10 supports RelativePattern via relativePatternSupport); the types
    // are structurally equivalent but nominal, hence the boundary cast.
    documentSelector: buildDocumentSelector(
      sketchDir,
      libraryDirs
    ) as unknown as LanguageClientOptions["documentSelector"],
    outputChannel: alsLogOutputChannel,
    // ALS treats the initialize root as the sketch root. Pointing it at the
    // sketch folder (instead of the workspace root) is what lets the CLI
    // bootstrap build discover #include'd libraries for the compile
    // database — critical in monorepos where the sketch is a subfolder.
    workspaceFolder: {
      uri: vscode.Uri.file(sketchDir),
      name: path.basename(sketchDir),
      index: 0,
    },
  };
}

/**
 * Options for generating Arduino Language Server CLI arguments.
 */
export interface AlsArgsOptions {
  clangdPath: string;
  daemonPort: number;
  fqbnWithOptions: string;
  instanceId: number;
  jobs?: number;
  log?: boolean;
  logPath?: string;
}

/**
 * Builds the command line argument list for arduino-language-server.
 * Ensures daemon flags are used and never mixed with -cli or -cli-config.
 */
export function buildAlsArgs(options: AlsArgsOptions): string[] {
  const args: string[] = [
    "-cli-daemon-addr",
    `localhost:${options.daemonPort}`,
    "-cli-daemon-instance",
    `${options.instanceId}`,
    "-clangd",
    options.clangdPath,
    "-fqbn",
    options.fqbnWithOptions,
    "-jobs",
    `${options.jobs ?? 1}`,
  ];

  if (options.log) {
    args.push("-log");
    // ALS exits with a fatal error when -log is passed without -logpath
    args.push("-logpath", options.logPath ?? ".");
  }

  return args;
}

/**
 * Minimal interface representing a LanguageClient instance for testing.
 */
export interface ILanguageClient {
  dispose?(): void;
  sendNotification(type: unknown, params?: unknown): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type LanguageClientFactory = (
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions
) => ILanguageClient;

/**
 * Daemon connectivity provider callback.
 */
export interface DaemonInfo {
  instanceId: number | null;
  port: number | null;
}

/**
 * Feature that removes the semantic-tokens client capabilities.
 *
 * ALS 0.7.7 panics and exits when clangd sends the server-to-client request
 * `workspace/semanticTokens/refresh`, which it does whenever the client
 * declares `workspace.semanticTokens.refreshSupport` (arduino-language-server
 * issue #155, still open). ALS forwards the IDE's capabilities verbatim to
 * clangd, so scrubbing them here stops clangd from ever sending that request.
 * Semantic highlighting falls back to the TextMate grammar; completion, hover
 * and diagnostics are unaffected.
 */
function createSemanticTokensScrubFeature(): StaticFeature {
  return {
    getState: () => ({ kind: "static" }),
    clear: () => {},
    fillClientCapabilities: (capabilities: ClientCapabilities) => {
      const caps = capabilities as {
        workspace?: Record<string, unknown>;
        textDocument?: Record<string, unknown>;
      };
      // Assigning undefined (instead of delete) still drops the keys from
      // the JSON-serialized initialize params sent to ALS/clangd.
      if (caps.workspace) {
        caps.workspace.semanticTokens = undefined;
      }
      if (caps.textDocument) {
        caps.textDocument.semanticTokens = undefined;
      }
    },
    initialize: () => {},
  };
}

/**
 * Manages the lifecycle of arduino-language-server communicating via stdio
 * and connecting to the Arduino CLI daemon via gRPC.
 */
export class ArduinoLanguageServer implements vscode.Disposable {
  private client: ILanguageClient | null = null;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly storagePath: string;
  private readonly settings: ArduinoSettings;
  private readonly configStore: BoardConfigStore;
  private readonly binariesManager?: LanguageBinariesManager;
  private readonly getDaemonInfo: () => DaemonInfo;
  private readonly clientFactory: LanguageClientFactory;
  private readonly debounceMs: number;

  private currentFqbnWithOptions: string | null = null;
  private currentPort: number | null = null;
  private currentInstanceId: number | null = null;
  private currentSelection: BoardSelection | null = null;
  private pendingSketchDir: string | null = null;
  private startedSketchDir: string | null = null;
  private forceNextRestart = false;
  private resolvedAlsPath: string | null = null;
  private resolvedClangdPath: string | null = null;
  private readonly getLibraryDirs?: (fqbn: string) => Promise<string[]>;

  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingSelection: BoardSelection | null = null;
  private mutexChain: Promise<void> = Promise.resolve();
  private isServerRunning = false;

  private readonly _onDidChangeRunning = new vscode.EventEmitter<boolean>();
  readonly onDidChangeRunning: vscode.Event<boolean> =
    this._onDidChangeRunning.event;

  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly alsLogOutputChannel: vscode.LogOutputChannel;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(options: {
    alsLogOutputChannel?: vscode.LogOutputChannel;
    binariesManager?: LanguageBinariesManager;
    clientFactory?: LanguageClientFactory;
    configStore: BoardConfigStore;
    debounceMs?: number;
    getDaemonInfo: () => DaemonInfo;
    getLibraryDirs?: (fqbn: string) => Promise<string[]>;
    outputChannel: vscode.OutputChannel;
    settings: ArduinoSettings;
    storagePath: string;
  }) {
    this.outputChannel = options.outputChannel;
    this.storagePath = options.storagePath;
    this.settings = options.settings;
    this.configStore = options.configStore;
    this.binariesManager = options.binariesManager;
    this.getDaemonInfo = options.getDaemonInfo;
    this.getLibraryDirs = options.getLibraryDirs;
    this.debounceMs = options.debounceMs ?? 300;
    this.alsLogOutputChannel =
      options.alsLogOutputChannel ??
      vscode.window.createOutputChannel("Arduino Language Server", {
        log: true,
      });
    this.clientFactory =
      options.clientFactory ??
      ((serverOpts, clientOpts) => {
        const client = new LanguageClient(
          "arduino-language-server",
          "Arduino Language Server",
          serverOpts,
          clientOpts
        );
        // Must be registered after the built-in features: capabilities are
        // filled in registration order, so this one runs last and wins.
        client.registerFeature(createSemanticTokensScrubFeature());
        return client;
      });

    // Status bar indicator
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98
    );
    this.statusBarItem.command = "arduinoUnified.selectBoard";
    this.updateStatusBarNoBoard();
    this.statusBarItem.show();
    this.disposables.push(
      this.statusBarItem,
      this.alsLogOutputChannel,
      this._onDidChangeRunning
    );
  }

  /**
   * Sets pre-resolved binary paths.
   */
  setBinaries(alsPath: string, clangdPath: string): void {
    this.resolvedAlsPath = alsPath;
    this.resolvedClangdPath = clangdPath;
  }

  /**
   * Returns true if the language client is currently active.
   */
  isRunning(): boolean {
    return this.isServerRunning;
  }

  /**
   * Called when board or port selection changes.
   * Debounces selection changes (~300ms) and schedules a restart through the mutex.
   */
  handleSelectionChange(selection: BoardSelection): void {
    this.pendingSelection = selection;
    this.scheduleDebouncedApply();
  }

  /**
   * Called when the Arduino CLI daemon restarts with a new port and instance.
   */
  handleDaemonRestart(): void {
    this.outputChannel.appendLine(
      "[ALS] Daemon restarted. Restarting language server..."
    );
    this.currentPort = null;
    this.currentInstanceId = null;
    if (this.currentSelection) {
      this.scheduleApplySelection(this.currentSelection);
    }
  }

  /**
   * Called when the active sketch folder changes (different .ino focused).
   * ALS derives its whole build environment from the sketch root, so the
   * server must restart when it changes. Debounced like board selections.
   */
  handleSketchChange(sketchDir: string | null): void {
    this.pendingSketchDir = sketchDir;
    this.scheduleDebouncedApply();
  }

  /**
   * Called after libraries are installed or uninstalled. Forces a restart so
   * IntelliSense picks up the new headers even when board/port/sketch are
   * unchanged.
   */
  handleLibraryChange(): void {
    this.forceNextRestart = true;
    if (this.currentSelection) {
      this.scheduleApplySelection(this.currentSelection);
    }
  }

  /**
   * Tells ALS that a full build (Compile/Verify) finished so it can refresh
   * library discovery from the build output. No-op when IntelliSense is off.
   */
  notifyBuildCompleted(buildOutputPath: string): void {
    if (!(this.isServerRunning && this.client)) {
      return;
    }
    this.client.sendNotification(DidCompleteBuildNotification, {
      buildOutputUri: vscode.Uri.file(buildOutputPath).toString(),
    });
    this.outputChannel.appendLine(
      `[ALS] Full build finished; ALS will refresh libraries from ${buildOutputPath}`
    );
  }

  /**
   * Debounces board/sketch changes (~300ms) and schedules one apply through
   * the mutex chain, so bursts of events coalesce into a single restart.
   */
  private scheduleDebouncedApply(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const selection = this.pendingSelection;
      if (selection) {
        this.scheduleApplySelection(selection);
      }
    }, this.debounceMs);
  }

  /**
   * Schedules an applySelection execution through the serialized mutex chain.
   */
  scheduleApplySelection(selection: BoardSelection): Promise<void> {
    this.currentSelection = selection;
    this.mutexChain = this.mutexChain
      .then(async () => {
        await this.applySelection(selection);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[ALS Error] ${message}`);
      });
    return this.mutexChain;
  }

  /**
   * Applies the selection under mutex: stops existing server if needed,
   * validates FQBN and daemon availability, and starts ALS.
   */
  private async applySelection(selection: BoardSelection): Promise<void> {
    const fqbn = selection.fqbn?.trim();

    // No board / FQBN -> no server
    if (!fqbn) {
      this.outputChannel.appendLine(
        "[ALS] No board selected for IntelliSense. Server stopped."
      );
      await this.stop();
      this.updateStatusBarNoBoard();
      return;
    }

    // ALS compiles the sketch folder to build its environment (include paths
    // for core + libraries); without a sketch there is nothing to attach to.
    const sketchDir = this.pendingSketchDir;
    if (!sketchDir) {
      this.outputChannel.appendLine(
        "[ALS] No sketch open for IntelliSense. Server stopped."
      );
      await this.stop();
      this.updateStatusBarNoSketch();
      return;
    }

    const fqbnWithOptions = this.configStore.getFqbnWithOptions(fqbn);
    const daemonInfo = this.getDaemonInfo();

    if (
      daemonInfo.port === null ||
      daemonInfo.instanceId === null ||
      daemonInfo.port <= 0
    ) {
      this.outputChannel.appendLine(
        "[ALS] Arduino CLI daemon not ready yet. Postponing start."
      );
      this.updateStatusBarWaiting("Waiting for CLI daemon...");
      return;
    }

    const libraryDirs = await this.resolveLibraryDirs(fqbnWithOptions);

    // Arduino requires the main .ino to match its folder name; the bootstrap
    // compile inside ALS fails otherwise, so validate before launching.
    const mainFile = path.join(sketchDir, `${path.basename(sketchDir)}.ino`);
    try {
      await fs.promises.access(mainFile, fs.constants.F_OK);
    } catch {
      this.outputChannel.appendLine(
        `[ALS] Sketch main file not found: ${mainFile}. Not starting IntelliSense.`
      );
      this.updateStatusBarWaiting("Sketch folder must match its .ino file");
      return;
    }

    // If already running with the exact same configuration, skip restart
    if (
      this.isServerRunning &&
      !this.forceNextRestart &&
      this.currentFqbnWithOptions === fqbnWithOptions &&
      this.currentPort === daemonInfo.port &&
      this.currentInstanceId === daemonInfo.instanceId &&
      this.startedSketchDir === sketchDir
    ) {
      return;
    }
    this.forceNextRestart = false;

    // Stop current server if running
    if (this.client) {
      await this.stop();
    }

    // Resolve binaries if not already resolved
    let alsPath = this.resolvedAlsPath;
    let clangdPath = this.resolvedClangdPath;

    if (!(alsPath && clangdPath) && this.binariesManager) {
      const paths = await this.binariesManager.resolveBinaries();
      alsPath = paths.alsPath;
      clangdPath = paths.clangdPath;
    }

    if (!(alsPath && clangdPath)) {
      this.outputChannel.appendLine(
        "[ALS] Language binaries (ALS or Clangd) not resolved. Cannot start IntelliSense."
      );
      this.updateStatusBarWaiting("Language binaries not ready");
      return;
    }

    // Check for conflicting extensions
    checkClangdConflict();

    // Build args and launch
    const logPath = path.join(this.storagePath, "logs");
    if (this.settings.languageServerLog) {
      // ALS writes inols*.log here and requires the directory to exist
      await fs.promises.mkdir(logPath, { recursive: true });
    }
    const args = buildAlsArgs({
      daemonPort: daemonInfo.port,
      instanceId: daemonInfo.instanceId,
      clangdPath,
      fqbnWithOptions,
      jobs: 1,
      log: this.settings.languageServerLog,
      logPath,
    });

    this.outputChannel.appendLine(
      `[ALS] Starting with args: ${args.join(" ")}`
    );

    const serverOptions: ServerOptions = {
      command: alsPath,
      args,
      // NOTE: do NOT set `transport: TransportKind.stdio` here. For explicit
      // stdio transports vscode-languageclient appends `--stdio` to the spawn
      // args (a flag for node-based LSP servers), which makes the Go-based
      // ALS exit instantly with "flag provided but not defined: -stdio".
      // Leaving transport undefined spawns the executable over stdio without
      // injecting the flag.
    };

    const clientOptions = buildClientOptions(
      this.alsLogOutputChannel,
      sketchDir,
      libraryDirs
    );

    try {
      this.client = this.clientFactory(serverOptions, clientOptions);
      await this.client.start();
      this.isServerRunning = true;
      this.currentFqbnWithOptions = fqbnWithOptions;
      this.currentPort = daemonInfo.port;
      this.currentInstanceId = daemonInfo.instanceId;
      this.startedSketchDir = sketchDir;
      this.updateStatusBarRunning(fqbnWithOptions);
      this._onDidChangeRunning.fire(true);
      this.outputChannel.appendLine(
        `[ALS] Arduino Language Server started for ${fqbnWithOptions}`
      );
    } catch (error) {
      this.isServerRunning = false;
      this.client = null;
      this._onDidChangeRunning.fire(false);
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[ALS] Failed to start: ${message}`);
      this.updateStatusBarWaiting("IntelliSense start error");
    }
  }

  /**
   * Stops the language server cleanly.
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.client) {
      try {
        await this.client.stop();
      } catch (error) {
        this.outputChannel.appendLine(`[ALS] Error stopping client: ${error}`);
      }
      this.client = null;
    }

    this.isServerRunning = false;
    this.currentFqbnWithOptions = null;
    this.startedSketchDir = null;
    this._onDidChangeRunning.fire(false);
  }

  /**
   * Resolves folders holding library sources (sketchbook + board platform
   * libraries) so C/C++ IntelliSense can be scoped to them.
   */
  private async resolveLibraryDirs(fqbn: string): Promise<string[]> {
    if (!this.getLibraryDirs) {
      return [];
    }
    try {
      const dirs = await this.getLibraryDirs(fqbn);
      return dirs.filter((dir) => dir.trim().length > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(
        `[ALS] Failed to resolve library directories: ${message}`
      );
      return [];
    }
  }

  private updateStatusBarNoBoard(): void {
    this.statusBarItem.text = "$(warning) Select a board for IntelliSense";
    this.statusBarItem.tooltip =
      "Select an Arduino board to start IntelliSense completion, hover, and diagnostics";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
  }

  private updateStatusBarNoSketch(): void {
    this.statusBarItem.text = "$(info) Open a sketch for IntelliSense";
    this.statusBarItem.tooltip =
      "Open an Arduino sketch (.ino) so the language server can resolve its libraries";
    this.statusBarItem.backgroundColor = undefined;
  }

  private updateStatusBarRunning(fqbn: string): void {
    this.statusBarItem.text = "$(check) IntelliSense: Ready";
    this.statusBarItem.tooltip = `Arduino Language Server active for ${fqbn}`;
    this.statusBarItem.backgroundColor = undefined;
  }

  private updateStatusBarWaiting(message: string): void {
    this.statusBarItem.text = `$(sync~spin) IntelliSense: ${message}`;
    this.statusBarItem.tooltip = message;
    this.statusBarItem.backgroundColor = undefined;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.stop().catch(() => {});
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
