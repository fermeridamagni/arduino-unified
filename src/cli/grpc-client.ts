import { EventEmitter } from "node:events";
import * as path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type * as vscode from "vscode";

/**
 * Represents a gRPC Arduino Core instance.
 * The instance is created by the `Create` RPC and used in subsequent calls.
 */
interface ArduinoInstance {
  instance: { id: number };
}

/**
 * Progress callback for streaming operations.
 */
type ProgressCallback = (data: Record<string, unknown>) => void;

/**
 * Options for streaming RPC calls.
 */
interface StreamOptions {
  onData?: ProgressCallback;
  onError?: (error: Error) => void;
}

/**
 * ArduinoGrpcClient provides a typed wrapper around the Arduino CLI gRPC service.
 * Uses dynamic proto loading via @grpc/proto-loader for simplicity.
 */
export class ArduinoGrpcClient extends EventEmitter {
  private client: grpc.Client | null = null;
  private service: Record<string, unknown> | null = null;
  private instance: ArduinoInstance | null = null;
  private readonly outputChannel: vscode.OutputChannel;
  private readonly protoRoot: string;

  constructor(outputChannel: vscode.OutputChannel) {
    super();
    this.outputChannel = outputChannel;
    // __dirname is `dist/` at runtime because esbuild bundles everything to dist/extension.js
    this.protoRoot = path.join(__dirname, "proto");
  }

  /**
   * Connects to the Arduino CLI gRPC daemon on the given port.
   */
  async connect(port: number): Promise<void> {
    const packageDefinition = await protoLoader.load(
      path.join(this.protoRoot, "cc/arduino/cli/commands/v1/commands.proto"),
      {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [this.protoRoot],
      }
    );

    const proto = grpc.loadPackageDefinition(packageDefinition);

    const ArduinoCoreService = (
      proto.cc as Record<string, unknown> as {
        arduino: {
          cli: {
            commands: {
              v1: {
                ArduinoCoreService: grpc.ServiceClientConstructor;
              };
            };
          };
        };
      }
    ).arduino.cli.commands.v1.ArduinoCoreService;

    this.client = new ArduinoCoreService(
      `localhost:${port}`,
      grpc.credentials.createInsecure()
    );

    this.service = this.client as unknown as Record<string, unknown>;
    this.outputChannel.appendLine(
      `[gRPC] Connected to arduino-cli on port ${port}`
    );
  }

  /**
   * Creates a new Arduino Core instance via the Create RPC.
   */
  async createInstance(): Promise<ArduinoInstance> {
    const response = await this.unaryCall<
      Record<string, never>,
      { instance: { id: number } }
    >("create", {});
    this.instance = { instance: response.instance };
    this.outputChannel.appendLine(
      `[gRPC] Created instance: ${response.instance.id}`
    );
    return this.instance;
  }

