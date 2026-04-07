import * as vscode from "vscode";
import type {
  BoardDiscoveryService,
  DetectedBoard,
  DetectedPort,
} from "./discovery";

/**
 * Currently selected board and port.
 */
export interface BoardSelection {
  board: DetectedBoard | null;
  fqbn: string;
  port: DetectedPort | null;
  portAddress: string;
}

/**
 * BoardSelector manages the status bar board/port selector.
 * Shows the current board and port, and provides a quick pick UI for selection.
 */
export class BoardSelector implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly discovery: BoardDiscoveryService;
  private readonly disposables: vscode.Disposable[] = [];

  private selectedBoard: DetectedBoard | null = null;
  private selectedPort: DetectedPort | null = null;
  private customFqbn = "";

  constructor(
    outputChannel: vscode.OutputChannel,
    discovery: BoardDiscoveryService
  ) {
    this.outputChannel = outputChannel;
    this.discovery = discovery;

    // Create status bar item (high priority, aligned left)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "arduinoUnified.selectBoard";
    this.statusBarItem.tooltip = "Select Arduino Board & Port";
    this.updateStatusBar();
    this.statusBarItem.show();

    // Listen for board changes
    this.discovery.on("change", () => {
      this.updateStatusBar();
    });

    // Register the select board command
    const selectCmd = vscode.commands.registerCommand(
      "arduinoUnified.selectBoard",
      () => this.showBoardPicker()
    );
    this.disposables.push(selectCmd);

    // Register the select port command
    const portCmd = vscode.commands.registerCommand(
      "arduinoUnified.selectPort",
      () => this.showPortPicker()
    );
    this.disposables.push(portCmd);
  }

  /**
   * Returns the current board selection.
   */
  getSelection(): BoardSelection {
    return {
      board: this.selectedBoard,
      port: this.selectedPort,
      fqbn: this.selectedBoard?.fqbn ?? this.customFqbn,
      portAddress: this.selectedPort?.address ?? "",
    };
  }

  /**
   * Programmatically sets the selected board.
   */
  selectBoard(board: DetectedBoard): void {
    this.selectedBoard = board;
    this.updateStatusBar();
  }

  /**
   * Programmatically sets the selected port.
   */
  selectPort(port: DetectedPort): void {
    this.selectedPort = port;
    // Auto-select board if port has a matched board
    if (port.boards.length > 0 && !this.selectedBoard) {
      this.selectedBoard = port.boards[0];
    }
    this.updateStatusBar();
  }

  /**
   * Shows the board picker quick pick UI.
   */
  async showBoardPicker(): Promise<void> {
    const detectedPorts = this.discovery.getDetectedPorts();

    interface BoardPickItem extends vscode.QuickPickItem {
      action?: string;
      board?: DetectedBoard;
      port?: DetectedPort;
    }

    const items: BoardPickItem[] = [];

    // Add detected boards
    for (const port of detectedPorts) {
      if (port.boards.length > 0) {
        for (const board of port.boards) {
          const isSelected =
            this.selectedBoard?.fqbn === board.fqbn &&
            this.selectedPort?.address === port.address;

          items.push({
            label: `$(circuit-board) ${board.name}`,
            description: port.address,
            detail: board.fqbn,
            picked: isSelected,
            board,
            port,
          });
        }
      } else {
        items.push({
          label: `$(plug) ${port.address}`,
          description: port.protocolLabel,
          detail: "Unknown board",
          port,
        });
      }
    }

    if (items.length > 0) {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    }

    // Add manual FQBN entry option
    items.push({
      label: "$(edit) Enter FQBN manually...",
      description: "For boards not auto-detected",
      action: "manual",
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select Arduino Board & Port",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return;
    }

    if (selected.action === "manual") {
      const fqbn = await vscode.window.showInputBox({
        prompt: "Enter the Fully Qualified Board Name (FQBN)",
        placeHolder: "e.g., arduino:avr:uno",
        value: this.customFqbn,
      });
      if (fqbn) {
        this.customFqbn = fqbn;
        this.selectedBoard = { name: fqbn.split(":").pop() ?? fqbn, fqbn };
        this.selectedPort = null;
        // Also prompt for port
        await this.showPortPicker();
      }
    } else if (selected.board && selected.port) {
      this.selectedBoard = selected.board;
      this.selectedPort = selected.port;
    } else if (selected.port) {
      this.selectedPort = selected.port;
    }

    this.updateStatusBar();
    this.outputChannel.appendLine(
      `[Board] Selected: ${this.selectedBoard?.name ?? "none"} @ ${this.selectedPort?.address ?? "none"}`
    );
  }

  /**
   * Shows the port picker quick pick UI.
   */
  async showPortPicker(): Promise<void> {
    const ports = this.discovery.getDetectedPorts();

    interface PortPickItem extends vscode.QuickPickItem {
      port?: DetectedPort;
    }

    const items: PortPickItem[] = ports.map((port) => {
      const boardNames = port.boards.map((b) => b.name).join(", ");
      return {
        label: `$(plug) ${port.address}`,
        description: `${port.protocolLabel}${boardNames ? ` — ${boardNames}` : ""}`,
        picked: this.selectedPort?.address === port.address,
        port,
      };
    });

    if (items.length === 0) {
      await vscode.window.showInformationMessage(
        "No serial ports detected. Connect an Arduino board and try again."
      );
      return;
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select Serial Port",
    });

    if (selected?.port) {
      this.selectedPort = selected.port;
      this.updateStatusBar();
    }
  }

  /**
   * Updates the status bar item text.
   */
  private updateStatusBar(): void {
    const boardName = this.selectedBoard?.name ?? "No Board";
    const portAddress = this.selectedPort?.address ?? "No Port";

    this.statusBarItem.text = `$(circuit-board) ${boardName} @ ${portAddress}`;

    if (this.selectedBoard) {
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    }
  }

  /**
   * Disposes all resources.
   */
  dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
