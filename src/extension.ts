import * as path from "node:path";
import * as vscode from "vscode";
import { registerChatParticipant } from "./ai/chat-participant";
import { registerCodeActions } from "./ai/code-actions";
import { registerChatTools } from "./ai/tools";
import { BoardConfigStore } from "./boards/config-store";
import { BoardDiscoveryService } from "./boards/discovery";
import { BoardSelector } from "./boards/selector";
import { ArduinoDaemon } from "./cli/daemon";
import { ArduinoCliDownloader } from "./cli/downloader";
import { ArduinoGrpcClient } from "./cli/grpc-client";
import {
  checkVersionCompatibility,
  formatVersionDisplay,
  getSupportedVersionRange,
} from "./cli/version";
import { registerCompileCommands } from "./commands/compile";
import { registerUploadCommands } from "./commands/upload";
import { ArduinoCliConfig } from "./config/cli-config";
import { ArduinoSettings } from "./config/settings";
import { ArduinoDebugProvider } from "./debug/debug-provider";
import { ArduinoFormatter } from "./format/formatter";
import { LanguageBinariesManager } from "./language/binaries";
import { registerLanguageSupport } from "./language/language-client";
import { ArduinoLanguageServer } from "./language/server";
import { LibraryManager } from "./libraries/manager";
import { ArduinoSerialMonitor } from "./monitor/serial-monitor";
import { PlatformManager } from "./platforms/manager";
import { registerSketchCommands } from "./sketches/commands";
import {
  resolveActiveSketchDir,
  SketchService,
} from "./sketches/sketch-service";
import { WebviewProvider } from "./webview/webview-provider";

