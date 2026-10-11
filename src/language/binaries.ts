import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
import type { ArduinoSettings } from "../config/settings";
import { ManagedBinary } from "../toolchain/managed-binary";
import {
  getAlsDownloadUrl,
  getBinaryName,
  getClangdDownloadUrl,
} from "../toolchain/platform";

export const DEFAULT_ALS_VERSION = "0.7.7";
export const DEFAULT_CLANGD_VERSION = "14.0.0";

/**
 * Recursively copies a directory.
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Recursively searches for a file or directory by name.
 */
async function findItemRecursive(
  dir: string,
  targetName: string,
  targetType: "file" | "dir"
): Promise<string | null> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      (targetType === "file" && entry.isFile() && entry.name === targetName) ||
      (targetType === "dir" && entry.isDirectory() && entry.name === targetName)
    ) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = await findItemRecursive(fullPath, targetName, targetType);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Creates the ManagedBinary instance for Arduino Language Server.
 */
export function createAlsBinary(
  storagePath: string,
  settings: ArduinoSettings,
  outputChannel?: vscode.OutputChannel
): ManagedBinary {
  return new ManagedBinary({
    binaryName: "arduino-language-server",
    customPath: () => settings.languageServerPath,
    defaultVersion: settings.languageServerVersion || DEFAULT_ALS_VERSION,
    displayName: "Arduino Language Server",
    getDownloadUrl: (version, platform) => getAlsDownloadUrl(version, platform),
    outputChannel,
    storagePath,
  });
}

/**
 * Creates the ManagedBinary instance for Clangd.
 */
export function createClangdBinary(
  storagePath: string,
  settings: ArduinoSettings,
  outputChannel?: vscode.OutputChannel
): ManagedBinary {
  return new ManagedBinary({
    binaryName: "clangd",
    customPath: () => settings.clangdPath,
    defaultVersion: settings.clangdVersion || DEFAULT_CLANGD_VERSION,
    displayName: "Clangd",
    getDownloadUrl: (version, platform) =>
      getClangdDownloadUrl(version, platform.rawPlatform),
    outputChannel,
    postExtract: async (extractDir, binDir, storageRoot) => {
      // 1. Locate clangd executable in extracted archive
      const clangdBinaryName = getBinaryName("clangd");
      const foundClangd = await findItemRecursive(
        extractDir,
        clangdBinaryName,
        "file"
      );
      if (!foundClangd) {
        throw new Error(
          `Clangd archive did not contain executable ${clangdBinaryName}`
        );
      }
      const targetClangd = path.join(binDir, clangdBinaryName);
      await fs.promises.copyFile(foundClangd, targetClangd);
      if (os.platform() !== "win32") {
        await fs.promises.chmod(targetClangd, 0o755);
      }

      // 2. Locate and copy lib directory (contains builtin includes)
      const foundLib = await findItemRecursive(extractDir, "lib", "dir");
      if (foundLib) {
        const targetLib = path.join(storageRoot, "lib");
        await copyDirectory(foundLib, targetLib);
      }

      // 3. Check for clang-format in zip if present
      const clangFormatName = getBinaryName("clang-format");
      const foundFormat = await findItemRecursive(
        extractDir,
        clangFormatName,
        "file"
      );
      if (foundFormat) {
        const targetFormat = path.join(binDir, clangFormatName);
        await fs.promises.copyFile(foundFormat, targetFormat);
        if (os.platform() !== "win32") {
          await fs.promises.chmod(targetFormat, 0o755);
        }

        // If settings formatterPath is unset, point it to the fallback binary
        if (!settings.formatterPath || settings.formatterPath.trim() === "") {
          try {
            await settings.update("formatter.path", targetFormat, true);
            outputChannel?.appendLine(
              `[LanguageBinaries] Formatter fallback configured: ${targetFormat}`
            );
          } catch {
            // Ignore if settings cannot be updated in this context
          }
        }
      }
    },
    storagePath,
  });
}

/**
 * Coordinates resolution, downloading, and verification of both language binaries.
 */
export class LanguageBinariesManager {
  readonly als: ManagedBinary;
  readonly clangd: ManagedBinary;
  private readonly outputChannel?: vscode.OutputChannel;
  private readonly settings: ArduinoSettings;

  constructor(
    storagePath: string,
    settings: ArduinoSettings,
    outputChannel?: vscode.OutputChannel
  ) {
    this.settings = settings;
    this.outputChannel = outputChannel;
    this.als = createAlsBinary(storagePath, settings, outputChannel);
    this.clangd = createClangdBinary(storagePath, settings, outputChannel);
  }

  /**
   * Resolves both binaries. Returns paths or null if either is missing.
   */
  async resolveBinaries(): Promise<{
    alsPath: string | null;
    clangdPath: string | null;
  }> {
    const alsPath = await this.als.resolvePath();
    const clangdPath = await this.clangd.resolvePath();
    return { alsPath, clangdPath };
  }

  /**
   * Checks if both binaries are installed/resolved.
   */
  async isReady(): Promise<boolean> {
    const { alsPath, clangdPath } = await this.resolveBinaries();
    return Boolean(alsPath && clangdPath);
  }

  /**
   * Ensures both ALS and Clangd are available, downloading any missing binary.
   */
  async ensureBinaries(
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<{ alsPath: string; clangdPath: string }> {
    let alsPath = await this.als.resolvePath();
    if (!alsPath) {
      this.outputChannel?.appendLine(
        "[LanguageBinaries] Arduino Language Server missing. Downloading..."
      );
      alsPath = await this.als.download(
        this.settings.languageServerVersion,
        progress
      );
    }

    let clangdPath = await this.clangd.resolvePath();
    if (!clangdPath) {
      this.outputChannel?.appendLine(
        "[LanguageBinaries] Clangd missing. Downloading..."
      );
      clangdPath = await this.clangd.download(
        this.settings.clangdVersion,
        progress
      );
    }

    return { alsPath, clangdPath };
  }
}
