# Open VSX Registry Publishing Guide

This guide explains how to set up publishing for VS Code extensions to the Open VSX Registry using `ovsx`.

When the user asks to set up Open VSX publishing, use this guide to create or update their `.github/workflows/release.yml` file. If they need to perform manual steps (like claiming a namespace or generating an access token), explain them clearly to the user.

## GitHub Actions Workflow

Below is an example workflow for publishing to the Open VSX Registry. Adapt this workflow based on the package manager and required scripts (e.g., build, test) in the user's repository.

```yml
name: Release Publish

on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  publish:
    name: Publish extension to Open VSX
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

      - name: Publish to Open VSX Registry
        run: npx ovsx publish
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}
```

### Pre-release Publishing

If publishing a pre-release version, pass `--pre-release` to `ovsx`:

```yml
      - name: Publish pre-release to Open VSX Registry
        run: npx ovsx publish --pre-release
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}
```

### Dual Publishing (VS Code Marketplace + Open VSX)

When publishing to both VS Code Marketplace and Open VSX Registry, it is best practice to package the `.vsix` bundle once using `@vscode/vsce package`, and then publish the generated `.vsix` file to both registries:

```yml
name: Release Publish

on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  publish:
    name: Publish Extension to Marketplace & Open VSX
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

      - name: Package VSIX
        run: npx @vscode/vsce package

      - name: Publish to VS Code Marketplace
        run: npx @vscode/vsce publish --packagePath *.vsix
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}

      - name: Publish to Open VSX Registry
        run: npx ovsx publish *.vsix
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}
```

## Manual Setup Steps for the User

Inform the user they must complete these setup steps before the workflow will succeed:

1. **Open VSX Account & Namespace:**
   - Go to [open-vsx.org](https://open-vsx.org/) and log in via GitHub.
   - Ensure you have claimed the namespace matching the `publisher` field in your `package.json`. If the namespace does not exist, create it under **User Profile** -> **Namespaces**.

2. **Access Token:**
   - Go to [open-vsx.org Settings](https://open-vsx.org/user-settings/tokens) (under your User Profile -> Access Tokens).
   - Generate a new Access Token.
   - Copy the generated token string.

3. **GitHub Secret:**
   - In the GitHub repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
   - Create a new repository secret named `OVSX_PAT` (or `OPENVSX_TOKEN`) with the token as the value.
