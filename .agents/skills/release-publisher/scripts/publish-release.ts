#!/usr/bin/env bun

/**
 * Creates and pushes a release tag, then creates a GitHub Release from a
 * prepared notes file. Requires an explicit --confirm flag for safety.
 */

import { existsSync, readFileSync } from "node:fs";
import { parseArgs, runCommand, runCommandOptional } from "./lib";

const ensureTagDoesNotExist = (tag: string): void => {
  const existingLocalTag = runCommandOptional([
    "git",
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/tags/${tag}`,
  ]);
  if (existingLocalTag) {
    throw new Error(`Tag "${tag}" already exists locally.`);
  }

  const existingRemoteTag = runCommandOptional([
    "git",
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
  ]);
  if (existingRemoteTag) {
    throw new Error(`Tag "${tag}" already exists on origin.`);
  }
};

const ensureReleaseDoesNotExist = (tag: string): void => {
  const existingRelease = runCommandOptional(["gh", "release", "view", tag]);
  if (existingRelease) {
    throw new Error(`GitHub Release for tag "${tag}" already exists.`);
  }
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  const confirmed = args.flags.has("confirm");
  if (!confirmed) {
    throw new Error(
      "Missing --confirm. Review draft outputs with the user before publishing."
    );
  }

  const version = args.values.get("version");
  if (!version) {
    throw new Error("Missing --version.");
  }

  const tag = args.values.get("tag") ?? `v${version}`;
  const title = args.values.get("title") ?? tag;
  const notesPath =
    args.values.get("notes-file") ?? ".release/release-notes.md";
  const target = args.values.get("target");
  const draft = args.flags.has("draft");
  const prerelease = args.flags.has("prerelease");
  const skipTag = args.flags.has("skip-tag");

  if (!existsSync(notesPath)) {
    throw new Error(`Release notes file not found at "${notesPath}".`);
  }

  readFileSync(notesPath, "utf8");
  runCommand(["gh", "auth", "status"]);
  ensureReleaseDoesNotExist(tag);

  if (!skipTag) {
    ensureTagDoesNotExist(tag);
    runCommand(["git", "tag", "-a", tag, "-m", title]);
    runCommand(["git", "push", "origin", tag]);
  }

  const releaseCommand = [
    "gh",
    "release",
    "create",
    tag,
    "--title",
    title,
    "--notes-file",
    notesPath,
  ];

  if (target) {
    releaseCommand.push("--target", target);
  }
  if (draft) {
    releaseCommand.push("--draft");
  }
  if (prerelease) {
    releaseCommand.push("--prerelease");
  }

  runCommand(releaseCommand);

  const summary = {
    createdRelease: true,
    tag,
    title,
    notesPath,
    draft,
    prerelease,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main();
