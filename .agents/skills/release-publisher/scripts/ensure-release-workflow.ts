#!/usr/bin/env bun

/**
 * Ensures a repository has a release workflow that publishes artifacts after a
 * GitHub Release is published. Creates `.github/workflows/release.yml` from a
 * template when no release workflow exists.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectPackageManager,
  ensureDirectory,
  getInstallCommand,
  getRunScriptCommand,
  hasScript,
  type PackageManager,
  parseArgs,
} from "./lib";

type RegistryTarget =
  | "npm"
  | "github-packages"
  | "vscode-marketplace"
  | "open-vsx";

const releaseTriggerPattern = /(^|\n)\s*release:\s*/m;

const allowedRegistries: RegistryTarget[] = [
  "npm",
  "github-packages",
  "vscode-marketplace",
  "open-vsx",
];

const readWorkflowsWithReleaseTrigger = (
  workflowDirectory: string
): string[] => {
  if (!existsSync(workflowDirectory)) {
    return [];
  }

  const matches: string[] = [];
  const entries = readdirSync(workflowDirectory);
  for (const entry of entries) {
    const extension = extname(entry);
    if (extension !== ".yml" && extension !== ".yaml") {
      continue;
    }

    const fullPath = resolve(workflowDirectory, entry);
    const content = readFileSync(fullPath, "utf8");
    const hasReleaseTrigger = releaseTriggerPattern.test(content);
    if (hasReleaseTrigger) {
      matches.push(fullPath);
    }
  }

  return matches;
};

const parseRegistries = (value: string | undefined): RegistryTarget[] => {
  const rawRegistries = (value ?? "npm")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (rawRegistries.length === 0) {
    throw new Error("At least one registry is required.");
  }

  const unique = new Set<RegistryTarget>();
  for (const item of rawRegistries) {
    if (
      item !== "npm" &&
      item !== "github-packages" &&
      item !== "vscode-marketplace" &&
      item !== "open-vsx"
    ) {
      throw new Error(
        `Unsupported registry "${item}". Supported values: ${allowedRegistries.join(", ")}`
      );
    }
    unique.add(item);
  }

  return [...unique];
};

const buildPackageManagerSetup = (packageManager: PackageManager): string => {
  if (packageManager === "bun") {
    return [
      "      - name: Setup Bun",
      "        uses: oven-sh/setup-bun@v2",
      "        with:",
      "          bun-version: latest",
    ].join("\n");
  }

  const baseSetup = [
    "      - name: Setup Node.js",
    "        uses: actions/setup-node@v7",
    "        with:",
    "          node-version: 22",
    `          cache: ${packageManager}`,
  ];

  if (packageManager === "pnpm" || packageManager === "yarn") {
    return [
      ...baseSetup,
      "",
      "      - name: Enable Corepack",
      "        run: corepack enable",
    ].join("\n");
  }

  return baseSetup.join("\n");
};

const getPublishCommand = (
  packageManager: PackageManager,
  registryUrl: string | undefined
): string => {
  if (packageManager === "bun") {
    return registryUrl
      ? `bun publish --access public --registry ${registryUrl}`
      : "bun publish --access public";
  }

  if (packageManager === "pnpm") {
    return registryUrl
      ? `pnpm publish --no-git-checks --access public --registry ${registryUrl}`
      : "pnpm publish --no-git-checks --access public";
  }

  if (packageManager === "yarn") {
    return registryUrl
      ? `yarn npm publish --access public --publishRegistry ${registryUrl}`
      : "yarn npm publish --access public";
  }

  return registryUrl
    ? `npm publish --access public --registry ${registryUrl}`
    : "npm publish --access public";
};

const toGitHubExpression = (value: string): string => {
  const dollar = String.fromCharCode(36);
  return `${dollar}{{ ${value} }}`;
};

const buildNpmPublishSteps = (packageManager: PackageManager): string[] => {
  const steps: string[] = [];
  if (packageManager !== "bun") {
    steps.push(
      [
        "      - name: Configure npm registry auth",
        "        uses: actions/setup-node@v7",
        "        with:",
        "          node-version: 22",
        "          registry-url: https://registry.npmjs.org",
      ].join("\n")
    );
  }

  steps.push(
    [
      "      - name: Publish to npm",
      `        run: ${getPublishCommand(packageManager, "https://registry.npmjs.org")}`,
      "        env:",
      packageManager === "bun"
        ? `          BUN_AUTH_TOKEN: ${toGitHubExpression("secrets.NPM_TOKEN")}`
        : `          NODE_AUTH_TOKEN: ${toGitHubExpression("secrets.NPM_TOKEN")}`,
    ].join("\n")
  );

  return steps;
};

