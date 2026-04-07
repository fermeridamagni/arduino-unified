# Contributing to Arduino Unified

Thank you for your interest in contributing to Arduino Unified! This document provides guidelines and instructions for contributing to the project.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

---

## 📜 Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for all contributors, regardless of:

- Experience level
- Gender identity and expression
- Sexual orientation
- Disability
- Personal appearance
- Body size
- Race
- Ethnicity
- Age
- Religion
- Nationality

### Our Standards

**Examples of behavior that contributes to a positive environment:**

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Examples of unacceptable behavior:**

- Trolling, insulting/derogatory comments, and personal attacks
- Public or private harassment
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

### Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by opening an issue or contacting the project maintainers. All complaints will be reviewed and investigated promptly and fairly.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18 or higher
- **pnpm** 8 or higher (install via `npm install -g pnpm`)
- **VS Code** 1.107.0 or higher
- **Git**

### Setting Up the Development Environment

1. **Fork the repository** on GitHub

2. **Clone your fork**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/arduino-unified.git
   cd arduino-unified
   ```

3. **Add upstream remote**:

   ```bash
   git remote add upstream https://github.com/fermeridamagni/arduino-unified.git
   ```

4. **Install dependencies**:

   ```bash
   pnpm install
   ```

5. **Build the project**:

   ```bash
   pnpm run compile
   ```

6. **Open in VS Code**:

   ```bash
   code .
   ```

7. **Press F5** to launch the Extension Development Host

---

## 🔄 Development Workflow

### Branch Naming Convention

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions or modifications

Example: `feature/serial-plotter-colors`

### Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```txt
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring without feature changes
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, build config, etc.)

**Examples:**

```txt
feat(serial): add timestamp support to serial monitor

fix(compile): resolve memory leak in gRPC client

docs(readme): update installation instructions

refactor(board): simplify board discovery logic

test(upload): add upload verification tests

chore(deps): update @grpc/grpc-js to 1.14.3
```

### Making Changes

1. **Create a new branch**:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

3. **Run code quality checks**:

   ```bash
   pnpm run check
   ```

4. **Auto-fix issues**:

   ```bash
   pnpm run fix
   ```

5. **Run tests**:

   ```bash
   pnpm run test
   ```

6. **Commit your changes**:

   ```bash
   git add .
   git commit -m "feat(scope): description"
   ```

7. **Keep your branch updated**:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

8. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

---

## 🎨 Coding Standards

This project uses **[Ultracite](https://github.com/stackblitz/ultracite)**, a zero-config preset built on Biome for code quality enforcement.

### Quick Reference

- **Check for issues**: `pnpm run check`
- **Auto-fix issues**: `pnpm run fix`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

### Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**.

#### Type Safety

- Use explicit types for function parameters and return values
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values
- Leverage TypeScript's type narrowing instead of type assertions

#### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- Prefer template literals over string concatenation
- Use `const` by default, `let` only when reassignment is needed, never `var`

#### Async & Promises

- Always `await` promises in async functions
- Use `async/await` syntax instead of promise chains
- Handle errors appropriately with try-catch blocks

#### Error Handling

- Remove `console.log`, `debugger`, and `alert` from production code
- Throw `Error` objects with descriptive messages, not strings
- Use early returns to reduce nesting

### File Organization

```txt
src/
├── boards/          # Board discovery and selection
├── cli/             # Arduino CLI and gRPC client
├── commands/        # VS Code command handlers
├── config/          # Configuration management
├── debug/           # Debugging support
├── libraries/       # Library management
├── monitor/         # Serial monitor and plotter
├── platforms/       # Platform (core) management
├── sketches/        # Sketch management
├── ai/              # AI chat participant and tools
└── extension.ts     # Extension entry point
```

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `board-discovery.ts`)
- **Classes**: `PascalCase` (e.g., `ArduinoGrpcClient`)
- **Interfaces**: `PascalCase` (e.g., `BoardInfo`)
- **Functions**: `camelCase` (e.g., `compileSketch`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `DEFAULT_BAUD_RATE`)

### Comments

- Use JSDoc for public APIs and complex functions
- Comment **why**, not **what** (code should be self-documenting)
- Keep comments up-to-date with code changes

Example:

```typescript
/**
 * Compiles the current Arduino sketch using the selected board configuration.
 * 
 * @param options - Compilation options (verbose, warnings, etc.)
 * @returns Promise resolving to compilation result with errors and memory usage
 * @throws Error if no sketch is open or no board is selected
 */
async function compileSketch(options: CompileOptions): Promise<CompileResult> {
  // Implementation
}
```

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
pnpm run test

