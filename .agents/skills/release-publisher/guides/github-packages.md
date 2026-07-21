# GitHub Packages Publishing Guide

This guide explains how to set up publishing to GitHub Packages.

When the user asks to set up GitHub Packages publishing, use this guide to create or update their `.github/workflows/release.yml` file. If they need to perform manual steps (like modifying `package.json`), explain them clearly to the user.

## GitHub Actions Workflow

Below is an example workflow for publishing to GitHub Packages. Adapt this workflow based on the package manager and required scripts (e.g., build, test) in the user's repository.

```yml
name: Release Publish

on:
  release:
    types: [published]

permissions:
  contents: read
  packages: write

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
          registry-url: "https://npm.pkg.github.com"
          package-manager-cache: false # never use caching in release builds

      - name: Setup Bun # (if applicable)
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build package
        run: bun run build

      - name: Publish to GitHub Packages
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Manual Setup Steps for the User

Inform the user they must configure their `package.json` to publish to GitHub Packages:
1. Ensure the `name` field in `package.json` is scoped to their username or organization (e.g., `@username/package-name`).
2. Add a `publishConfig` section to their `package.json` pointing to GitHub Packages:
```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com"
}
```
3. Inform them that `GITHUB_TOKEN` is automatically provided by GitHub Actions; no manual secret creation is required.