const buildGitHubPackagesSteps = (packageManager: PackageManager): string[] => {
  const steps: string[] = [];
  if (packageManager !== "bun") {
    steps.push(
      [
        "      - name: Configure GitHub Packages auth",
        "        uses: actions/setup-node@v7",
        "        with:",
        "          node-version: 22",
        "          registry-url: https://npm.pkg.github.com",
      ].join("\n")
    );
  }

  const tokenExpression = toGitHubExpression(
    "secrets.GITHUB_PACKAGES_TOKEN || secrets.GITHUB_TOKEN"
  );
  steps.push(
    [
      "      - name: Publish to GitHub Packages",
      `        run: ${getPublishCommand(packageManager, "https://npm.pkg.github.com")}`,
      "        env:",
      packageManager === "bun"
        ? `          BUN_AUTH_TOKEN: ${tokenExpression}`
        : `          NODE_AUTH_TOKEN: ${tokenExpression}`,
    ].join("\n")
  );

  return steps;
};

const buildVsCodeMarketplaceSteps = (
  packageManager: PackageManager
): string[] => [
  [
    "      - name: Publish VS Code extension to Marketplace",
    `        run: ${packageManager === "bun" ? "bun x" : "npx"} @vscode/vsce publish`,
    "        env:",
    `          VSCE_PAT: ${toGitHubExpression("secrets.VSCE_PAT")}`,
  ].join("\n"),
];

const buildOpenVsxSteps = (packageManager: PackageManager): string[] => [
  [
    "      - name: Publish extension to Open VSX",
    `        run: ${packageManager === "bun" ? "bun x" : "npx"} ovsx publish`,
    "        env:",
    `          OVSX_PAT: ${toGitHubExpression("secrets.OVSX_PAT")}`,
  ].join("\n"),
];

const buildPublishSteps = (
  packageManager: PackageManager,
  registries: RegistryTarget[]
): string => {
  const steps: string[] = [];

  for (const registry of registries) {
    if (registry === "npm") {
      steps.push(...buildNpmPublishSteps(packageManager));
      continue;
    }

    if (registry === "github-packages") {
      steps.push(...buildGitHubPackagesSteps(packageManager));
      continue;
    }

    if (registry === "vscode-marketplace") {
      steps.push(...buildVsCodeMarketplaceSteps(packageManager));
      continue;
    }

    steps.push(...buildOpenVsxSteps(packageManager));
  }

  return steps.join("\n\n");
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  const workflowPath =
    args.values.get("workflow-path") ?? ".github/workflows/release.yml";
  const workflowDirectory = dirname(workflowPath);
  const templatePath =
    args.values.get("template-path") ??
    fileURLToPath(
      new URL("../references/release-workflow-template.yml", import.meta.url)
    );
  const force = args.flags.has("force");

  const existingReleaseWorkflows =
    readWorkflowsWithReleaseTrigger(workflowDirectory);
  if (existingReleaseWorkflows.length > 0 && !force) {
    const summary = {
      created: false,
      reason: "existing-release-workflow-detected",
      workflows: existingReleaseWorkflows,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const registries = parseRegistries(args.values.get("registries"));
  const packageManagerArg = args.values.get("package-manager");
  const packageManager =
    packageManagerArg === "bun" ||
    packageManagerArg === "npm" ||
    packageManagerArg === "pnpm" ||
    packageManagerArg === "yarn"
      ? packageManagerArg
      : detectPackageManager(process.cwd());

  const installCommand = getInstallCommand(packageManager);
  const buildCommand = hasScript(process.cwd(), "build")
    ? getRunScriptCommand(packageManager, "build")
    : "echo 'No build script found; skipping build step.'";

  const template = readFileSync(templatePath, "utf8");
  const workflowContent = template
    .replace(
      "      # __PACKAGE_MANAGER_SETUP__",
      buildPackageManagerSetup(packageManager)
    )
    .replace("__INSTALL_COMMAND__", installCommand)
    .replace("__BUILD_COMMAND__", buildCommand)
    .replace(
      "      # __PUBLISH_STEPS__",
      buildPublishSteps(packageManager, registries)
    );

  ensureDirectory(workflowDirectory);
  writeFileSync(workflowPath, workflowContent, "utf8");

  const summary = {
    created: true,
    workflowPath,
    packageManager,
    registries,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main();
