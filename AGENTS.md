# Project Guidelines

This project is a VSCODE or VSX extension that provides tools for Arduino development directly in the editor. It is designed to enhance the development experience for Arduino developers by integrating various features and functionalities.

## Rules

- Document and explain why the code is for.
- Get pre-indexed knowledge about the project using the Codegraph MCP.
- Always use up-to-date info with the Context7 MCP or searching the web.
- Always use Bun as the package manager and runtime environment.
- Always use TypeScript instead of Javascript.
  - After writing a `ts` or `tsx` run `bun run check-types` to check for type errors.
- Always use Ultracite (Biome's zero-config preset) for code formatting and linting.
  - Most issues are automatically fixable with `bun fix`.
  - Before start writing a `ts` or `tsx` file, check the [Ultracite Code Standards](ULTRACITE.md).
