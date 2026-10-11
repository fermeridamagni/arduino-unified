import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Calculates the SHA-256 checksum of a file.
 *
 * @param filePath - Path of the file to hash
 * @returns Hex-encoded SHA-256 digest
 */
export async function calculateChecksum(filePath: string): Promise<string> {
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
 *
 * @param url - Source URL to download
 * @param destPath - Destination file path
 * @param onProgress - Optional callback reporting downloaded bytes and total size
 */
export async function downloadFile(
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
 * Extracts a tar.gz archive using system tar.
 *
 * @param archivePath - Path to the tar.gz file
 * @param destDir - Destination directory
 */
export async function extractTarGz(
  archivePath: string,
  destDir: string
): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  await execFileAsync("tar", ["xzf", archivePath, "-C", destDir]);
}

/**
 * Extracts a zip archive using unzip on Unix and PowerShell on Windows.
 *
 * @param archivePath - Path to the zip file
 * @param destDir - Destination directory
 */
export async function extractZip(
  archivePath: string,
  destDir: string
): Promise<void> {
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
 * Extracts an archive according to its format.
 *
 * @param archivePath - Path to archive file
 * @param destDir - Target directory
 * @param archiveType - Type of archive ('tar.gz' or 'zip')
 */
export async function extractArchive(
  archivePath: string,
  destDir: string,
  archiveType: "tar.gz" | "zip"
): Promise<void> {
  if (archiveType === "tar.gz") {
    await extractTarGz(archivePath, destDir);
  } else {
    await extractZip(archivePath, destDir);
  }
}
