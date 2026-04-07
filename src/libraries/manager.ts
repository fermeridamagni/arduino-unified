import * as vscode from "vscode";
import type { BoardDiscoveryService } from "../boards/discovery";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { WebviewProvider } from "../webview/webview-provider";

/**
 * Library info from the Arduino library index.
 */
export interface LibraryInfo {
  architectures: string[];
  author: string;
  availableVersions: string[];
  category: string;
  installed?: {
    version: string;
    installDir: string;
  };
  maintainer: string;
  name: string;
  paragraph: string;
  sentence: string;
  types: string[];
  version: string;
  website: string;
}

/**
 * LibraryManager provides library search, install, uninstall, and listing
 * via the Arduino CLI gRPC service.
 */
export class LibraryManager {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly client: ArduinoGrpcClient;
  private readonly discovery: BoardDiscoveryService;
  private readonly webviewProvider: WebviewProvider;

  constructor(
    outputChannel: vscode.OutputChannel,
    client: ArduinoGrpcClient,
    discovery: BoardDiscoveryService,
    webviewProvider: WebviewProvider
  ) {
    this.outputChannel = outputChannel;
    this.client = client;
    this.discovery = discovery;
    this.webviewProvider = webviewProvider;
  }

  openWebview() {
    const defaultViewColumn = vscode.ViewColumn.Active;
    const panel = this.webviewProvider.openWebview(
      "arduinoUnified.libraryManager",
      "Arduino: Library Manager",
      "libraries",
      defaultViewColumn
    );

    // Setup message handler for UI to perform actions
    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "LIBRARY_SEARCH": {
          try {
            const results = await this.search(message.query);
            panel.webview.postMessage({
              type: "LIBRARY_SEARCH_RESULTS",
              data: results,
            });
          } catch (e) {
            this.outputChannel.appendLine(`[Webview] Error searching: ${e}`);
          }
          break;
        }
        case "LIBRARY_INSTALL": {
          await this.install(message.name);
          panel.webview.postMessage({
            type: "LIBRARY_INSTALL_COMPLETE",
            name: message.name,
          });
          break;
        }
        case "LIBRARY_UNINSTALL": {
          // If message.version is provided, use it; otherwise an empty string usually tells arduino-cli to uninstall all versions or the active one.
          await this.uninstall(message.name, message.version || "");
          panel.webview.postMessage({
            type: "LIBRARY_UNINSTALL_COMPLETE",
            name: message.name,
          });
          break;
        }
        default:
          break;
      }
    });

    return panel;
  }

  /**
   * Searches the Arduino library index.
   */
  async search(query: string): Promise<LibraryInfo[]> {
    const result = await this.client.librarySearch(query);
    const libraries = (result.libraries ?? []) as Record<string, unknown>[];
    return libraries.map((lib) => this.parseLibraryInfo(lib));
  }

  /**
   * Lists installed libraries.
   */
  async listInstalled(options?: {
    updatable?: boolean;
    fqbn?: string;
  }): Promise<LibraryInfo[]> {
    const result = await this.client.libraryList({
      updatable: options?.updatable,
      all: true,
      fqbn: options?.fqbn,
    });
    const installedLibraries = (result.installedLibraries ?? []) as Array<{
      library: Record<string, unknown>;
    }>;
    return installedLibraries.map((item) =>
      this.parseLibraryInfo(item.library ?? item)
    );
  }

  /**
   * Installs a library, optionally at a specific version.
   * Pauses board discovery during installation.
   */
  async install(
    name: string,
    version?: string,
    onProgress?: (message: string, percent?: number) => void
  ): Promise<void> {
    this.discovery.pause();
    this.outputChannel.appendLine(
      `[Library] Installing ${name}${version ? `@${version}` : ""}...`
    );

    try {
      await this.client.libraryInstall(name, version, (data: unknown) => {
        const progress = data as {
          progress?: { completed: number; totalSize: number };
          taskProgress?: { name: string; percent: number };
        };
        if (progress.taskProgress) {
          onProgress?.(
            progress.taskProgress.name,
            progress.taskProgress.percent
          );
        }
      });

      this.outputChannel.appendLine(`[Library] Installed ${name} successfully`);
    } finally {
      this.discovery.resume(this.client);
    }
  }

  /**
   * Uninstalls a library.
   */
  async uninstall(
    name: string,
    version: string,
    onProgress?: (message: string) => void
  ): Promise<void> {
    this.discovery.pause();
    this.outputChannel.appendLine(
      `[Library] Uninstalling ${name}@${version}...`
    );

    try {
      await this.client.libraryUninstall(name, version, (data: unknown) => {
        const progress = data as { taskProgress?: { name: string } };
        if (progress.taskProgress) {
          onProgress?.(progress.taskProgress.name);
        }
      });

      this.outputChannel.appendLine(
        `[Library] Uninstalled ${name} successfully`
      );
    } finally {
      this.discovery.resume(this.client);
    }
  }

  /**
   * Resolves dependencies for a library before installation.
   */
  async resolveDependencies(
    name: string,
    version?: string
  ): Promise<
    Array<{ name: string; versionRequired: string; versionInstalled?: string }>
  > {
    const result = await this.client.libraryResolveDependencies(name, version);
    return (result.dependencies ?? []) as Array<{
      name: string;
      versionRequired: string;
      versionInstalled?: string;
    }>;
  }

  /**
   * Generates the #include directive for a library.
   */
  getIncludeDirective(libraryName: string): string {
    // Convert library name to header file name
    // Most Arduino libraries use the library name as the header
    const headerName = libraryName.replace(/\s+/g, "_");
    return `#include <${headerName}.h>`;
  }

  /**
   * Parses a raw library object into a typed LibraryInfo.
   */
  private parseLibraryInfo(raw: Record<string, unknown>): LibraryInfo {
    const latest = (raw.latest ?? raw) as Record<string, unknown>;
    const release = (raw.release ?? {}) as Record<string, unknown>;

    return {
      name: (latest.name ?? raw.name ?? "") as string,
      version: (latest.version ?? raw.version ?? "") as string,
      author: (latest.author ?? "") as string,
      maintainer: (latest.maintainer ?? "") as string,
      sentence: (latest.sentence ?? "") as string,
      paragraph: (latest.paragraph ?? "") as string,
      website: (latest.website ?? "") as string,
      category: (latest.category ?? "") as string,
      architectures: (latest.architectures ?? []) as string[],
      types: (latest.types ?? []) as string[],
      installed: raw.installedVersion
        ? {
            version: raw.installedVersion as string,
            installDir: (raw.installDir ?? "") as string,
          }
        : undefined,
      availableVersions: ((raw.availableVersions ?? release.version)
        ? [release.version as string]
        : []) as string[],
    };
  }
}