# Compile tests
pnpm run compile-tests

# Watch mode
pnpm run watch-tests
```

### Writing Tests

Tests are located in the `src/test/` directory and use Mocha as the test framework.

Example test structure:

```typescript
import * as assert from "node:assert";
import { describe, it } from "mocha";

describe("BoardDiscoveryService", () => {
  it("should detect connected boards", async () => {
    // Test implementation
    const boards = await discoveryService.listBoards();
    assert.ok(boards.length > 0);
  });

  it("should emit events on board connection", (done) => {
    discoveryService.on("add", (board) => {
      assert.ok(board.port);
      done();
    });
  });
});
```

### Test Coverage Guidelines

- **Unit tests** for business logic and utilities
- **Integration tests** for gRPC client and Arduino CLI interactions
- **E2E tests** for critical user workflows (compile, upload, serial monitor)

Aim for:

- **80%+ code coverage** for new features
- **100% coverage** for critical paths (compilation, upload, board discovery)

---

## 📥 Pull Request Process

### Before Submitting

1. ✅ Run `pnpm run check` and fix all issues
2. ✅ Run `pnpm run test` and ensure all tests pass
3. ✅ Update documentation if needed
4. ✅ Add tests for new features
5. ✅ Update CHANGELOG.md with your changes
6. ✅ Ensure your branch is up-to-date with `main`

### Submitting a Pull Request

1. **Push your branch** to your fork

2. **Open a Pull Request** on GitHub

3. **Fill out the PR template** with:
   - Description of changes
   - Related issue number (if applicable)
   - Testing performed
   - Screenshots (for UI changes)

4. **Wait for review** - Maintainers will review your PR and may request changes

5. **Address feedback** - Make requested changes and push updates

6. **Merge** - Once approved, a maintainer will merge your PR

### PR Title Guidelines

Follow the same format as commit messages:

```txt
feat(serial): add timestamp support to serial monitor
```

### What to Expect

- **Initial response**: Within 48 hours
- **Review time**: 3-7 days depending on complexity
- **Feedback**: Constructive suggestions for improvement
- **Merge**: After approval and passing all checks

---

## 🐛 Reporting Bugs

### Before Reporting

1. **Search existing issues** to avoid duplicates
2. **Update to the latest version** - the bug may already be fixed
3. **Verify the issue** is reproducible

### Bug Report Template

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Open sketch '...'
2. Select board '...'
3. Click on compile
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment:**
 - OS: [e.g., macOS 13.4, Windows 11, Ubuntu 22.04]
 - VS Code Version: [e.g., 1.85.0]
 - Extension Version: [e.g., 0.0.1]
 - Arduino CLI Version: [from extension output]

**Logs**
Include relevant logs from:
- Arduino Unified Output channel
- VS Code Developer Console (Help > Toggle Developer Tools)

**Additional context**
Add any other context about the problem here.
```

---

## 💡 Suggesting Features

### Feature Request Template

```markdown
**Is your feature request related to a problem?**
A clear and concise description of what the problem is.

**Describe the solution you'd like**
A clear and concise description of what you want to happen.

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions or features you've considered.

**Use cases**
Describe specific use cases where this feature would be helpful.

**Additional context**
Add any other context, mockups, or screenshots about the feature request here.
```

---

## 🎯 Good First Issues

Looking for a place to start? Check out issues labeled:

- `good first issue` - Perfect for newcomers
- `help wanted` - Community contributions welcome
- `documentation` - Documentation improvements

---

## 📚 Resources

### Documentation

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Arduino CLI Documentation](https://arduino.github.io/arduino-cli/)
- [gRPC Documentation](https://grpc.io/docs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Project Links

- [GitHub Repository](https://github.com/fermeridamagni/arduino-unified)
- [Issue Tracker](https://github.com/fermeridamagni/arduino-unified/issues)
- [Discussions](https://github.com/fermeridamagni/arduino-unified/discussions)

---

## 📬 Contact

Questions? Need help?

- **GitHub Discussions**: [Ask the community](https://github.com/fermeridamagni/arduino-unified/discussions)
- **GitHub Issues**: [Report bugs](https://github.com/fermeridamagni/arduino-unified/issues)

---

## 🙏 Thank You

Your contributions make Arduino Unified better for everyone. We appreciate your time and effort! ❤️
