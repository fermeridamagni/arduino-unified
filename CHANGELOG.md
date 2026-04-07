# Change Log

All notable changes to the "arduino-unified" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.1] - 2026-04-07

### 🐛 Bug Fixes
- **Critical**: Fix webview build not included in published extension
  - Add `compile-webview` step to package script to ensure webview is built before packaging
  - Include `webview/dist/` in published extension via `.vscodeignore` exclusion rule
  - Resolves "Webview build not found" error when using Install Library command
- Correct formatting in FUNDING.yml for GitHub Sponsors configuration
- Ensure CI triggers on specified paths for push and pull_request events

### ♻️ Other Changes
- Update `.vscodeignore` to include additional directories and files
- Remove PLAN.md file containing project research and implementation details

## [1.0.0] - 2026-04-07

Arduino Unified 1.0.0 is the first stable release of the extension.

### ✨ Features
- Add Arduino-specific Chat Tools for Copilot integration.
- Implement activation logic for Arduino Unified extension with service initialization and command registration.
- Implement LibraryManager for managing Arduino libraries with search, install, and uninstall functionality.
- Implement webview for library and platform management.
- Add comprehensive test suite for Arduino Unified extension.
- Add GitHub issue templates and CI/CD workflows for better project management.
- Add publishing guide for Arduino Unified to VS Code Marketplace and Open VSX Registry.
- Add new resource icons and screenshots for improved user experience.
- Update CI configuration and package settings for Node.js 20+ compatibility.
- Normalize paths for cross-platform testing in extension tests.
- Add .gitattributes file to manage line endings and binary files.
- Upgrade GitHub Actions to latest versions and update Node.js to 22.
- Upgrade GitHub Actions and pnpm to latest versions.
- Reorder Node.js setup and pnpm installation in CI workflows.
- Update VS Code version requirements to 1.107.0 in documentation and configuration files.

### 🐛 Bug Fixes
- Update copyright and source links in README.md for clarity.
- Update the VSCE package command to exclude dependencies in CI and publishing workflows.

### ♻️ Other Changes
- Update dependencies.

## [Unreleased]
