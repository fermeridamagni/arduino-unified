import * as os from "node:os";

/**
 * Platform and architecture descriptor for toolchain downloads.
 */
export interface PlatformDescriptor {
  arch: string;
  archiveType: "tar.gz" | "zip";
  extension: string;
  os: string;
  rawArch: string;
  rawPlatform: NodeJS.Platform;
}

/**
 * Download base URLs.
 */
export const ARDUINO_CLI_DOWNLOAD_BASE =
  "https://downloads.arduino.cc/arduino-cli";
export const ALS_DOWNLOAD_BASE =
  "https://github.com/arduino/arduino-language-server/releases/download";
export const CLANGD_DOWNLOAD_BASE =
  "https://github.com/clangd/clangd/releases/download";

/**
 * Architecture mapping from Node.js arch identifiers to toolchain release naming.
 */
const ARCH_MAP: Record<string, string> = {
  arm: "ARMv7",
  arm64: "ARM64",
  ia32: "32bit",
  x64: "64bit",
};

/**
 * Detects the current or requested platform and architecture.
 *
 * @param customPlatform - Optional override for platform (useful for tests)
 * @param customArch - Optional override for architecture (useful for tests)
 * @returns PlatformDescriptor describing the target environment
 */
export function detectPlatform(
  customPlatform?: NodeJS.Platform,
  customArch?: string
): PlatformDescriptor {
  const platform = customPlatform ?? os.platform();
  const arch = customArch ?? os.arch();

  const mappedArch = ARCH_MAP[arch];
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
        rawPlatform: platform,
        rawArch: arch,
      };
    case "linux":
      return {
        os: "Linux",
        arch: mappedArch,
        extension: ".tar.gz",
        archiveType: "tar.gz",
        rawPlatform: platform,
        rawArch: arch,
      };
    case "win32":
      return {
        os: "Windows",
        arch: mappedArch,
        extension: ".zip",
        archiveType: "zip",
        rawPlatform: platform,
        rawArch: arch,
      };
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Returns the platform-specific executable filename (appending .exe on Windows).
 *
 * @param baseName - Base executable name (e.g. "arduino-cli", "clangd")
 * @param platform - Target platform (defaults to current process platform)
 */
export function getBinaryName(
  baseName: string,
  platform: NodeJS.Platform = os.platform()
): string {
  return platform === "win32" ? `${baseName}.exe` : baseName;
}

/**
 * Constructs the download URL for an Arduino CLI release.
 */
export function getArduinoCliDownloadUrl(
  version: string,
  platform: PlatformDescriptor = detectPlatform()
): string {
  const filename = `arduino-cli_${version}_${platform.os}_${platform.arch}${platform.extension}`;
  return `${ARDUINO_CLI_DOWNLOAD_BASE}/${filename}`;
}

/**
 * Constructs the download URL for an Arduino Language Server release.
 */
export function getAlsDownloadUrl(
  version: string,
  platform: PlatformDescriptor = detectPlatform()
): string {
  const filename = `arduino-language-server_${version}_${platform.os}_${platform.arch}${platform.extension}`;
  return `${ALS_DOWNLOAD_BASE}/${version}/${filename}`;
}

/**
 * Constructs the download URL for a Clangd GitHub release.
 * Clangd GitHub releases provide universal/x86_64 zip archives for macOS, Linux, and Windows.
 */
export function getClangdDownloadUrl(
  version: string,
  platform: NodeJS.Platform = os.platform()
): string {
  let target: string;
  switch (platform) {
    case "darwin":
      target = "mac";
      break;
    case "linux":
      target = "linux";
      break;
    case "win32":
      target = "windows";
      break;
    default:
      throw new Error(`Unsupported platform for clangd: ${platform}`);
  }

  const filename = `clangd-${target}-${version}.zip`;
  return `${CLANGD_DOWNLOAD_BASE}/${version}/${filename}`;
}
