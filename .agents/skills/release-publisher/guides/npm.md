# NPM Trusted Publishing Guide

This guide explains how to set up publishing to the NPM registry using Trusted Publishing (OIDC).

When the user asks to set up NPM publishing, use this guide to create or update their `.github/workflows/release.yml` file. If they need to perform manual steps (like linking the repository to NPM), explain them clearly to the user.

## GitHub Actions Workflow

Below is an example workflow for Trusted Publishing. You should adapt this workflow based on the package manager and required scripts (e.g., build, test) in the user's repository.

```yml
name: Release Publish

on:
  release:
    types: [published]

permissions:
  contents: write
  packages: write
  id-token: write # Required to fetch the OIDC token from GitHub

jobs:
  publish:
    name: Publish release artifacts
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v7

      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 22
          registry-url: "https://registry.npmjs.org"
          package-manager-cache: false # never use caching in release builds

      - name: Setup Bun (if applicable) # (if applicable)
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build package
        run: bun run build

      - name: Publish to npm
        run: npm publish --provenance
```

## Manual Setup Steps for the User

Inform the user they must configure Trusted Publishing in their NPM account:
1. Go to the NPM website and log in.
2. Navigate to the package settings (or create an organization/package if it doesn't exist).
3. Go to the **Access** or **Settings** tab and configure "Trusted Publishers".
4. Add the GitHub repository, specifying the exact owner, repository name, and (if applicable) the workflow environment or filename.

This process removes the need for `NPM_TOKEN` secrets in the GitHub repository.
