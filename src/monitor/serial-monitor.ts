import * as vscode from "vscode";
import type { BoardSelector } from "../boards/selector";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { ArduinoSettings, LineEnding } from "../config/settings";
import type { WebviewProvider } from "../webview/webview-provider";

/**
 * Line ending byte sequences.
 */
const LINE_ENDINGS: Record<LineEnding, string> = {
  none: "",
  nl: "\n",
  cr: "\r",
  nlcr: "\r\n",
};

/**
 * ArduinoSerialMonitor implements a VSCode pseudo-terminal for serial communication.
 * Uses the gRPC Monitor streaming RPC to communicate with Arduino boards.
 */
export class ArduinoSerialMonitor implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly client: ArduinoGrpcClient;
  private readonly selector: BoardSelector;
  private readonly settings: ArduinoSettings;
  private readonly disposables: vscode.Disposable[] = [];

  private terminal: vscode.Terminal | null = null;
  private writeEmitter: vscode.EventEmitter<string> | null = null;
  private monitorConnection: {
    write: (data: Uint8Array) => void;
    onData: (callback: (data: Uint8Array) => void) => void;
    cancel: () => void;
  } | null = null;
  private connected = false;
  private paused = false;
  private currentWebviewPanel?: vscode.WebviewPanel;

  /** Stores recent serial output for AI analysis */
  private outputBuffer: string[] = [];
  private readonly maxBufferLines = 500;

  constructor(
    outputChannel: vscode.OutputChannel,
    client: ArduinoGrpcClient,
    selector: BoardSelector,
    settings: ArduinoSettings
  ) {
    this.outputChannel = outputChannel;
    this.client = client;
    this.selector = selector;
    this.settings = settings;

    this.registerCommands();
  }

  /**
   * Opens the serial monitor terminal and connects to the board.
   */
  async connect(): Promise<void> {
    const selection = this.selector.getSelection();

    if (!selection.portAddress) {
      await vscode.window.showErrorMessage(
        "No port selected. Please select a port first."
      );
      return;
    }

    if (!selection.fqbn) {
      await vscode.window.showErrorMessage(
        "No board selected. Please select a board first."
      );
      return;
    }

    // Close existing terminal
    this.disconnect();

    const writeEmitter = new vscode.EventEmitter<string>();
    this.writeEmitter = writeEmitter;

    const baudRate = this.settings.monitorBaudRate;

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        writeEmitter.fire(
          "\x1b[1;34m── Arduino Serial Monitor ──\x1b[0m\r\n" +
            `\x1b[90mPort: ${selection.portAddress} | Baud: ${baudRate}\x1b[0m\r\n` +
            "\x1b[90mPress Ctrl+C to disconnect\x1b[0m\r\n\r\n"
        );
        this.startMonitor(selection.portAddress, selection.fqbn, baudRate);
      },
      close: () => {
        this.disconnect();
      },
      handleInput: (data: string) => {
        this.handleInput(data);
      },
    };

    this.terminal = vscode.window.createTerminal({
      name: `Serial Monitor (${selection.portAddress})`,
      pty,
      iconPath: new vscode.ThemeIcon("plug"),
    });

    this.terminal.show();
    vscode.commands.executeCommand(
      "setContext",
      "arduinoUnified.serialMonitorOpen",
      true
    );
  }

  /**
   * Disconnects the serial monitor.
   */
  disconnect(): void {
    if (this.monitorConnection) {
      this.monitorConnection.cancel();
      this.monitorConnection = null;
    }
    this.connected = false;
    this.writeEmitter?.fire("\r\n\x1b[1;33m── Disconnected ──\x1b[0m\r\n");
    this.writeEmitter = null;
    vscode.commands.executeCommand(
      "setContext",
      "arduinoUnified.serialMonitorOpen",
      false
    );
  }

  /**
   * Pauses the monitor (used during uploads).
   */
  pause(): void {
    if (this.connected) {
      this.paused = true;
      this.monitorConnection?.cancel();
      this.monitorConnection = null;
      this.connected = false;
      this.writeEmitter?.fire(
        "\r\n\x1b[90m── Monitor paused for upload ──\x1b[0m\r\n"
      );
    }
  }

  /**
   * Resumes the monitor after a pause.
   */
  async resume(): Promise<void> {
    if (this.paused && this.writeEmitter) {
      this.paused = false;
      const selection = this.selector.getSelection();
      if (selection.portAddress && selection.fqbn) {
        this.writeEmitter.fire("\x1b[90m── Monitor resuming... ──\x1b[0m\r\n");
        // Small delay to let the board reinitialize
        await new Promise((resolve) => setTimeout(resolve, 2000));
        this.startMonitor(
          selection.portAddress,
          selection.fqbn,
          this.settings.monitorBaudRate
        );
      }
    }
  }

  /**
   * Returns the recent serial output buffer (for AI analysis).
   */
  getRecentOutput(): string[] {
    return [...this.outputBuffer];
  }

  /**
   * Returns whether the monitor is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disposes all resources.
   */
  dispose(): void {
    this.disconnect();
    this.terminal?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /**
   * Writes data to the serial monitor (e.g. from Plotter).
   */
  write(data: string): void {
    if (this.connected && this.monitorConnection) {
      const encoded = new TextEncoder().encode(data);
      this.monitorConnection.write(encoded);
    }
  }

  /**
   * Registers serial monitor commands.
   */
  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand("arduinoUnified.openSerialMonitor", () =>
        this.connect()
      )
    );

    this.disposables.push(
      vscode.commands.registerCommand("arduinoUnified.closeSerialMonitor", () =>
        this.disconnect()
      )
    );

    this.disposables.push(
      vscode.commands.registerCommand("arduinoUnified.monitor.pause", () =>
        this.pause()
      )
    );

    this.disposables.push(
      vscode.commands.registerCommand("arduinoUnified.monitor.resume", () =>
        this.resume()
      )
    );

    this.disposables.push(
      vscode.commands.registerCommand("arduinoUnified.changeBaudRate", () =>
        this.changeBaudRate()
      )
    );

    vscode.commands.executeCommand(
      "setContext",
      "arduinoUnified.serialMonitorOpen",
      false
    );
  }

  /**
   * Opens the Serial Plotter Webview and attaches it for data stream relay.
   */
  openPlotterWebview(webviewProvider: WebviewProvider) {
    if (!this.connected) {
      vscode.window.showWarningMessage(
        "Open the Serial Monitor and start a stream to use the Plotter."
      );
    }

    this.currentWebviewPanel = webviewProvider.openWebview(
      "arduinoUnified.serialPlotter",
      "Arduino: Serial Plotter",
      "plotter",
      vscode.ViewColumn.Two
    );

    this.currentWebviewPanel.onDidDispose(() => {
      this.currentWebviewPanel = undefined;
    });

    return this.currentWebviewPanel;
  }

  /**
   * Starts the gRPC monitor connection.
   */
  private startMonitor(
    portAddress: string,
    fqbn: string,
    baudRate: number
  ): void {
    try {
      this.monitorConnection = this.client.openMonitor(
        { address: portAddress, protocol: "serial" },
        fqbn,
        { baudrate: String(baudRate) }
      );

      this.connected = true;

      this.monitorConnection.onData((data) => {
        const text = new TextDecoder().decode(data);
        const displayText = this.formatOutput(text);
        this.writeEmitter?.fire(displayText);

        // Buffer for AI analysis
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            this.outputBuffer.push(line.trim());
            if (this.outputBuffer.length > this.maxBufferLines) {
              this.outputBuffer.shift();
            }
          }
        }

        // Relay to Plotter Webview if open
        if (this.currentWebviewPanel) {
          this.currentWebviewPanel.webview.postMessage({
            type: "SERIAL_DATA",
            data: text,
          });
        }
      });

      this.outputChannel.appendLine(
        `[Monitor] Connected to ${portAddress} at ${baudRate} baud`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeEmitter?.fire(
        `\r\n\x1b[1;31mFailed to connect: ${message}\x1b[0m\r\n`
      );
      this.outputChannel.appendLine(`[Monitor] Connection failed: ${message}`);
    }
  }

  /**
   * Handles user input from the pseudo-terminal.
   */
  private handleInput(data: string): void {
    if (!(this.connected && this.monitorConnection)) {
      return;
    }

    // Ctrl+C to disconnect
    if (data === "\x03") {
      this.disconnect();
      return;
    }

    // Echo input
    if (data === "\r") {
      this.writeEmitter?.fire("\r\n");
    } else {
      this.writeEmitter?.fire(data);
    }

    // Send data with line ending
    if (data === "\r") {
      const lineEnding = LINE_ENDINGS[this.settings.monitorLineEnding];
      const fullData = data.replace("\r", "") + lineEnding;
      const encoded = new TextEncoder().encode(fullData);
      this.monitorConnection.write(encoded);
    } else {
      const encoded = new TextEncoder().encode(data);
      this.monitorConnection.write(encoded);
    }
  }

  /**
   * Formats serial output text, converting newlines for terminal display.
   */
  private formatOutput(text: string): string {
    let result = text.replace(/\n/g, "\r\n");

    if (this.settings.monitorTimestamp) {
      const now = new Date();
      const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;
      result = result.replace(/\r\n/g, `\r\n\x1b[90m[${timestamp}]\x1b[0m `);
    }

    return result;
  }

  /**
   * Prompts user to change baud rate.
   */
  private async changeBaudRate(): Promise<void> {
    const baudRates = [
      300, 1200, 2400, 4800, 9600, 19_200, 38_400, 57_600, 115_200, 230_400,
      460_800, 921_600,
    ];
    const current = this.settings.monitorBaudRate;

    const items = baudRates.map((rate) => ({
      label: `${rate}`,
      description: rate === current ? "(current)" : undefined,
      rate,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select baud rate",
    });

    if (selected) {
      await this.settings.update("monitor.baudRate", selected.rate);

      // Reconnect if currently connected
      if (this.connected) {
        this.disconnect();
        await this.connect();
      }
    }
  }
}
