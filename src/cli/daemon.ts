import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";

/**
 * Manages the lifecycle of the `arduino-cli daemon` child process.
 * Spawns on activation, discovers gRPC port from JSON stdout,
 * and handles restart/stop/config changes.
 */
export class ArduinoDaemon extends EventEmitter {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private readonly outputChannel: vscode.OutputChannel;
  private starting = false;
  private stopping = false;

  constructor(outputChannel: vscode.OutputChannel) {
    super();
    this.outputChannel = outputChannel;
  }

  /**
   * Starts the arduino-cli daemon.
   * @param cliPath - Path to the arduino-cli binary
   * @param configPath - Optional path to arduino-cli.yaml
   * @returns The gRPC port the daemon is listening on
   */
  async start(cliPath: string, configPath?: string): Promise<number> {
    if (this.process) {
      throw new Error("Daemon is already running");
    }
    if (this.starting) {
      throw new Error("Daemon is already starting");
    }

    this.starting = true;

    try {
      const resolvedPath = this.resolveCliPath(cliPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(
          `arduino-cli not found at: ${resolvedPath}. ` +
            "Please install it or set the path in settings."
        );
      }

      const args = ["daemon", "--port", "0", "--format", "json"];
      if (configPath) {
        args.push("--config-file", configPath);
      }

      this.outputChannel.appendLine(
        `[Daemon] Starting: ${resolvedPath} ${args.join(" ")}`
      );

      const port = await new Promise<number>((resolve, reject) => {
        const proc = spawn(resolvedPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        this.process = proc;

        let stdoutBuffer = "";
        let portResolved = false;

        proc.stdout?.on("data", (data: Buffer) => {
          const text = data.toString("utf8");
          stdoutBuffer += text;

          // The daemon outputs JSON with the port info on startup
          if (!portResolved) {
            // Match "Port": "12345" or "port": 12345 in the multi-line JSON
            const match = stdoutBuffer.match(/"[pP]ort"\s*:\s*"?(\d+)"?/);
            if (match?.[1]) {
              const parsedPort = Number.parseInt(match[1], 10);
              if (!Number.isNaN(parsedPort)) {
                portResolved = true;
                resolve(parsedPort);
              }
            }
          }
        });

        proc.stderr?.on("data", (data: Buffer) => {
          const text = data.toString("utf8").trim();
          if (text) {
            this.outputChannel.appendLine(`[Daemon] stderr: ${text}`);
          }
        });

        proc.on("error", (err) => {
          this.outputChannel.appendLine(
            `[Daemon] Process error: ${err.message}`
          );
          if (!portResolved) {
            reject(
              new Error(`Failed to start arduino-cli daemon: ${err.message}`)
            );
          }
          this.cleanup();
        });

        proc.on("exit", (code, signal) => {
          this.outputChannel.appendLine(
            `[Daemon] Process exited (code=${code}, signal=${signal})`
          );
          if (!portResolved) {
            reject(
              new Error(
                `arduino-cli daemon exited before reporting port (code=${code})`
              )
            );
          }
          this.cleanup();
          this.emit("exit", code, signal);
        });

        // Timeout if daemon doesn't start within 30 seconds
        setTimeout(() => {
          if (!portResolved) {
            proc.kill();
            reject(new Error("arduino-cli daemon startup timed out (30s)"));
          }
        }, 30_000);
      });

      this.port = port;
      this.outputChannel.appendLine(`[Daemon] Started on port ${port}`);
      this.emit("started", port);
      return port;
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stops the daemon process gracefully.
   */
  async stop(): Promise<void> {
    if (!this.process || this.stopping) {
      return;
    }

    this.stopping = true;
    this.outputChannel.appendLine("[Daemon] Stopping...");

    try {
      await new Promise<void>((resolve) => {
        if (!this.process) {
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          this.outputChannel.appendLine("[Daemon] Force killing...");
          this.process?.kill("SIGKILL");
          resolve();
        }, 5000);

        this.process.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });

        this.process.kill("SIGTERM");
      });
    } finally {
      this.cleanup();
      this.stopping = false;
    }
  }

  /**
   * Restarts the daemon.
   */
  async restart(cliPath: string, configPath?: string): Promise<number> {
    await this.stop();
    return this.start(cliPath, configPath);
  }

  /**
   * Returns the gRPC port the daemon is listening on, or null if not running.
   */
  getPort(): number | null {
    return this.port;
  }

  /**
   * Returns true if the daemon process is currently running.
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Resolves the CLI path, supporting ~ home directory expansion.
   */
  private resolveCliPath(cliPath: string): string {
    if (cliPath.startsWith("~")) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
      return path.join(home, cliPath.slice(1));
    }
    return path.resolve(cliPath);
  }

  /**
   * Cleans up process references.
   */
  private cleanup(): void {
    this.process = null;
    this.port = null;
  }
}
