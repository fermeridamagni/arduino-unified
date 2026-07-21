import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";

/**
 * Platform/architecture descriptor for CLI download.
 */
interface PlatformDescriptor {
  arch: string;
  archiveType: "tar.gz" | "zip";
  extension: string;
  os: string;
}

/**
 * Default CLI version to download if none is specified.
 */
const DEFAULT_CLI_VERSION = "1.4.1";

/**
 * GitHub release download base URL.
 */
const DOWNLOAD_BASE = "https://downloads.arduino.cc/arduino-cli";

/**
 * Detects the current platform and architecture.
 */
function detectPlatform(): PlatformDescriptor {
  const platform = os.platform();
  const arch = os.arch();

  const archMap: Record<string, string> = {
    x64: "64bit",
    arm64: "ARM64",
    arm: "ARMv7",
    ia32: "32bit",
  };

  const mappedArch = archMap[arch];
  if (!mappedArch) {
    throw new Error(`Unsupported architecture: ${arch}`);
  }

  switch (platform) {
    case "darwin":
      return {
        os: "macOS",
        arch: mappedArch,
        extension: ".tar.gz",
        archiveType: "tar.gz",
      };
    case "linux":
      return {
        os: "Linux",
        arch: mappedArch,
        extension: ".tar.gz",
        archiveType: "tar.gz",
      };
    case "win32":
      return {
        os: "Windows",
        arch: mappedArch,
        extension: ".zip",
        archiveType: "zip",
      };
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Constructs the download URL for a given CLI version and platform.
 */
function getDownloadUrl(version: string, platform: PlatformDescriptor): string {
  const filename = `arduino-cli_${version}_${platform.os}_${platform.arch}${platform.extension}`;
  return `${DOWNLOAD_BASE}/${filename}`;
}

/**
 * Calculates the SHA-256 checksum of a file.
 */
export async function calculateChecksum(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const handle = await fs.promises.open(filePath, "r");
  const hash = createHash("sha256");
  const stream = handle.createReadStream();

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  await handle.close();
  return hash.digest("hex");
}

/**
 * Downloads a file from a URL using modern fetch API, reporting progress.
 */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (downloaded: number, total: number | null) => void
): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const contentLengthStr = response.headers.get("content-length");
  const totalSize = contentLengthStr
    ? Number.parseInt(contentLengthStr, 10)
    : null;
  let downloadedSize = 0;

  if (!response.body) {
    throw new Error("Download failed: No response body received");
  }

  const reader = response.body.getReader();
  const fileHandle = await fs.promises.open(destPath, "w");
  const stream = fileHandle.createWriteStream();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        downloadedSize += value.length;
        onProgress?.(downloadedSize, totalSize);
        if (!stream.write(value)) {
          await new Promise<void>((resolve) => stream.once("drain", resolve));
        }
      }
    }
  } finally {
    await new Promise<void>((resolve) => stream.end(resolve));
    await fileHandle.close();
  }
}

/**
 * Extracts a tar.gz archive using Node.js child_process.
 */
async function extractTarGz(
  archivePath: string,
  destDir: string
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  await fs.promises.mkdir(destDir, { recursive: true });
  await execFileAsync("tar", ["xzf", archivePath, "-C", destDir]);
}

/**
 * Extracts a zip archive. Uses unzip on Unix, parameterized PowerShell on Windows.
 */
async function extractZip(archivePath: string, destDir: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  await fs.promises.mkdir(destDir, { recursive: true });

  if (os.platform() === "win32") {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "param($Path, $Dest); Expand-Archive -Force -LiteralPath $Path -DestinationPath $Dest",
      archivePath,
      destDir,
    ]);
  } else {
    await execFileAsync("unzip", ["-o", archivePath, "-d", destDir]);
  }
}

/**
 * ArduinoCliDownloader handles downloading and extracting the Arduino CLI binary.
 * It downloads from the official Arduino downloads server and extracts to
 * the extension's global storage path.
 */
export class ArduinoCliDownloader {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly storagePath: string;

  constructor(outputChannel: vscode.OutputChannel, storagePath: string) {
    this.outputChannel = outputChannel;
    this.storagePath = storagePath;
  }

  /**
   * Returns the path where the CLI binary should be located.
   */
  getCliBinaryPath(): string {
    const binName =
      os.platform() === "win32" ? "arduino-cli.exe" : "arduino-cli";
    return path.join(this.storagePath, "bin", binName);
  }

  /**
   * Checks if the CLI binary is already downloaded (asynchronous).
   */
  async isCliInstalled(): Promise<boolean> {
    try {
      await fs.promises.access(this.getCliBinaryPath(), fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
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
    const platform = detectPlatform();
    const url = getDownloadUrl(version, platform);
    const binDir = path.join(this.storagePath, "bin");
    const tempDir = path.join(this.storagePath, "tmp");

    await fs.promises.mkdir(binDir, { recursive: true });
    await fs.promises.mkdir(tempDir, { recursive: true });

    const archiveName = `arduino-cli${platform.extension}`;
    const archivePath = path.join(tempDir, archiveName);

    this.outputChannel.appendLine(
      `[Downloader] Downloading Arduino CLI v${version}`
    );
    this.outputChannel.appendLine(`[Downloader] URL: ${url}`);
    this.outputChannel.appendLine(
      `[Downloader] Platform: ${platform.os} ${platform.arch}`
    );

    progress?.report({ message: `Downloading Arduino CLI v${version}...` });

    try {
      await downloadFile(url, archivePath, (downloaded, total) => {
        if (total) {
          const percent = Math.round((downloaded / total) * 100);
          progress?.report({
            message: `Downloading Arduino CLI v${version}... ${percent}%`,
            increment: 1,
          });
        }
      });

      const actualChecksum = await calculateChecksum(archivePath);
      this.outputChannel.appendLine(
        `[Downloader] Download complete. SHA-256: ${actualChecksum}`
      );

      if (
        expectedChecksum &&
        actualChecksum.toLowerCase() !== expectedChecksum.toLowerCase()
      ) {
        throw new Error(
          `Checksum mismatch for downloaded binary. Expected: ${expectedChecksum}, got: ${actualChecksum}`
        );
      }

      progress?.report({ message: "Extracting Arduino CLI..." });

      if (platform.archiveType === "tar.gz") {
        await extractTarGz(archivePath, binDir);
      } else {
        await extractZip(archivePath, binDir);
      }

      // Make binary executable on Unix
      const binaryPath = this.getCliBinaryPath();
      if (os.platform() !== "win32") {
        await fs.promises.chmod(binaryPath, 0o755);
      }

      // Clean up temp files
      await fs.promises.rm(tempDir, { recursive: true, force: true });

      this.outputChannel.appendLine(
        `[Downloader] Arduino CLI v${version} installed to ${binaryPath}`
      );
      return binaryPath;
    } catch (error) {
      // Clean up on failure
      await fs.promises.rm(archivePath, { force: true }).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to download Arduino CLI: ${message}`);
    }
  }

  /**
   * Removes the installed CLI binary.
   */
  async uninstall(): Promise<void> {
    const binDir = path.join(this.storagePath, "bin");
    await fs.promises.rm(binDir, { recursive: true, force: true });
    this.outputChannel.appendLine("[Downloader] Arduino CLI uninstalled");
  }
}
