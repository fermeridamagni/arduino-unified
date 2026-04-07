import * as vscode from "vscode";
import type { BoardConfigStore } from "../boards/config-store";
import type { BoardSelector } from "../boards/selector";
import type { ArduinoGrpcClient } from "../cli/grpc-client";

/**
 * ArduinoDebugProvider integrates Arduino debugging via the cortex-debug
 * extension and Arduino CLI's debug support.
 */
export class ArduinoDebugProvider implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly client: ArduinoGrpcClient;
  private readonly selector: BoardSelector;
  private readonly configStore: BoardConfigStore;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    outputChannel: vscode.OutputChannel,
    client: ArduinoGrpcClient,
    selector: BoardSelector,
    configStore: BoardConfigStore
  ) {
    this.outputChannel = outputChannel;
    this.client = client;
    this.selector = selector;
    this.configStore = configStore;

    this.registerCommands();
    this.registerDebugConfigProvider();
  }

  /**
   * Checks if debugging is supported for the current board.
   */
  async isDebugSupported(): Promise<boolean> {
    const selection = this.selector.getSelection();
    if (!selection.fqbn) {
      return false;
    }

    try {
      const result = await this.client.isDebugSupported(
        selection.fqbn,
        selection.port
          ? {
              address: selection.portAddress,
              protocol: selection.port.protocol,
            }
          : undefined,
        this.configStore.getProgrammer(selection.fqbn)
      );
      return result.debuggingSupported;
    } catch {
      return false;
    }
  }

  /**
   * Generates a debug configuration from the CLI.
   */
  async generateDebugConfig(
    sketchPath: string
  ): Promise<vscode.DebugConfiguration | null> {
    const selection = this.selector.getSelection();

    if (!(selection.fqbn && selection.portAddress)) {
      await vscode.window.showErrorMessage(
        "Please select a board and port before debugging."
      );
      return null;
    }

    try {
      const debugInfo = await this.client.getDebugConfig(
        sketchPath,
        this.configStore.getFqbnWithOptions(selection.fqbn),
        {
          address: selection.portAddress,
          protocol: selection.port?.protocol ?? "serial",
        },
        this.configStore.getProgrammer(selection.fqbn)
      );

      const toolchain = (debugInfo.toolchain ?? "") as string;
      const executable = (debugInfo.executable ?? "") as string;
      const serverPath = (debugInfo.server ?? "") as string;
      const serverConfig = (debugInfo.serverConfiguration ?? {}) as Record<
        string,
        unknown
      >;

      // Generate cortex-debug compatible launch configuration
      const config: vscode.DebugConfiguration = {
        type: "cortex-debug",
        request: "launch",
        name: `Arduino Debug (${selection.board?.name ?? selection.fqbn})`,
        executable,
        servertype: this.mapServerType(serverPath),
        device: (debugInfo.device ?? "") as string,
        interface: "swd",
        toolchainPrefix: this.getToolchainPrefix(toolchain),
        serverpath: serverPath,
        serverArgs: (serverConfig.additionalArgs ?? []) as string[],
        gdbPath: (debugInfo.toolchainPath ?? "") as string,
        svdFile: (debugInfo.svdFile ?? "") as string,
      };

      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(
        `[Debug] Failed to get debug config: ${message}`
      );
      return null;
    }
  }

  /**
   * Disposes resources
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /**
   * Registers debug commands.
   */
  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand("arduinoUnified.startDebug", async () => {
        const supported = await this.isDebugSupported();
        if (!supported) {
          await vscode.window.showErrorMessage(
            "Debug is not supported for the selected board/programmer combination."
          );
          return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          await vscode.window.showErrorMessage("No workspace folder open.");
          return;
        }

        const config = await this.generateDebugConfig(
          workspaceFolder.uri.fsPath
        );
        if (config) {
          await vscode.debug.startDebugging(workspaceFolder, config);
        }
      })
    );

    this.disposables.push(
      vscode.commands.registerCommand(
        "arduinoUnified.checkDebugSupport",
        async () => {
          const supported = await this.isDebugSupported();
          if (supported) {
            await vscode.window.showInformationMessage(
              "Debug is supported for the selected board! 🎉"
            );
          } else {
            await vscode.window.showWarningMessage(
              "Debug is not supported for the selected board/programmer combination."
            );
          }
        }
      )
    );
  }

  /**
   * Registers a debug configuration provider that auto-generates configs.
   */
  private registerDebugConfigProvider(): void {
    this.disposables.push(
      vscode.debug.registerDebugConfigurationProvider("cortex-debug", {
        provideDebugConfigurations: async () => {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            return [];
          }

          const config = await this.generateDebugConfig(
            workspaceFolder.uri.fsPath
          );
          return config ? [config] : [];
        },
        resolveDebugConfiguration: async (_folder, config) => {
          // If no config is provided, generate one
          if (!(config.type || config.request || config.name)) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
              const generated = await this.generateDebugConfig(
                workspaceFolder.uri.fsPath
              );
              if (generated) {
                return generated;
              }
            }
          }
          return config;
        },
      })
    );
  }

  /**
   * Maps a debug server path to a cortex-debug server type.
   */
  private mapServerType(serverPath: string): string {
    if (serverPath.includes("openocd")) {
      return "openocd";
    }
    if (serverPath.includes("jlink") || serverPath.includes("JLink")) {
      return "jlink";
    }
    if (serverPath.includes("stutil") || serverPath.includes("st-util")) {
      return "stutil";
    }
    return "openocd";
  }

  /**
   * Gets the GCC toolchain prefix from toolchain type.
   */
  private getToolchainPrefix(toolchain: string): string {
    if (toolchain.includes("arm")) {
      return "arm-none-eabi";
    }
    if (toolchain.includes("riscv")) {
      return "riscv32-unknown-elf";
    }
    return "arm-none-eabi";
  }
}
