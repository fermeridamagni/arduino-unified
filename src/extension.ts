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
import { registerLanguageSupport } from "./language/language-client";
import { LibraryManager } from "./libraries/manager";
import { ArduinoSerialMonitor } from "./monitor/serial-monitor";
import { PlatformManager } from "./platforms/manager";
import { registerSketchCommands } from "./sketches/commands";
import { SketchService } from "./sketches/sketch-service";
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

  registerCompileCommands(
    context,
    grpcClient,
    boardSelector,
    configStore,
    settings,
    outputChannel,
    diagnosticCollection
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

  // Language Support & Formatter
  registerLanguageSupport(context);
  const formatter = new ArduinoFormatter(outputChannel, settings);
  context.subscriptions.push(formatter);
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
        let cliPath = settings.cliPath;

        if (!cliPath) {
          if (await downloader.isCliInstalled()) {
            cliPath = downloader.getCliBinaryPath();
          } else {
            progress.report({ message: "Downloading Arduino CLI..." });

            const shouldInstall = await vscode.window.showInformationMessage(
              "Arduino CLI is not installed. Would you like to download it?",
              "Download",
              "Set Path Manually"
            );

            if (shouldInstall === "Download") {
              cliPath = await downloader.download(
                settings.cliVersion,
                progress
              );
            } else if (shouldInstall === "Set Path Manually") {
              const uri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: "Select arduino-cli binary",
              });
              if (uri?.[0]) {
                cliPath = uri[0].fsPath;
                await settings.update("cli.path", cliPath);
              }
            }
          }
        }

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

        daemon.on("exit", async (code: number) => {
          try {
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
