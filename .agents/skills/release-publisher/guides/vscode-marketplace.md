# VS Code Marketplace Publishing Guide

This guide explains how to set up publishing for VS Code extensions to the Visual Studio Code Marketplace using `@vscode/vsce`.

When the user asks to set up VS Code Marketplace publishing, use this guide to create or update their `.github/workflows/release.yml` file. If they need to perform manual steps (like creating a publisher ID or generating an access token), explain them clearly to the user.

## GitHub Actions Workflow

Below is an example workflow for publishing to the VS Code Marketplace. Adapt this workflow based on the package manager and required scripts (e.g., build, test) in the user's repository.

```yml
name: Release Publish

on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  publish:
    name: Publish VS Code Extension
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build extension
        run: npm run build

      - name: Publish to VS Code Marketplace
        run: npx @vscode/vsce publish
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

### Pre-release vs Stable Publishing

If publishing a pre-release version (e.g., `1.2.0-rc.1` or when releasing from a pre-release channel), pass `--pre-release` to `@vscode/vsce`:

```yml
      - name: Publish pre-release to VS Code Marketplace
        run: npx @vscode/vsce publish --pre-release
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

### Platform-Specific Extensions

For extensions with platform-native binaries (e.g., C++ native modules or Rust binaries), package for target platforms:

```yml
      - name: Publish target platform build
        run: npx @vscode/vsce publish --target linux-x64
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

## Manual Setup Steps for the User

Inform the user they must complete these setup steps before the workflow will succeed:

1. **Publisher Account:**
   - Go to [Visual Studio Marketplace Management Portal](https://marketplace.visualstudio.com/manage) and sign in with a Microsoft account.
   - Create a publisher ID (e.g., `my-publisher`).
   - Ensure `package.json` contains `"publisher": "my-publisher"`.

2. **Personal Access Token (PAT):**
   - Log in to [Azure DevOps](https://dev.azure.com/).
   - Click **User settings** (top-right avatar icon) -> **Personal access tokens**.
   - Click **New Token**.
   - Set **Organization** to `All accessible organizations`.
   - Set **Scopes** to `Marketplace (Publish)` (or select Custom Defined -> Marketplace -> Publish).
   - Copy the generated token string.

3. **GitHub Secret:**
   - In the GitHub repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
   - Create a new repository secret named `VSCE_PAT` with the PAT as the value.
