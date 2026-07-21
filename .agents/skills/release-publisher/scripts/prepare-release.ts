#!/usr/bin/env bun

/**
 * Generates release draft artifacts from Git history so release owners can review
 * notes/changelog content before mutating repository state.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureDirectory,
  getPackageVersion,
  parseArgs,
  runCommand,
  runCommandOptional,
} from "./lib";

interface CommitRecord {
  author: string;
  date: string;
  sha: string;
  shortSha: string;
  subject: string;
  type: CommitType;
}

type CommitType =
  | "feat"
  | "fix"
  | "perf"
  | "refactor"
  | "docs"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "other";

const delimiter = "\u001f";
const newlinePattern = /\r?\n/;
const changelogHeadingPattern = /^#\s*changelog\s*$/i;

const commitTypeLabels: Record<CommitType, string> = {
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  refactor: "Refactors",
  docs: "Documentation",
  test: "Tests",
  build: "Build",
  ci: "CI",
  chore: "Chores",
  other: "Other Changes",
};

const orderedCommitTypes: CommitType[] = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "other",
];

const conventionalCommitPattern = /^([a-z]+)(?:\([^)]+\))?!?:\s+(.+)$/;

const parseCommitType = (subject: string): CommitType => {
  const matched = subject.match(conventionalCommitPattern);
  if (!matched) {
    return "other";
  }

  const parsedType = matched[1];
  if (
    parsedType === "feat" ||
    parsedType === "fix" ||
    parsedType === "perf" ||
    parsedType === "refactor" ||
    parsedType === "docs" ||
    parsedType === "test" ||
    parsedType === "build" ||
    parsedType === "ci" ||
    parsedType === "chore"
  ) {
    return parsedType;
  }

  return "other";
};

const getLastTag = (providedTag: string | undefined): string | undefined => {
  if (providedTag) {
    return providedTag;
  }

  return runCommandOptional(["git", "describe", "--tags", "--abbrev=0"]);
};

const collectCommits = (
  lastTag: string | undefined,
  toRef: string
): CommitRecord[] => {
  const range = lastTag ? `${lastTag}..${toRef}` : toRef;
  const gitLogOutput = runCommand([
    "git",
    "log",
    range,
    "--date=short",
    "--pretty=format:%H%x1f%s%x1f%an%x1f%ad",
  ]);

  if (gitLogOutput.length === 0) {
    return [];
  }

  return gitLogOutput.split("\n").map((line) => {
    const [sha, subject, author, date] = line.split(delimiter);
    return {
      sha,
      shortSha: sha.slice(0, 7),
      subject,
      author,
      date,
      type: parseCommitType(subject),
    };
  });
};

const renderCommitSections = (commits: CommitRecord[]): string => {
  const grouped = new Map<CommitType, CommitRecord[]>();
  for (const commitType of orderedCommitTypes) {
    grouped.set(commitType, []);
  }

  for (const commit of commits) {
    grouped.get(commit.type)?.push(commit);
  }

  const sections: string[] = [];
  for (const commitType of orderedCommitTypes) {
    const entries = grouped.get(commitType);
    if (!entries || entries.length === 0) {
      continue;
    }

    sections.push(`### ${commitTypeLabels[commitType]}`);
    for (const entry of entries) {
      sections.push(`- ${entry.subject} (${entry.shortSha})`);
    }
    sections.push("");
  }

  return sections.join("\n").trimEnd();
};

const createReleaseNotes = (params: {
  title: string;
  releaseDate: string;
  lastTag: string | undefined;
  commits: CommitRecord[];
}): string => {
  const metadata: string[] = [
    `# ${params.title}`,
    "",
    `Release date: ${params.releaseDate}`,
    `Commits included: ${params.commits.length}`,
    params.lastTag
      ? `Previous tag: ${params.lastTag}`
      : "Previous tag: none (full history)",
    "",
    "## Summary",
    "",
    renderCommitSections(params.commits),
    "",
  ];

  return metadata.join("\n");
};

const createChangelogEntry = (params: {
  title: string;
  releaseDate: string;
  lastTag: string | undefined;
  commits: CommitRecord[];
}): { sectionHeading: string; content: string } => {
  const sectionHeading = `## ${params.title} - ${params.releaseDate}`;
  const lines: string[] = [
    sectionHeading,
    "",
    params.lastTag
      ? `Compared to \`${params.lastTag}\``
      : "Compared to the initial repository history",
    "",
    renderCommitSections(params.commits),
    "",
  ];

  return {
    sectionHeading,
    content: lines.join("\n"),
  };
};

const updateChangelog = (
  changelogPath: string,
  sectionHeading: string,
  changelogEntry: string
): void => {
  const normalizedEntry = `${changelogEntry.trim()}\n\n`;
  if (!existsSync(changelogPath)) {
    const created = `# Changelog\n\n${normalizedEntry}`;
    writeFileSync(changelogPath, created, "utf8");
    return;
  }

  const current = readFileSync(changelogPath, "utf8");
  if (current.includes(sectionHeading)) {
    return;
  }

  const lines = current.split(newlinePattern);
  const changelogHeadingIndex = lines.findIndex((line) =>
    changelogHeadingPattern.test(line.trim())
  );

  if (changelogHeadingIndex === -1) {
    const updated = `# Changelog\n\n${normalizedEntry}${current.trimStart()}\n`;
    writeFileSync(changelogPath, updated, "utf8");
    return;
  }

  const before = lines
    .slice(0, changelogHeadingIndex + 1)
    .join("\n")
    .trimEnd();
  const after = lines
    .slice(changelogHeadingIndex + 1)
    .join("\n")
    .trimStart();
  const updated = `${before}\n\n${normalizedEntry}${after ? `${after}\n` : ""}`;
  writeFileSync(changelogPath, updated, "utf8");
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  const autoVersion = getPackageVersion(process.cwd());
  const version = args.values.get("version") ?? autoVersion;
  if (!version) {
    throw new Error(
      "Version is required. Pass --version or set package.json version."
    );
  }

  const toRef = args.values.get("to-ref") ?? "HEAD";
  const outputDir = args.values.get("output-dir") ?? ".release";
  const changelogPath = args.values.get("changelog-path") ?? "CHANGELOG.md";
  const releaseDate =
    args.values.get("date") ?? new Date().toISOString().slice(0, 10);
  const title = args.values.get("title") ?? `v${version}`;

  const lastTag = getLastTag(args.values.get("from-tag"));
  const commits = collectCommits(lastTag, toRef);
  const releaseNotes = createReleaseNotes({
    title,
    releaseDate,
    lastTag,
    commits,
  });
  const changelogEntry = createChangelogEntry({
    title,
    releaseDate,
    lastTag,
    commits,
  });

  ensureDirectory(outputDir);
  writeFileSync(
    join(outputDir, "commits.json"),
    `${JSON.stringify(commits, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(join(outputDir, "release-notes.md"), releaseNotes, "utf8");
  writeFileSync(
    join(outputDir, "changelog-entry.md"),
    changelogEntry.content,
    "utf8"
  );

  const applyChangelog = args.flags.has("apply-changelog");
  if (applyChangelog) {
    updateChangelog(
      changelogPath,
      changelogEntry.sectionHeading,
      changelogEntry.content
    );
  }

  const summary = {
    version,
    title,
    lastTag: lastTag ?? null,
    commitCount: commits.length,
    outputDir,
    changelogPath,
    changelogApplied: applyChangelog,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

main();
