import { EventEmitter } from "node:events";
import type * as vscode from "vscode";
import type { ArduinoGrpcClient } from "../cli/grpc-client";

/**
 * Represents a detected port with optional board match.
 */
export interface DetectedPort {
  address: string;
  boards: DetectedBoard[];
  hardwareId: string;
  properties: Record<string, string>;
  protocol: string;
  protocolLabel: string;
}

/**
 * A board matched to a detected port.
 */
export interface DetectedBoard {
  fqbn: string;
  name: string;
}

/**
 * Board discovery event types.
 */
export type BoardDiscoveryEventType = "add" | "remove";

/**
 * Event emitted when a board is connected or disconnected.
 */
export interface BoardDiscoveryEvent {
  port: DetectedPort;
  type: BoardDiscoveryEventType;
}

/**
 * BoardDiscoveryService monitors USB/serial/network ports for Arduino boards
 * using the gRPC `BoardListWatch` streaming RPC.
 */
export class BoardDiscoveryService extends EventEmitter {
  private readonly outputChannel: vscode.OutputChannel;
  private cancelWatch: (() => void) | null = null;
  private ports: Map<string, DetectedPort> = new Map();
  private paused = false;

  constructor(outputChannel: vscode.OutputChannel) {
    super();
    this.outputChannel = outputChannel;
  }

  /**
   * Starts watching for board connections/disconnections.
   */
  startWatching(client: ArduinoGrpcClient): void {
    if (this.cancelWatch) {
      return; // Already watching
    }

    this.outputChannel.appendLine("[Discovery] Starting board watch...");

    this.cancelWatch = client.boardListWatch(
      (event) => {
        this.handleWatchEvent(event);
      },
      (error) => {
        this.outputChannel.appendLine(
          `[Discovery] Watch error: ${error.message}`
        );
        // Auto-restart after a delay
        this.cancelWatch = null;
        setTimeout(() => {
          if (!this.paused) {
            this.startWatching(client);
          }
        }, 3000);
      }
    );
  }

  /**
   * Stops watching for board changes.
   */
  stopWatching(): void {
    if (this.cancelWatch) {
      this.cancelWatch();
      this.cancelWatch = null;
      this.outputChannel.appendLine("[Discovery] Stopped board watch");
    }
  }

  /**
   * Temporarily pauses discovery (e.g., during uploads/installations).
   */
  pause(): void {
    this.paused = true;
    this.stopWatching();
  }

  /**
   * Resumes discovery after a pause.
   */
  resume(client: ArduinoGrpcClient): void {
    this.paused = false;
    this.startWatching(client);
  }

  /**
   * Returns all currently detected ports.
   */
  getDetectedPorts(): DetectedPort[] {
    return [...this.ports.values()];
  }

  /**
   * Returns detected ports that have at least one matched board.
   */
  getDetectedBoards(): DetectedPort[] {
    return [...this.ports.values()].filter((port) => port.boards.length > 0);
  }

  /**
   * Finds a port by its address (e.g., `/dev/ttyUSB0` or `COM3`).
   */
  findPortByAddress(address: string): DetectedPort | undefined {
    return this.ports.get(address);
  }

  /**
   * Returns a human-readable summary of detected boards.
   */
  getSummary(): string {
    const ports = this.getDetectedPorts();
    if (ports.length === 0) {
      return "No boards detected";
    }

    return ports
      .map((port) => {
        const boardNames = port.boards.map((b) => b.name).join(", ");
        const boardInfo = boardNames ? ` (${boardNames})` : "";
        return `${port.address}${boardInfo}`;
      })
      .join("\n");
  }

  /**
   * Disposes of the service and stops watching.
   */
  dispose(): void {
    this.stopWatching();
    this.ports.clear();
  }

  /**
   * Handles a BoardListWatch event from the gRPC stream.
   */
  private handleWatchEvent(event: Record<string, unknown>): void {
    const eventType = event.eventType as string | undefined;
    const port = event.port as Record<string, unknown> | undefined;

    if (!port) {
      return;
    }

    const detectedPort = this.parsePort(port);

    if (
      eventType === "add" ||
      eventType === "BOARD_LIST_WATCH_EVENT_TYPE_ADD"
    ) {
      this.ports.set(detectedPort.address, detectedPort);
      this.outputChannel.appendLine(
        `[Discovery] Board connected: ${detectedPort.address} ` +
          `(${detectedPort.boards.map((b) => b.name).join(", ") || "unknown"})`
      );
      this.emit("boardConnected", detectedPort);
    } else if (
      eventType === "remove" ||
      eventType === "BOARD_LIST_WATCH_EVENT_TYPE_REMOVE"
    ) {
      this.ports.delete(detectedPort.address);
      this.outputChannel.appendLine(
        `[Discovery] Board disconnected: ${detectedPort.address}`
      );
      this.emit("boardDisconnected", detectedPort);
    }

    this.emit("change", this.getDetectedPorts());
  }

  /**
   * Parses a raw gRPC port object into a typed DetectedPort.
   */
  private parsePort(raw: Record<string, unknown>): DetectedPort {
    const matchingBoards = (raw.matchingBoards ?? []) as Array<{
      name?: string;
      fqbn?: string;
    }>;

    const portInfo = (raw.port ?? raw) as Record<string, unknown>;

    return {
      address: (portInfo.address as string) ?? "",
      protocol: (portInfo.protocol as string) ?? "",
      protocolLabel: (portInfo.protocolLabel as string) ?? "",
      properties: (portInfo.properties as Record<string, string>) ?? {},
      hardwareId: (portInfo.hardwareId as string) ?? "",
      boards: matchingBoards.map((b) => ({
        name: b.name ?? "Unknown Board",
        fqbn: b.fqbn ?? "",
      })),
    };
  }
}