  /**
   * Initializes the Arduino Core instance (loads platforms and libraries indexes).
   */
  async initInstance(onProgress?: ProgressCallback): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance created. Call createInstance() first.");
    }

    await this.serverStreamCall("init", this.instance, {
      onData: (data) => {
        const msg = data as {
          message?: string;
          initProgress?: unknown;
          error?: unknown;
        };
        if (msg.initProgress) {
          onProgress?.(msg.initProgress as Record<string, unknown>);
        }
        if (msg.error) {
          this.outputChannel.appendLine(
            `[gRPC] Init warning: ${JSON.stringify(msg.error)}`
          );
        }
      },
    });

    this.outputChannel.appendLine("[gRPC] Instance initialized successfully");
    this.emit("ready");
  }

  /**
   * Gets the Arduino CLI version.
   */
  async getVersion(): Promise<string> {
    const response = await this.unaryCall<
      Record<string, never>,
      { version: string }
    >("version", {});
    return response.version;
  }

  /**
   * Updates platform indexes.
   */
  async updateIndex(onProgress?: ProgressCallback): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    await this.serverStreamCall("updateIndex", this.instance, {
      onData: onProgress,
    });
  }

  /**
   * Updates library indexes.
   */
  async updateLibrariesIndex(onProgress?: ProgressCallback): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    await this.serverStreamCall("updateLibrariesIndex", this.instance, {
      onData: onProgress,
    });
  }

  /**
   * Compiles a sketch.
   */
  async compile(
    request: {
      sketchPath: string;
      fqbn: string;
      verbose?: boolean;
      warnings?: string;
      exportDir?: string;
      optimizeForDebug?: boolean;
    },
    onProgress?: ProgressCallback
  ): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }

    let result: Record<string, unknown> = {};
    await this.serverStreamCall(
      "compile",
      {
        ...this.instance,
        sketchPath: request.sketchPath,
        fqbn: request.fqbn,
        verbose: request.verbose ?? false,
        warnings: request.warnings ?? "none",
        exportDir: request.exportDir ?? "",
        optimizeForDebug: request.optimizeForDebug ?? false,
      },
      {
        onData: (data) => {
          const msg = data as {
            outStream?: Buffer;
            errStream?: Buffer;
            result?: Record<string, unknown>;
          };
          if (msg.outStream) {
            const text = Buffer.from(msg.outStream).toString("utf8");
            onProgress?.({ type: "stdout", text });
          }
          if (msg.errStream) {
            const text = Buffer.from(msg.errStream).toString("utf8");
            onProgress?.({ type: "stderr", text });
          }
          if (msg.result) {
            result = msg.result;
          }
        },
      }
    );

    return result;
  }

  /**
   * Uploads a compiled sketch to a board.
   */
  async upload(
    request: {
      sketchPath: string;
      fqbn: string;
      port: { address: string; protocol: string };
      verbose?: boolean;
      verify?: boolean;
      programmer?: string;
    },
    onProgress?: ProgressCallback
  ): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }

    let result: Record<string, unknown> = {};
    await this.serverStreamCall(
      "upload",
      {
        ...this.instance,
        sketchPath: request.sketchPath,
        fqbn: request.fqbn,
        port: request.port,
        verbose: request.verbose ?? false,
        verify: request.verify ?? false,
        programmer: request.programmer ?? "",
      },
      {
        onData: (data) => {
          const msg = data as {
            outStream?: Buffer;
            errStream?: Buffer;
            result?: Record<string, unknown>;
          };
          if (msg.outStream) {
            const text = Buffer.from(msg.outStream).toString("utf8");
            onProgress?.({ type: "stdout", text });
          }
          if (msg.errStream) {
            const text = Buffer.from(msg.errStream).toString("utf8");
            onProgress?.({ type: "stderr", text });
          }
          if (msg.result) {
            result = msg.result;
          }
        },
      }
    );

    return result;
  }

  /**
   * Upload using a programmer (bypassing bootloader).
   */
  async uploadUsingProgrammer(
    request: {
      sketchPath: string;
      fqbn: string;
      port: { address: string; protocol: string };
      programmer: string;
      verbose?: boolean;
      verify?: boolean;
    },
    onProgress?: ProgressCallback
  ): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }

    let result: Record<string, unknown> = {};
    await this.serverStreamCall(
      "uploadUsingProgrammer",
      {
        ...this.instance,
        sketchPath: request.sketchPath,
        fqbn: request.fqbn,
        port: request.port,
        programmer: request.programmer,
        verbose: request.verbose ?? false,
        verify: request.verify ?? false,
      },
      {
        onData: (data) => {
          const msg = data as { result?: Record<string, unknown> };
          if (msg.result) {
            result = msg.result;
          }
          onProgress?.(data);
        },
      }
    );

    return result;
  }

  /**
   * Burns bootloader to a board.
   */
  async burnBootloader(
    request: {
      fqbn: string;
      port: { address: string; protocol: string };
      programmer: string;
      verbose?: boolean;
      verify?: boolean;
    },
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }

    await this.serverStreamCall(
      "burnBootloader",
      {
        ...this.instance,
        fqbn: request.fqbn,
        port: request.port,
        programmer: request.programmer,
        verbose: request.verbose ?? false,
        verify: request.verify ?? false,
      },
      { onData: onProgress }
    );
  }

  /**
   * Starts watching for board list changes (streaming).
   * Returns a cancel function.
   */
  boardListWatch(
    onEvent: (event: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (!(this.service && this.instance)) {
      throw new Error("Client not connected or no instance");
    }

    const call = (
      this.service as Record<string, CallableFunction>
    ).boardListWatch(this.instance) as grpc.ClientReadableStream<
      Record<string, unknown>
    >;

    call.on("data", onEvent);
    call.on("error", (err: Error) => {
      if (!err.message.includes("CANCELLED")) {
        onError?.(err);
      }
    });

    return () => call.cancel();
  }

  /**
   * Lists currently connected boards.
   */
  async boardList(): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("boardList", this.instance);
  }

  /**
   * Gets details for a specific board by FQBN.
   */
  async boardDetails(fqbn: string): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("boardDetails", { ...this.instance, fqbn });
  }

  /**
   * Lists all known boards across all installed platforms.
   */
  async boardListAll(searchArgs?: string): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("boardListAll", {
      ...this.instance,
      searchArgs: searchArgs ?? "",
    });
  }

  /**
   * Searches boards.
   */
  async boardSearch(searchArgs?: string): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("boardSearch", {
      ...this.instance,
      searchArgs: searchArgs ?? "",
    });
  }

  /**
   * Searches for platforms.
   */
  async platformSearch(searchArgs?: string): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("platformSearch", {
      ...this.instance,
      searchArgs: searchArgs ?? "",
      manuallyInstalled: true,
    });
  }

  /**
   * Installs a platform.
   */
  async platformInstall(
    platformPackage: string,
    architecture: string,
    version?: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    await this.serverStreamCall(
      "platformInstall",
      {
        ...this.instance,
        platformPackage,
        architecture,
        version: version ?? "",
      },
      { onData: onProgress }
    );
  }

  /**
   * Uninstalls a platform.
   */
  async platformUninstall(
    platformPackage: string,
    architecture: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    await this.serverStreamCall(
      "platformUninstall",
      {
        ...this.instance,
        platformPackage,
        architecture,
      },
      { onData: onProgress }
    );
  }

  /**
   * Searches libraries.
   */
  async librarySearch(query: string): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("librarySearch", {
      ...this.instance,
      searchArgs: query,
    });
  }

  /**
   * Lists installed libraries.
   */
  async libraryList(options?: {
    updatable?: boolean;
    all?: boolean;
    fqbn?: string;
  }): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("libraryList", {
      ...this.instance,
      updatable: options?.updatable ?? false,
      all: options?.all ?? false,
      fqbn: options?.fqbn ?? "",
    });
  }

  /**
   * Installs a library.
   */
  async libraryInstall(
    name: string,
    version?: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    await this.serverStreamCall(
      "libraryInstall",
      {
        ...this.instance,
        name,
        version: version ?? "",
      },
      { onData: onProgress }
    );
  }

  /**
   * Uninstalls a library.
   */
  async libraryUninstall(
    name: string,
    version: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    await this.serverStreamCall(
      "libraryUninstall",
      {
        ...this.instance,
        name,
        version,
      },
      { onData: onProgress }
    );
  }

  /**
   * Resolves library dependencies.
   */
  async libraryResolveDependencies(
    name: string,
    version?: string
  ): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("libraryResolveDependencies", {
      ...this.instance,
      name,
      version: version ?? "",
    });
  }

  /**
   * Creates a new sketch.
   */
  async newSketch(
    sketchName: string,
    sketchDir?: string
  ): Promise<{ mainFile: string }> {
    return this.unaryCall("newSketch", {
      sketchName,
      sketchDir: sketchDir ?? "",
      overwrite: false,
    });
  }

  /**
   * Loads a sketch from disk.
   */
  async loadSketch(sketchPath: string): Promise<Record<string, unknown>> {
    return this.unaryCall("loadSketch", { sketchPath });
  }

  /**
   * Archives a sketch to a zip file.
   */
  async archiveSketch(
    sketchPath: string,
    archivePath: string,
    includeBuildDir?: boolean
  ): Promise<void> {
    await this.unaryCall("archiveSketch", {
      sketchPath,
      archivePath,
      includeBuildDir: includeBuildDir ?? false,
      overwrite: true,
    });
  }

  /**
   * Enumerates monitor port settings for a given port.
   */
  async enumerateMonitorPortSettings(
    port: { address: string; protocol: string },
    fqbn: string
  ): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("enumerateMonitorPortSettings", {
      ...this.instance,
      port,
      fqbn,
    });
  }

  /**
   * Opens a bidirectional monitor connection.
   * Returns stream and cancel function.
   */
  openMonitor(
    port: { address: string; protocol: string },
    fqbn: string,
    config?: Record<string, string>
  ): {
    write: (data: Uint8Array) => void;
    onData: (callback: (data: Uint8Array) => void) => void;
    cancel: () => void;
  } {
    if (!(this.service && this.instance)) {
      throw new Error("Client not connected or no instance");
    }

    const call = (
      this.service as Record<string, CallableFunction>
    ).monitor() as grpc.ClientDuplexStream<
      Record<string, unknown>,
      Record<string, unknown>
    >;

    // Send the opening config message
    const openMessage: Record<string, unknown> = {
      ...this.instance,
      port,
      fqbn,
    };
    if (config) {
      openMessage.portConfiguration = {
        settings: Object.entries(config).map(([settingId, value]) => ({
          settingId,
          value,
        })),
      };
    }
    call.write(openMessage);

    const dataCallbacks: ((data: Uint8Array) => void)[] = [];
    call.on("data", (response: { rxData?: Uint8Array }) => {
      if (response.rxData) {
        for (const cb of dataCallbacks) {
          cb(response.rxData);
        }
      }
    });

    return {
      write: (data: Uint8Array) => {
        call.write({ txData: data });
      },
      onData: (callback: (data: Uint8Array) => void) => {
        dataCallbacks.push(callback);
      },
      cancel: () => {
        call.cancel();
      },
    };
  }

  /**
   * Gets a settings value from the CLI.
   */
  async settingsGetValue(key: string): Promise<string> {
    const response = await this.unaryCall<
      { key: string },
      { jsonData: string }
    >("settingsGetValue", { key });
    return response.jsonData;
  }

  /**
   * Sets a settings value in the CLI.
   */
  async settingsSetValue(key: string, jsonData: string): Promise<void> {
    await this.unaryCall("settingsSetValue", { key, jsonData });
  }

  /**
   * Gets the current CLI configuration.
   */
  async configurationGet(): Promise<Record<string, unknown>> {
    return this.unaryCall("configurationGet", {});
  }

  /**
   * Checks if debug is supported for the given configuration.
   */
  async isDebugSupported(
    fqbn: string,
    port?: { address: string; protocol: string },
    programmer?: string
  ): Promise<{ debuggingSupported: boolean }> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("isDebugSupported", {
      ...this.instance,
      fqbn,
      port: port ?? {},
      programmer: programmer ?? "",
    });
  }

  /**
   * Gets debug configuration for the given board/sketch.
   */
  async getDebugConfig(
    sketchPath: string,
    fqbn: string,
    port: { address: string; protocol: string },
    programmer?: string
  ): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("getDebugConfig", {
      ...this.instance,
      sketchPath,
      fqbn,
      port,
      programmer: programmer ?? "",
    });
  }

  /**
   * Lists available programmers for a board.
   */
  async listProgrammers(fqbn: string): Promise<Record<string, unknown>> {
    if (!this.instance) {
      throw new Error("No instance available");
    }
    return this.unaryCall("listProgrammersAvailableForUpload", {
      ...this.instance,
      fqbn,
    });
  }

  /**
   * Returns the current Arduino Core instance, if created.
   */
  getInstance(): ArduinoInstance | null {
    return this.instance;
  }

  /**
   * Disconnects from the gRPC server and cleans up.
   */
  disconnect(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.service = null;
      this.instance = null;
      this.outputChannel.appendLine("[gRPC] Disconnected");
    }
  }

  /**
   * Wraps a unary gRPC call in a Promise.
   */
  private unaryCall<TReq, TRes = Record<string, unknown>>(
    method: string,
    request: TReq
  ): Promise<TRes> {
    return new Promise((resolve, reject) => {
      if (!this.service) {
        reject(new Error("gRPC client not connected"));
        return;
      }

      const fn = (this.service as Record<string, CallableFunction>)[method];
      if (typeof fn !== "function") {
        reject(new Error(`Unknown gRPC method: ${method}`));
        return;
      }

      (fn as Function).call(
        this.service,
        request,
        (error: grpc.ServiceError | null, response: TRes) => {
          if (error) {
            reject(new Error(`gRPC ${method} failed: ${error.message}`));
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  /**
   * Wraps a server-streaming gRPC call in a Promise.
   * Collects all data events and resolves when the stream ends.
   */
  private serverStreamCall<TReq>(
    method: string,
    request: TReq,
    options: StreamOptions = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.service) {
        reject(new Error("gRPC client not connected"));
        return;
      }

      const fn = (this.service as Record<string, CallableFunction>)[method];
      if (typeof fn !== "function") {
        reject(new Error(`Unknown gRPC method: ${method}`));
        return;
      }

      const stream = (fn as Function).call(
        this.service,
        request
      ) as grpc.ClientReadableStream<Record<string, unknown>>;

      stream.on("data", (data: Record<string, unknown>) => {
        options.onData?.(data);
      });

      stream.on("error", (error: Error) => {
        options.onError?.(error);
        reject(error);
      });

      stream.on("end", () => {
        resolve();
      });
    });
  }
}
