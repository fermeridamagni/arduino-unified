import { existsSync, mkdirSync, readFileSync } from "node:fs";

const textDecoder = new TextDecoder();

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

interface ParsedArgs {
  flags: Set<string>;
  positionals: string[];
  values: Map<string, string>;
}

interface PackageJsonShape {
  packageManager?: string;
  scripts?: Record<string, string>;
  version?: string;
}

export const parseArgs = (argv: string[]): ParsedArgs => {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    if (withoutPrefix.length === 0) {
      continue;
    }

    const [key, inlineValue] = withoutPrefix.split("=", 2);
    if (inlineValue !== undefined) {
      values.set(key, inlineValue);
      continue;
    }

    const nextToken = argv[index + 1];
    if (nextToken && !nextToken.startsWith("--")) {
      values.set(key, nextToken);
      index += 1;
      continue;
    }

    flags.add(key);
  }

  return { flags, values, positionals };
};

export const getRequiredValue = (
  args: ParsedArgs,
  key: string,
  description: string
): string => {
  const value = args.values.get(key);
  if (!value) {
    throw new Error(`Missing --${key}. ${description}`);
  }

  return value;
};

export const runCommand = (
  command: string[],
  options: CommandOptions = {}
): string => {
  const spawned = Bun.spawnSync({
    cmd: command,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = textDecoder.decode(spawned.stdout).trim();
  const stderr = textDecoder.decode(spawned.stderr).trim();

  if (spawned.exitCode !== 0) {
    const details = [
      `Command failed: ${command.join(" ")}`,
      stdout ? `stdout:\n${stdout}` : undefined,
      stderr ? `stderr:\n${stderr}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
    throw new Error(details);
  }

  return stdout;
};

export const runCommandOptional = (
  command: string[],
  options: CommandOptions = {}
): string | undefined => {
  const spawned = Bun.spawnSync({
    cmd: command,
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (spawned.exitCode !== 0) {
    return;
  }

  return textDecoder.decode(spawned.stdout).trim();
};

const readPackageJson = (cwd: string): PackageJsonShape | undefined => {
  const packageJsonPath = `${cwd}/package.json`;
  if (!existsSync(packageJsonPath)) {
    return;
  }

  const content = readFileSync(packageJsonPath, "utf8");
  return JSON.parse(content) as PackageJsonShape;
};

export const detectPackageManager = (cwd: string): PackageManager => {
  const packageJson = readPackageJson(cwd);
  const packageManagerField = packageJson?.packageManager;

  if (packageManagerField) {
    const manager = packageManagerField.split("@", 1)[0];
    if (
      manager === "bun" ||
      manager === "npm" ||
      manager === "pnpm" ||
      manager === "yarn"
    ) {
      return manager;
    }
  }

  if (existsSync(`${cwd}/bun.lock`) || existsSync(`${cwd}/bun.lockb`)) {
    return "bun";
  }

  if (existsSync(`${cwd}/pnpm-lock.yaml`)) {
    return "pnpm";
  }

  if (existsSync(`${cwd}/yarn.lock`)) {
    return "yarn";
  }

  return "npm";
};

export const getPackageVersion = (cwd: string): string | undefined =>
  readPackageJson(cwd)?.version;

export const hasScript = (cwd: string, scriptName: string): boolean => {
  const scripts = readPackageJson(cwd)?.scripts;
  return Boolean(scripts?.[scriptName]);
};

export const getInstallCommand = (manager: PackageManager): string => {
  if (manager === "bun") {
    return "bun install --frozen-lockfile";
  }

  if (manager === "pnpm") {
    return "pnpm install --frozen-lockfile";
  }

  if (manager === "yarn") {
    return "yarn install --immutable";
  }

  return "npm ci";
};

export const getRunScriptCommand = (
  manager: PackageManager,
  scriptName: string
): string => {
  if (manager === "bun") {
    return `bun run ${scriptName}`;
  }

  return `${manager} run ${scriptName}`;
};

export const ensureDirectory = (directoryPath: string): void => {
  mkdirSync(directoryPath, { recursive: true });
};
