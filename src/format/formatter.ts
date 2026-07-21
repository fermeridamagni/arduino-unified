import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { ArduinoSettings } from "../config/settings";

const execFileAsync = promisify(execFile);

/**
 * Default Arduino clang-format style configuration.
 */
const DEFAULT_CLANG_FORMAT_STYLE = JSON.stringify({
  BasedOnStyle: "LLVM",
  IndentWidth: 2,
  TabWidth: 2,
  UseTab: "Never",
  BreakBeforeBraces: "Attach",
  AllowShortIfStatementsOnASingleLine: true,
  IndentCaseLabels: true,
  ColumnLimit: 0,
});

/**
 * ArduinoFormatter provides clang-format based code formatting
 * for .ino, .cpp, .h, and related Arduino files.
 */
export class ArduinoFormatter
  implements vscode.DocumentFormattingEditProvider, vscode.Disposable
{
  private readonly outputChannel: vscode.OutputChannel;
  private readonly settings: ArduinoSettings;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(outputChannel: vscode.OutputChannel, settings: ArduinoSettings) {
    this.outputChannel = outputChannel;
    this.settings = settings;

    // Register as a formatting provider for Arduino-related file types
    const selector: vscode.DocumentSelector = [
      { scheme: "file", pattern: "**/*.ino" },
      { scheme: "file", pattern: "**/*.pde" },
    ];

    this.disposables.push(
      vscode.languages.registerDocumentFormattingEditProvider(selector, this)
    );
  }

  /**
   * Provides formatting edits for the entire document.
   */
  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): Promise<vscode.TextEdit[]> {
    const clangFormatPath = await this.findClangFormat();

    if (!clangFormatPath) {
      this.outputChannel.appendLine(
        "[Formatter] clang-format not found. Install it or set the path in settings."
      );
      return [];
    }

    try {
      const originalText = document.getText();
      const stylePath = await this.findStyleFile(document.uri);

      const args = [`--assume-filename=${document.fileName}`];

      if (stylePath) {
        args.push(`--style=file:${stylePath}`);
      } else {
        args.push(`--style=${DEFAULT_CLANG_FORMAT_STYLE}`);
      }

      // Single child process execution with stdin streaming
      const formatted = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          clangFormatPath,
          args,
          { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 10_000 },
          (error, stdout) => {
            if (error) {
              reject(error);
            } else {
              resolve(stdout);
            }
          }
        );

        if (child.stdin) {
          child.stdin.write(originalText);
          child.stdin.end();
        }
      });

      if (formatted === originalText) {
        return [];
      }

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(originalText.length)
      );

      return [vscode.TextEdit.replace(fullRange, formatted)];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[Formatter] Error: ${message}`);
      return [];
    }
  }

  /**
   * Helper to check file existence asynchronously.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Finds the clang-format binary.
   * Checks: settings path → system PATH → common locations
   */
  private async findClangFormat(): Promise<string | null> {
    // Check user setting
    const settingsPath = this.settings.formatterPath;
    if (settingsPath && (await this.fileExists(settingsPath))) {
      return settingsPath;
    }

    // Check system PATH using platform-appropriate lookup tool
    const cmd = process.platform === "win32" ? "where" : "which";
    try {
      const { stdout } = await execFileAsync(cmd, ["clang-format"]);
      const systemPath = stdout.trim().split(/\r?\n/)[0];
      if (systemPath && (await this.fileExists(systemPath))) {
        return systemPath;
      }
    } catch {
      // Not in PATH
    }

    // Check common locations
    const commonPaths = [
      "/usr/bin/clang-format",
      "/usr/local/bin/clang-format",
      "/opt/homebrew/bin/clang-format",
    ];

    for (const p of commonPaths) {
      if (await this.fileExists(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Searches for a .clang-format style file in the project hierarchy.
   * Search order: sketch folder → parent dirs → null (use default)
   */
  private async findStyleFile(documentUri: vscode.Uri): Promise<string | null> {
    let dir = path.dirname(documentUri.fsPath);

    // Walk up directory tree looking for .clang-format
    for (let i = 0; i < 10; i++) {
      const stylePath = path.join(dir, ".clang-format");
      if (await this.fileExists(stylePath)) {
        return stylePath;
      }

      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }

    return null;
  }

  /**
   * Disposes resources.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
