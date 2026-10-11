import * as fs from "node:fs";
import * as path from "node:path";
import type * as vscode from "vscode";

import { calculateChecksum as archiveCalculateChecksum } from "../toolchain/archive";
import { ManagedBinary } from "../toolchain/managed-binary";
import { getArduinoCliDownloadUrl } from "../toolchain/platform";

/**
 * Calculates the SHA-256 checksum of a file.
 */
export async function calculateChecksum(filePath: string): Promise<string> {
  return archiveCalculateChecksum(filePath);
}

/**
 * Default CLI version to download if none is specified.
 */
export const DEFAULT_CLI_VERSION = "1.4.1";

/**
 * ArduinoCliDownloader handles downloading and extracting the Arduino CLI binary.
 * It downloads from the official Arduino downloads server and extracts to
 * the extension's global storage path, using the shared toolchain primitives.
 */
export class ArduinoCliDownloader {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly storagePath: string;
  private readonly managedBinary: ManagedBinary;

  constructor(outputChannel: vscode.OutputChannel, storagePath: string) {
    this.outputChannel = outputChannel;
    this.storagePath = storagePath;
    this.managedBinary = new ManagedBinary({
      binaryName: "arduino-cli",
      defaultVersion: DEFAULT_CLI_VERSION,
      displayName: "Arduino CLI",
      getDownloadUrl: (version, platform) =>
        getArduinoCliDownloadUrl(version, platform),
      outputChannel,
      storagePath,
    });
  }

  /**
   * Returns the path where the CLI binary should be located.
   */
  getCliBinaryPath(): string {
    return this.managedBinary.getBinaryPath();
  }

  /**
   * Checks if the CLI binary is already downloaded (asynchronous).
   */
  async isCliInstalled(): Promise<boolean> {
    return this.managedBinary.isInstalled();
  }

  /**
   * Downloads and extracts the Arduino CLI binary.
   *
   * @param version - Version to download (default: latest known stable)
   * @param progress - VSCode progress reporter
   * @param expectedChecksum - Optional SHA-256 checksum to verify
   * @returns Path to the extracted CLI binary
   */
  async download(
    version: string = DEFAULT_CLI_VERSION,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    expectedChecksum?: string
  ): Promise<string> {
    return this.managedBinary.download(version, progress, expectedChecksum);
  }

  /**
   * Removes the installed CLI binary and bin directory.
   */
  async uninstall(): Promise<void> {
    const binDir = path.join(this.storagePath, "bin");
    await fs.promises.rm(binDir, { recursive: true, force: true });
    this.outputChannel.appendLine("[Downloader] Arduino CLI uninstalled");
  }
}
