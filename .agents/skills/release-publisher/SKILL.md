---
name: release-publisher
description: Automate releasing packages/apps/products to GitHub repositories. Use this whenever the user asks to release, publish, ship a new version, bump a version, create tags, generate changelog/release notes, or prepare a GitHub Release. Always use this skill for release automation requests, including npm/GitHub Packages/VS Code Marketplace/Open VSX publishing and release workflow setup.
---

# Release Publisher

Use this skill to run an end-to-end release flow with deterministic outputs and explicit user approval before mutating repository state.

## Why this skill exists

Releases often fail because teams do release tasks manually and out of order. This skill standardizes the process so every release has:

1. Commits gathered since the last release/tag
2. Draft release notes and changelog content
3. A clear confirmation checkpoint
4. A created tag + GitHub Release
5. Workflow-based publishing (with automatic `release.yml` creation when missing)

## Trigger guidance

Use this skill when users ask for anything related to:

- publish/release/ship/version bump
- changelog generation or release notes drafting
- tagging versions and creating GitHub releases
- release automation via GitHub Actions
- publishing to npm, GitHub Packages, VS Code Marketplace, Open VSX, or another registry

## Required inputs

Collect these before execution:

- `version` (for example: `1.4.0`)
- target registries (for example: `npm,github-packages`)
- release channel (`stable` or `prerelease`)
- whether the user wants `draft` release first

## Release workflow

Follow these steps in order.

### 1) Ensure release workflow exists

Detect whether a release workflow already exists in `.github/workflows/`. If none exists or it needs to be updated for a specific registry, read the corresponding guide in the `guides/` directory of this skill:
- `guides/npm.md` for npm registry
- `guides/github-packages.md` for GitHub Packages
- `guides/vscode-marketplace.md` for VS Code Marketplace
- `guides/open-vsx.md` for Open VSX Registry

Use these guides to create or update `.github/workflows/release.yml`. If the registry requires manual setup from the user (e.g., configuring Trusted Publishing in NPM, setting up Azure DevOps PAT for VS Code Marketplace, claiming a namespace on Open VSX, or adding a scope in `package.json`), you MUST explain these steps to the user clearly.

### 2) Build release draft from commit history

Create draft artifacts from commits since the latest tag/release:

```bash
bun run .agents/skills/release-publisher/scripts/prepare-release.ts --version 1.4.0
```

Artifacts written to `.release/`:
- `commits.json`
- `release-notes.md`
- `changelog-entry.md`

**Important:** Because this step creates a `.release` folder in the project root, ensure that `.release/` or `.release` is added to the repository's `.gitignore` file to avoid pushing it into the remote repository.

### 3) **Mandatory confirmation checkpoint**

Before mutating files, tags, or GitHub releases:

1. Show the generated release notes/changelog draft to the user
2. Show the planned tag and release title
3. Show whether `release.yml` will be created/updated
4. Ask for explicit confirmation

Do not continue until the user confirms.

### 4) Apply changelog update after approval

```bash
bun run .agents/skills/release-publisher/scripts/prepare-release.ts \
  --version 1.4.0 \
  --apply-changelog
```

### 5) Create tag and GitHub release

```bash
bun run .agents/skills/release-publisher/scripts/publish-release.ts \
  --version 1.4.0 \
  --confirm
```

Optional flags:
- `--draft`
- `--prerelease`
- `--tag v1.4.0`
- `--title "v1.4.0"`

## Output format

Respond with this structure:

```markdown
## Release plan
- Version:
- Last tag:
- Commits found:
- Registries:
- Workflow status:

## Draft notes
<content from .release/release-notes.md>

## Draft changelog entry
<content from .release/changelog-entry.md>

## Confirmation required
Proceed with changelog + tag + GitHub Release? (yes/no)
```

After completion:

```markdown
## Release complete
- Tag:
- GitHub Release:
- Changelog path:
- Workflow path:
- Publishing trigger:
```

## Safety rules

- Fail fast on command errors; do not silently continue.
- Never create a release without user confirmation.
- If no previous tag exists, use full commit history and state this clearly.
- Do not edit unrelated files.
