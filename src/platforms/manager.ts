import type * as vscode from "vscode";
import type { BoardDiscoveryService } from "../boards/discovery";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { WebviewProvider } from "../webview/webview-provider";

/**
 * Platform (board package) info.
 */
export interface PlatformInfo {
  boards: Array<{ name: string; fqbn: string }>;
  id: string;
  installed: boolean;
  installedVersion: string;
  latestVersion: string;
  maintainer: string;
  name: string;
  type: string[];
  website: string;
}

/**
 * PlatformManager provides platform (board package) search, install,
 * and uninstall via the Arduino CLI gRPC service.
 */
export class PlatformManager {
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
    const panel = this.webviewProvider.openWebview(
      "arduinoUnified.platformManager",
      "Arduino: Board Manager",
      "platforms"
    );

    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "PLATFORM_SEARCH": {
          try {
            const results = await this.search(message.query || undefined);
            panel.webview.postMessage({
              type: "PLATFORM_SEARCH_RESULTS",
              data: results,
            });
          } catch (e) {
            this.outputChannel.appendLine(
              `[Webview] Error searching platforms: ${e}`
            );
          }
          break;
        }
        case "PLATFORM_INSTALL": {
          await this.install(message.id);
          panel.webview.postMessage({
            type: "PLATFORM_INSTALL_COMPLETE",
            id: message.id,
          });
          break;
        }
        case "PLATFORM_UNINSTALL": {
          await this.uninstall(message.id);
          panel.webview.postMessage({
            type: "PLATFORM_UNINSTALL_COMPLETE",
            id: message.id,
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
   * Searches for platforms in the index.
   */
  async search(query?: string): Promise<PlatformInfo[]> {
    const result = await this.client.platformSearch(query);
    const searchOutput = (result.searchOutput ?? []) as Record<
      string,
      unknown
    >[];
    return searchOutput.map((p) => this.parsePlatformInfo(p));
  }

  /**
   * Lists installed platforms.
   */
  async listInstalled(): Promise<PlatformInfo[]> {
    const all = await this.search("");
    return all.filter((p) => p.installed);
  }

  /**
   * Installs a platform.
   * Pauses board discovery during installation.
   */
  async install(
    platformId: string,
    version?: string,
    onProgress?: (message: string, percent?: number) => void
  ): Promise<void> {
    const [packageName, architecture] = platformId.split(":");

    this.discovery.pause();
    this.outputChannel.appendLine(
      `[Platform] Installing ${platformId}${version ? `@${version}` : ""}...`
    );

    try {
      await this.client.platformInstall(
        packageName,
        architecture,
        version,
        (data) => {
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
        }
      );

      this.outputChannel.appendLine(
        `[Platform] Installed ${platformId} successfully`
      );
    } finally {
      this.discovery.resume(this.client);
    }
  }

  /**
   * Uninstalls a platform.
   */
  async uninstall(
    platformId: string,
    onProgress?: (message: string) => void
  ): Promise<void> {
    const [packageName, architecture] = platformId.split(":");

    this.discovery.pause();
    this.outputChannel.appendLine(`[Platform] Uninstalling ${platformId}...`);

    try {
      await this.client.platformUninstall(packageName, architecture, (data) => {
        const progress = data as { taskProgress?: { name: string } };
        if (progress.taskProgress) {
          onProgress?.(progress.taskProgress.name);
        }
      });

      this.outputChannel.appendLine(
        `[Platform] Uninstalled ${platformId} successfully`
      );
    } finally {
      this.discovery.resume(this.client);
    }
  }

  /**
   * Gets details for a specific board.
   */
  async getBoardDetails(fqbn: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.client.boardDetails(fqbn);
    } catch {
      return null;
    }
  }

  /**
   * Parses a raw platform object into typed PlatformInfo.
   */
  private parsePlatformInfo(raw: Record<string, unknown>): PlatformInfo {
    const metadata = (raw.metadata ?? raw) as Record<string, unknown>;
    const releases = raw.releases as
      | Record<string, Record<string, unknown>>
      | undefined;
    const installedVersion = (raw.installedVersion ?? "") as string;

    // Get latest release info
    let latestVersion = "";
    let boards: Array<{ name: string; fqbn: string }> = [];
    let types: string[] = [];

    if (releases) {
      const versions = Object.keys(releases).sort();
      latestVersion = versions.at(-1) ?? "";
      const latestRelease = releases[latestVersion];
      if (latestRelease) {
        boards = ((latestRelease.boards ?? []) as Record<string, string>[]).map(
          (b) => ({ name: b.name ?? "", fqbn: b.fqbn ?? "" })
        );
        types = (latestRelease.type ?? []) as string[];
      }
    }

    return {
      id: (metadata.id ?? "") as string,
      name: (raw.name ?? metadata.id ?? "") as string,
      maintainer: (metadata.maintainer ?? "") as string,
      website: (metadata.websiteUrl ?? "") as string,
      installed: Boolean(installedVersion),
      installedVersion,
      latestVersion,
      boards,
      type: types,
    };
  }
}