/**
 * Arduino Unified extension activation.
 * Initializes all services, registers commands synchronously, and starts background daemon init.
 */
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // ── Output Channel ────────────────────────────────────────
  const outputChannel = vscode.window.createOutputChannel("Arduino Unified");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("Arduino Unified is activating...");

  // ── Settings ──────────────────────────────────────────────
  const settings = new ArduinoSettings();

  // ── Storage Path ──────────────────────────────────────────
  const storagePath = context.globalStorageUri.fsPath;

  // ── CLI Downloader & Config ────────────────────────────────
  const downloader = new ArduinoCliDownloader(outputChannel, storagePath);
  const cliConfig = new ArduinoCliConfig(outputChannel, settings, storagePath);

  // ── Daemon & gRPC Client ──────────────────────────────────
  const daemon = new ArduinoDaemon(outputChannel);
  const grpcClient = new ArduinoGrpcClient(outputChannel);

  context.subscriptions.push({
    dispose: () => {
      grpcClient.disconnect();
      daemon.stop();
    },
  });

  // ── Diagnostics ───────────────────────────────────────────
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("arduino");
  context.subscriptions.push(diagnosticCollection);

  // ── Board Discovery, Selector & Store ─────────────────────
  const discovery = new BoardDiscoveryService(outputChannel);
  context.subscriptions.push({ dispose: () => discovery.dispose() });

  const boardSelector = new BoardSelector(outputChannel, discovery);
  context.subscriptions.push(boardSelector);

  const configStore = new BoardConfigStore(context.globalState);

  // ── Webview Provider & Core Services ──────────────────────
  const webviewProvider = new WebviewProvider(context);
  const sketchService = new SketchService(outputChannel, grpcClient, settings);
  const libraryManager = new LibraryManager(
    outputChannel,
    grpcClient,
    discovery,
    webviewProvider
  );
  context.subscriptions.push(libraryManager);
  const platformManager = new PlatformManager(
    outputChannel,
    grpcClient,
    discovery,
    webviewProvider
  );
  const serialMonitor = new ArduinoSerialMonitor(
    outputChannel,
    grpcClient,
    boardSelector,
    settings
  );
  const debugProvider = new ArduinoDebugProvider(
    outputChannel,
    grpcClient,
    boardSelector,
    configStore
  );

  context.subscriptions.push(serialMonitor);
  context.subscriptions.push(debugProvider);

  // ── CLI Version Status Bar ────────────────────────────────
  const versionStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  versionStatusBar.command = "arduinoUnified.showOutput";
  context.subscriptions.push(versionStatusBar);

  // ── Synchronous Command Registrations ──────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.showOutput", () => {
      outputChannel.show();
    }),
    vscode.commands.registerCommand(
      "arduinoUnified.installLibrary",
      async () => {
        await libraryManager.openWebview();
      }
    ),
    vscode.commands.registerCommand(
      "arduinoUnified.installPlatform",
      async () => {
        await platformManager.openWebview();
      }
    ),
    vscode.commands.registerCommand(
      "arduinoUnified.openSerialPlotter",
      async () => {
        await serialMonitor.openPlotterWebview(webviewProvider);
      }
    )
  );

  registerUploadCommands(
    context,
    grpcClient,
    boardSelector,
    configStore,
    settings,
    discovery,
    outputChannel,
    diagnosticCollection
  );
  registerSketchCommands(context, sketchService);

  // Language Server, Support & Formatter
  registerLanguageSupport(context);
  const binariesManager = new LanguageBinariesManager(
    storagePath,
    settings,
    outputChannel
  );
  const languageServer = new ArduinoLanguageServer({
    storagePath,
    settings,
    configStore,
    outputChannel,
    binariesManager,
    getDaemonInfo: () => ({
      port: daemon.getPort(),
      instanceId: grpcClient.getInstanceId(),
    }),
    // Scope C/C++ IntelliSense to sketchbook + board platform library
    // folders so ALS serves library headers without stealing C/C++ files
    // from unrelated projects in the same workspace.
    getLibraryDirs: async (fqbn: string) => {
      const dirs: string[] = [];
      const [packager, architecture] = fqbn.split(":");
      const sketchbookDir = cliConfig.getDefaultSketchbookDir();
      if (sketchbookDir) {
        dirs.push(path.join(sketchbookDir, "libraries"));
      }
      if (packager && architecture) {
        dirs.push(
          path.join(
            cliConfig.getDefaultDataDir(),
            "packages",
            packager,
            "hardware",
            architecture
          )
        );
      }
      return dirs;
    },
  });
  context.subscriptions.push(languageServer);

  // Restart IntelliSense when libraries are installed/uninstalled
  libraryManager.onDidChangeLibraries(() => {
    languageServer.handleLibraryChange();
  });

  // Track the active sketch folder so IntelliSense follows the edited .ino
  const updateIntelliSenseSketch = (): void => {
    resolveActiveSketchDir()
      .then((sketchDir) => {
        languageServer.handleSketchChange(sketchDir);
      })
      .catch(() => {
        // Sketch resolution is best-effort; keep current state on failure.
      });
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateIntelliSenseSketch();
    })
  );

  // Compile commands need the language server to report `ino/didCompleteBuild`
  registerCompileCommands(
    context,
    grpcClient,
    boardSelector,
    configStore,
    settings,
    outputChannel,
    diagnosticCollection,
    languageServer
  );

  const formatter = new ArduinoFormatter(
    outputChannel,
    settings,
    storagePath,
    () => languageServer.isRunning()
  );
  context.subscriptions.push(formatter);

  boardSelector.onDidChangeSelection((selection) => {
    languageServer.handleSelectionChange(selection);
  });
  registerCodeActions(context);

  // AI Features
  registerChatParticipant(
    context,
    grpcClient,
    boardSelector,
    libraryManager,
    serialMonitor
  );
  registerChatTools(
    context,
    grpcClient,
    boardSelector,
    libraryManager,
    serialMonitor
  );

  // Settings Change Handler
  context.subscriptions.push(
    settings.onDidChange(async (e) => {
      try {
        if (
          e.affectsConfiguration(
            "arduinoUnified.boardManager.additionalUrls"
          ) ||
          e.affectsConfiguration("arduinoUnified.sketchbook.path")
        ) {
          outputChannel.appendLine("[Config] Settings changed, syncing...");
          await cliConfig.syncToCliDaemon(grpcClient);
          await grpcClient.initInstance();
        }

        if (e.affectsConfiguration("arduinoUnified.cli.path")) {
          const response = await vscode.window.showInformationMessage(
            "CLI path changed. Reload window to apply?",
            "Reload"
          );
          if (response === "Reload") {
            await vscode.commands.executeCommand(
              "workbench.action.reloadWindow"
            );
          }
        }
      } catch (err) {
        outputChannel.appendLine(`[Config Error] ${err}`);
      }
    })
  );

  // ── Background Daemon & CLI Initialization ────────────────
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: "Arduino Unified: Initializing...",
    },
    async (progress) => {
      try {
        const cliPath = await resolveCliPath(settings, downloader, progress);

        if (!cliPath) {
          outputChannel.appendLine(
            "[Init] Arduino CLI not configured. Extension will have limited functionality."
          );
          versionStatusBar.text = "$(warning) Arduino CLI: Not installed";
          versionStatusBar.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground"
          );
          versionStatusBar.show();
          return;
        }

        progress.report({ message: "Starting Arduino CLI daemon..." });
        const configPath = await cliConfig.ensureConfigFile();
        const port = await daemon.start(cliPath, configPath);

        progress.report({ message: "Connecting to CLI..." });
        await grpcClient.connect(port);

        const versionString = await grpcClient.getVersion();
        const versionInfo = checkVersionCompatibility(versionString);

        if (versionInfo.compatible) {
          outputChannel.appendLine(`[Init] ${versionInfo.message}`);
          versionStatusBar.text = formatVersionDisplay(versionInfo);
          versionStatusBar.tooltip = `Arduino CLI version ${versionString}\nSupported: ${getSupportedVersionRange()}`;
          versionStatusBar.show();
        } else {
          outputChannel.appendLine(`[Init] WARNING: ${versionInfo.message}`);
          versionStatusBar.text = formatVersionDisplay(versionInfo);
          versionStatusBar.backgroundColor = new vscode.ThemeColor(
            "statusBarItem.warningBackground"
          );
          versionStatusBar.tooltip = `${versionInfo.message}\nSupported: ${getSupportedVersionRange()}`;
          versionStatusBar.show();

          await vscode.window
            .showWarningMessage(
              versionInfo.message,
              "Continue Anyway",
              "Download Compatible Version"
            )
            .then(async (action) => {
              if (action === "Download Compatible Version") {
                const newPath = await downloader.download(undefined, progress);
                await settings.update("cli.path", newPath);
                await vscode.commands.executeCommand(
                  "workbench.action.reloadWindow"
                );
              }
            });
        }

        progress.report({ message: "Initializing Arduino Core..." });
        await grpcClient.createInstance();
        await grpcClient.initInstance((progressData) => {
          const taskProgress = progressData as { name?: string };
          if (taskProgress.name) {
            progress.report({ message: taskProgress.name });
          }
        });

        await cliConfig.syncToCliDaemon(grpcClient);
        discovery.startWatching(grpcClient);

        // ── Resolve Language Server & Clangd ──────────────────────
        await resolveAndStartLanguageServer(
          binariesManager,
          languageServer,
          boardSelector,
          settings,
          outputChannel,
          progress
        );

        daemon.on("exit", async (code: number) => {
          try {
            await languageServer.stop();
            if (code !== 0) {
              const action = await vscode.window.showErrorMessage(
                `Arduino CLI daemon exited unexpectedly (code ${code}).`,
                "Restart",
                "Show Output"
              );
              if (action === "Restart") {
                const newPort = await daemon.restart(cliPath, configPath);
                await grpcClient.connect(newPort);
                await grpcClient.createInstance();
                await grpcClient.initInstance();
                discovery.startWatching(grpcClient);
                languageServer.handleDaemonRestart();
              } else if (action === "Show Output") {
                outputChannel.show();
              }
            }
          } catch (exitErr) {
            outputChannel.appendLine(
              `[Daemon Exit Error] Restart attempt failed: ${exitErr}`
            );
          }
        });

        outputChannel.appendLine("Arduino Unified activated successfully! 🚀");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Init] Activation error: ${message}`);
        versionStatusBar.text = "$(error) Arduino CLI: Error";
        versionStatusBar.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground"
        );
        versionStatusBar.show();

        vscode.window
          .showErrorMessage(
            `Arduino Unified failed to initialize: ${message}`,
            "Show Output",
            "Retry"
          )
          .then(async (action) => {
            if (action === "Show Output") {
              outputChannel.show();
            } else if (action === "Retry") {
              await vscode.commands.executeCommand(
                "workbench.action.reloadWindow"
              );
            }
          });
      }
    }
  );
}

/**
 * Extension deactivation — cleanup is handled by disposables.
 */
export function deactivate(): void {
  // Disposables handle cleanup
}

/**
 * Resolves the Arduino CLI binary path, downloading or prompting if missing.
 */
async function resolveCliPath(
  settings: ArduinoSettings,
  downloader: ArduinoCliDownloader,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | null> {
  if (settings.cliPath) {
    return settings.cliPath;
  }

  if (await downloader.isCliInstalled()) {
    return downloader.getCliBinaryPath();
  }

  progress.report({ message: "Downloading Arduino CLI..." });
  const shouldInstall = await vscode.window.showInformationMessage(
    "Arduino CLI is not installed. Would you like to download it?",
    "Download",
    "Set Path Manually"
  );

  if (shouldInstall === "Download") {
    return downloader.download(settings.cliVersion, progress);
  }

  if (shouldInstall === "Set Path Manually") {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Select arduino-cli binary",
    });
    if (uri?.[0]) {
      const selectedPath = uri[0].fsPath;
      await settings.update("cli.path", selectedPath);
      return selectedPath;
    }
  }

  return null;
}

/**
 * Resolves ALS and Clangd binaries, downloading or prompting if needed, and starts IntelliSense.
 */
async function resolveAndStartLanguageServer(
  binariesManager: LanguageBinariesManager,
  languageServer: ArduinoLanguageServer,
  boardSelector: BoardSelector,
  settings: ArduinoSettings,
  outputChannel: vscode.OutputChannel,
  progress: vscode.Progress<{ message?: string; increment?: number }>
): Promise<void> {
  progress.report({ message: "Resolving Language Server & Clangd..." });
  let alsPath = await binariesManager.als.resolvePath();
  let clangdPath = await binariesManager.clangd.resolvePath();

  if (!(alsPath && clangdPath)) {
    const shouldDownload = await vscode.window.showInformationMessage(
      "Arduino Language Server and Clangd are required for real IntelliSense. Would you like to download them?",
      "Download",
      "Set Paths Manually"
    );

    if (shouldDownload === "Download") {
      progress.report({ message: "Downloading language tools..." });
      const resolved = await binariesManager.ensureBinaries(progress);
      alsPath = resolved.alsPath;
      clangdPath = resolved.clangdPath;
    } else if (shouldDownload === "Set Paths Manually") {
      if (!alsPath) {
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          openLabel: "Select arduino-language-server binary",
        });
        if (uri?.[0]) {
          alsPath = uri[0].fsPath;
          await settings.update("languageServer.path", alsPath);
        }
      }
      if (!clangdPath) {
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          openLabel: "Select clangd binary",
        });
        if (uri?.[0]) {
          clangdPath = uri[0].fsPath;
          await settings.update("clangd.path", clangdPath);
        }
      }
    }
  }

  if (alsPath && clangdPath) {
    languageServer.setBinaries(alsPath, clangdPath);
    // IntelliSense compiles the sketch folder, so it must know the sketch
    // before the first board-driven start.
    const sketchDir = await resolveActiveSketchDir();
    languageServer.handleSketchChange(sketchDir);
    languageServer.handleSelectionChange(boardSelector.getSelection());
  } else {
    outputChannel.appendLine(
      "[Init] Language server or clangd not configured. IntelliSense will be unavailable."
    );
  }
}
