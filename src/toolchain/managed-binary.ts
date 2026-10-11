import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import { calculateChecksum, downloadFile, extractArchive } from "./archive";
import {
  detectPlatform,
  getBinaryName,
  type PlatformDescriptor,
} from "./platform";

/**
 * Resolution source indicating where the binary was found.
 */
export type BinaryResolutionSource = "custom" | "installed" | "missing";

/**
 * Result of resolving a binary.
 */
export interface BinaryResolution {
  path: string | null;
  source: BinaryResolutionSource;
}

/**
 * Configuration options for a managed toolchain binary.
 */
export interface ManagedBinaryOptions {
  /** Executable base name (e.g. "arduino-cli", "arduino-language-server", "clangd") */
  binaryName: string;
  /** Function returning custom path from user settings */
  customPath?: () => string;
  /** Default version to download when none is specified */
  defaultVersion: string;
  /** Human-readable display name for logging and UI */
  displayName: string;
  /** Generator for the release archive download URL */
  getDownloadUrl: (version: string, platform: PlatformDescriptor) => string;
  /** Output channel for logging download and extraction progress */
  outputChannel?: vscode.OutputChannel;
  /** Optional custom post-extraction logic */
  postExtract?: (
    extractDir: string,
    binDir: string,
    storagePath: string
  ) => Promise<void>;
  /** Global storage root directory path */
  storagePath: string;
}

/**
 * Manages downloading, resolving, and updating a toolchain executable.
 */
export class ManagedBinary {
  readonly binaryName: string;
  readonly defaultVersion: string;
  readonly displayName: string;
  readonly storagePath: string;
  private readonly customPathGetter?: () => string;
  private readonly getDownloadUrlFn: (
    version: string,
    platform: PlatformDescriptor
  ) => string;
  private readonly outputChannel?: vscode.OutputChannel;
  private readonly postExtractFn?: (
    extractDir: string,
    binDir: string,
    storagePath: string
  ) => Promise<void>;

  constructor(options: ManagedBinaryOptions) {
    this.binaryName = options.binaryName;
    this.defaultVersion = options.defaultVersion;
    this.displayName = options.displayName;
    this.storagePath = options.storagePath;
    this.customPathGetter = options.customPath;
    this.getDownloadUrlFn = options.getDownloadUrl;
    this.outputChannel = options.outputChannel;
    this.postExtractFn = options.postExtract;
  }

  /**
   * Returns the expected path of the binary in the extension's managed bin directory.
   */
  getBinaryPath(): string {
    const filename = getBinaryName(this.binaryName);
    return path.join(this.storagePath, "bin", filename);
  }

  /**
   * Checks if the binary exists in the managed storage bin directory.
   */
  async isInstalled(): Promise<boolean> {
    return this.fileExists(this.getBinaryPath());
  }

  /**
   * Resolves the binary location following the precedence order:
   * 1. Custom path (if configured and exists on disk)
   * 2. Managed installed binary (if exists in storage/bin)
   * 3. Missing
   */
  async resolve(): Promise<BinaryResolution> {
    const custom = this.customPathGetter?.();
    if (custom && custom.trim() !== "") {
      const resolvedCustom = path.resolve(custom);
      if (await this.fileExists(resolvedCustom)) {
        return { source: "custom", path: resolvedCustom };
      }
    }

    const installed = this.getBinaryPath();
    if (await this.fileExists(installed)) {
      return { source: "installed", path: installed };
    }

    return { source: "missing", path: null };
  }

  /**
   * Helper to return the resolved path directly or null if missing.
   */
  async resolvePath(): Promise<string | null> {
    const resolution = await this.resolve();
    return resolution.path;
  }

  /**
   * Downloads and extracts the binary.
   *
   * @param version - Version string (defaults to defaultVersion)
   * @param progress - VS Code progress reporter
   * @param expectedChecksum - Optional SHA-256 hash to verify archive integrity
   */
  async download(
    version: string = this.defaultVersion,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    expectedChecksum?: string
  ): Promise<string> {
    const platform = detectPlatform();
    const url = this.getDownloadUrlFn(version, platform);
    const binDir = path.join(this.storagePath, "bin");
    const tempDir = path.join(
      this.storagePath,
      "tmp",
      `${this.binaryName}-${Date.now()}`
    );

    await fs.promises.mkdir(binDir, { recursive: true });
    await fs.promises.mkdir(tempDir, { recursive: true });

    const archiveName = `archive${platform.extension}`;
    const archivePath = path.join(tempDir, archiveName);
    const extractDir = path.join(tempDir, "extracted");
    await fs.promises.mkdir(extractDir, { recursive: true });

    this.log(`Downloading ${this.displayName} v${version}`);
    this.log(`URL: ${url}`);
    this.log(`Platform: ${platform.os} ${platform.arch}`);

    progress?.report({
      message: `Downloading ${this.displayName} v${version}...`,
    });

    try {
      await downloadFile(url, archivePath, (downloaded, total) => {
        if (total) {
          const percent = Math.round((downloaded / total) * 100);
          progress?.report({
            message: `Downloading ${this.displayName} v${version}... ${percent}%`,
            increment: 1,
          });
        }
      });

      const actualChecksum = await calculateChecksum(archivePath);
      this.log(`Download complete. SHA-256: ${actualChecksum}`);

      if (
        expectedChecksum &&
        actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()
      ) {
        throw new Error(
          `Checksum mismatch for downloaded binary. Expected: ${expectedChecksum}, got: ${actualChecksum}`
        );
      }

      progress?.report({ message: `Extracting ${this.displayName}...` });
      await extractArchive(archivePath, extractDir, platform.archiveType);

      if (this.postExtractFn) {
        await this.postExtractFn(extractDir, binDir, this.storagePath);
      } else {
        // Find executable in extracted tree and copy to binDir
        const targetFilename = getBinaryName(this.binaryName);
        const sourcePath = await this.findFileRecursive(
          extractDir,
          targetFilename
        );
        if (!sourcePath) {
          throw new Error(
            `Extracted archive did not contain executable: ${targetFilename}`
          );
        }
        const destPath = this.getBinaryPath();
        await fs.promises.copyFile(sourcePath, destPath);
      }

      const binaryPath = this.getBinaryPath();
      if (os.platform() !== "win32") {
        await fs.promises.chmod(binaryPath, 0o755);
      }

      await fs.promises.rm(tempDir, { recursive: true, force: true });
      this.log(`${this.displayName} v${version} installed to ${binaryPath}`);
      return binaryPath;
    } catch (error) {
      await fs.promises
        .rm(tempDir, { recursive: true, force: true })
        .catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to download ${this.displayName}: ${message}`);
    }
  }

  /**
   * Uninstalls the binary by deleting it from storage.
   */
  async uninstall(): Promise<void> {
    const binPath = this.getBinaryPath();
    await fs.promises.rm(binPath, { force: true });
    this.log(`${this.displayName} uninstalled`);
  }

  /**
   * Recursively searches for a file by name.
   */
  private async findFileRecursive(
    dir: string,
    filename: string
  ): Promise<string | null> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === filename) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = await this.findFileRecursive(fullPath, filename);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Helper to check file existence.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private log(message: string): void {
    this.outputChannel?.appendLine(`[${this.displayName}] ${message}`);
  }
}
