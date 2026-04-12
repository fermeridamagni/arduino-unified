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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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

      await execFileAsync(clangFormatPath, args, {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10_000,
      });

      // Send content via stdin
      const child = execFile(
        clangFormatPath,
        args,
        { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 10_000 },
        () => {}
      );
      child.stdin?.write(originalText);
      child.stdin?.end();

      const formatted = await new Promise<string>((resolve, reject) => {
        let output = "";
        child.stdout?.on("data", (data: string) => {
          output += data;
        });
        child.on("close", (code) => {
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`clang-format exited with code ${code}`));
          }
        });
        child.on("error", reject);
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
   * Finds the clang-format binary.
   * Checks: settings path → bundled → system PATH
   */
  private async findClangFormat(): Promise<string | null> {
    // Check user setting
    const settingsPath = this.settings.formatterPath;
    if (settingsPath && (await fileExists(settingsPath))) {
      return settingsPath;
    }

    // Check system PATH
    try {
      const { stdout } = await execFileAsync("which", ["clang-format"]);
      const systemPath = stdout.trim();
      if (systemPath && (await fileExists(systemPath))) {
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
      if (await fileExists(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Searches for a .clang-format style file in the project hierarchy.
   * Search order: sketch folder → parent dirs → data dir → null (use default)
   */
  private async findStyleFile(documentUri: vscode.Uri): Promise<string | null> {
    let dir = path.dirname(documentUri.fsPath);

    // Walk up directory tree looking for .clang-format
    for (let i = 0; i < 10; i++) {
      const stylePath = path.join(dir, ".clang-format");
      if (await fileExists(stylePath)) {
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
