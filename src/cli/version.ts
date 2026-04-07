/**
 * Supported Arduino CLI major version range.
 * We support Arduino CLI 1.x releases.
 */
const SUPPORTED_MAJOR = 1;
const MIN_VERSION = "1.0.0";

/**
 * Version compatibility information.
 */
export interface VersionInfo {
  /** Whether this version is compatible with the extension */
  compatible: boolean;
  /** Parsed major version number */
  major: number;
  /** Human-readable compatibility message */
  message: string;
  /** Parsed minor version number */
  minor: number;
  /** Parsed patch version number */
  patch: number;
  /** The raw version string from the CLI */
  version: string;
}

/**
 * Parses a version string like "1.4.1" or "v1.4.1" into components.
 */
function parseVersion(
  version: string
): { major: number; minor: number; patch: number } | null {
  const cleaned = version.replace(/^v/, "").trim();
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Compares two version tuples.
 * Returns negative if a < b, zero if equal, positive if a > b.
 */
function compareVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/**
 * Checks whether a given Arduino CLI version string is compatible
 * with this extension.
 *
 * Compatibility rules:
 * - Must be a valid semver-like version string
 * - Must be >= 1.0.0
 * - Must be 1.x (major version = 1)
 *
 * @param version - The version string from `arduino-cli version` or gRPC Version RPC
 * @returns VersionInfo with compatibility details
 */
export function checkVersionCompatibility(version: string): VersionInfo {
  const parsed = parseVersion(version);
  const minParsed = parseVersion(MIN_VERSION);

  if (!parsed) {
    return {
      version,
      compatible: false,
      message: `Could not parse Arduino CLI version: "${version}". Expected format: x.y.z`,
      major: 0,
      minor: 0,
      patch: 0,
    };
  }

  if (parsed.major !== SUPPORTED_MAJOR) {
    return {
      version,
      compatible: false,
      message:
        `Arduino CLI version ${version} is not supported. ` +
        `Arduino Unified requires Arduino CLI ${SUPPORTED_MAJOR}.x ` +
        `(found major version ${parsed.major}).`,
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
    };
  }

  if (minParsed && compareVersions(parsed, minParsed) < 0) {
    return {
      version,
      compatible: false,
      message:
        `Arduino CLI version ${version} is too old. ` +
        `Minimum required version is ${MIN_VERSION}.`,
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
    };
  }

  return {
    version,
    compatible: true,
    message: `Arduino CLI ${version} is compatible.`,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
  };
}

/**
 * Returns the supported version range as a human-readable string.
 */
export function getSupportedVersionRange(): string {
  return `${SUPPORTED_MAJOR}.x (>= ${MIN_VERSION})`;
}

/**
 * Formats version info into a display string for the status bar.
 */
export function formatVersionDisplay(info: VersionInfo): string {
  if (info.compatible) {
    return `Arduino CLI v${info.version}`;
  }
  return `Arduino CLI v${info.version} ⚠️`;
}
