import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BoardConfigStore } from "../boards/config-store";
import type { BoardSelector } from "../boards/selector";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { ArduinoSettings } from "../config/settings";

/**
 * Parsed compile error with file location.
 */
interface CompileError {
  column: number;
  file: string;
  line: number;
  message: string;
  severity: vscode.DiagnosticSeverity;
}

/**
 * Compile result with memory usage info.
 */
export interface CompileResult {
  buildPath?: string;
  errors: CompileError[];
  executableSectionsSize?: Array<{
    name: string;
    size: number;
    maxSize: number;
  }>;
  success: boolean;
  usedLibraries?: Array<{ name: string; version: string }>;
}

/**
 * Registers compile-related commands.
 */
export function registerCompileCommands(
  context: vscode.ExtensionContext,
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  configStore: BoardConfigStore,
  settings: ArduinoSettings,
  outputChannel: vscode.OutputChannel,
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  // Arduino: Compile Sketch
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.compile", () =>
      compileSketch(
        client,
        selector,
        configStore,
        settings,
        outputChannel,
        diagnosticCollection
      )
    )
  );

  // Arduino: Export Compiled Binary
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.exportBinary", () =>
      compileSketch(
        client,
        selector,
        configStore,
        settings,
        outputChannel,
        diagnosticCollection,
        { exportBinary: true }
      )
    )
  );
}

/**
 * Compiles the current sketch with progress reporting.
 */
async function compileSketch(
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  configStore: BoardConfigStore,
  settings: ArduinoSettings,
  outputChannel: vscode.OutputChannel,
  diagnosticCollection: vscode.DiagnosticCollection,
  options?: { exportBinary?: boolean }
): Promise<CompileResult | null> {
  const selection = selector.getSelection();

  if (!selection.fqbn) {
    await vscode.window
      .showErrorMessage(
        "No board selected. Please select a board first.",
        "Select Board"
      )
      .then((action) => {
        if (action === "Select Board") {
          vscode.commands.executeCommand("arduinoUnified.selectBoard");
        }
      });
    return null;
  }

  const sketchPath = getSketchPath();
  if (!sketchPath) {
    await vscode.window.showErrorMessage(
      "No sketch file open. Open an .ino file first."
    );
    return null;
  }

  // Clear previous diagnostics
  diagnosticCollection.clear();

  const fqbn = configStore.getFqbnWithOptions(selection.fqbn);
  // Ensure sketchDir is resolved properly
  let isDir = false;
  try {
    const stat = await fs.promises.stat(sketchPath);
    isDir = stat.isDirectory();
  } catch (_e) {
    // Ignore error
  }
  const sketchDir = isDir ? sketchPath : path.dirname(sketchPath);
  const folderName = path.basename(sketchDir);
  const expectedMainFile = path.join(sketchDir, `${folderName}.ino`);

  let exists = false;
  try {
    await fs.promises.access(expectedMainFile);
    exists = true;
  } catch (_e) {
    // Expected main file doesn't exist
  }

  if (!exists) {
    const action = await vscode.window.showErrorMessage(
      `Arduino strictly requires the main sketch file to match its folder name. Expected: "${folderName}.ino"`,
      `Rename active file to ${folderName}.ino`
    );

    if (action && !isDir) {
      // Perform rename of the currently open .ino
      try {
        await fs.promises.rename(sketchPath, expectedMainFile);
        // Don't proceed to allow vscode file watchers to catch up, or just proceed
        vscode.window.showInformationMessage(
          `Renamed to ${folderName}.ino! You can now compile.`
        );
      } catch (e) {
        vscode.window.showErrorMessage(`Rename failed: ${e}`);
      }
    }
    return null;
  }

  outputChannel.show(true);
  outputChannel.appendLine("");
  outputChannel.appendLine("─".repeat(60));
  outputChannel.appendLine(`Compiling sketch: ${sketchDir}`);
  outputChannel.appendLine(`Board: ${selection.board?.name ?? fqbn}`);
  outputChannel.appendLine("─".repeat(60));

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Compiling for ${selection.board?.name ?? fqbn}...`,
      cancellable: false,
    },
    async (progress) => {
      const errors: CompileError[] = [];
      let stderrBuffer = "";

      try {
        const compileResult = await client.compile(
          {
            sketchPath: sketchDir,
            fqbn,
            verbose: settings.compileVerbose,
            warnings: settings.compileWarnings,
            exportDir: options?.exportBinary ? sketchDir : undefined,
            optimizeForDebug: settings.compileOptimizeForDebug,
          },
          (data) => {
            const msg = data as { type: string; text: string };
            if (msg.type === "stdout") {
              outputChannel.append(msg.text);
            } else if (msg.type === "stderr") {
              outputChannel.append(msg.text);
              stderrBuffer += msg.text;
            }
          }
        );

        // Parse errors from stderr
        const parsedErrors = parseCompileErrors(stderrBuffer);
        errors.push(...parsedErrors);

        // Extract memory usage
        const sections = compileResult.executableSectionsSize as
          | Array<{ name: string; size: number; maxSize: number }>
          | undefined;

        if (sections) {
          outputChannel.appendLine("");
          for (const section of sections) {
            const percent =
              section.maxSize > 0
                ? Math.round((section.size / section.maxSize) * 100)
                : 0;
            outputChannel.appendLine(
              `${section.name}: ${section.size} bytes (${percent}% of ${section.maxSize} bytes)`
            );
          }
        }

        outputChannel.appendLine("");
        outputChannel.appendLine("✅ Compilation successful");

        progress.report({ message: "Done!" });

        return {
          success: true,
          buildPath: compileResult.buildPath as string | undefined,
          usedLibraries: compileResult.usedLibraries as
            | Array<{ name: string; version: string }>
            | undefined,
          executableSectionsSize: sections,
          errors,
        };
      } catch (error) {
        const parsedErrors = parseCompileErrors(stderrBuffer);
        errors.push(...parsedErrors);

        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine("");
        outputChannel.appendLine(`❌ Compilation failed: ${message}`);

        return {
          success: false,
          errors,
        };
      }
    }
  );

  // Apply diagnostics
  applyDiagnostics(result.errors, diagnosticCollection);

  if (!result.success) {
    const action = await vscode.window.showErrorMessage(
      "Compilation failed. See output for details.",
      "Show Output"
    );
    if (action === "Show Output") {
      outputChannel.show();
    }
  }

  return result;
}

/**
 * Returns the path to the current sketch (.ino file).
 */
function getSketchPath(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (
    editor?.document.languageId === "ino" ||
    editor?.document.fileName.endsWith(".ino")
  ) {
    return editor.document.fileName;
  }

  // Check workspace for .ino files
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return null;
  }

  // Return the workspace folder path (sketch folder)
  return workspaceFolders[0].uri.fsPath;
}

/**
 * Parses compiler error output into structured errors.
 * Matches patterns like: `/path/to/file.ino:10:5: error: message`
 */
function parseCompileErrors(stderr: string): CompileError[] {
  const errors: CompileError[] = [];
  const errorPattern = /^(.+?):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = errorPattern.exec(stderr)) !== null) {
    const severity =
      match[4] === "error"
        ? vscode.DiagnosticSeverity.Error
        : match[4] === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

    errors.push({
      file: match[1],
      line: Number.parseInt(match[2], 10),
      column: Number.parseInt(match[3], 10),
      message: match[5],
      severity,
    });
  }

  return errors;
}

/**
 * Applies parsed compile errors as VSCode diagnostics.
 */
function applyDiagnostics(
  errors: CompileError[],
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  const diagnosticMap = new Map<string, vscode.Diagnostic[]>();

  for (const error of errors) {
    const uri = vscode.Uri.file(error.file);
    const key = uri.toString();

    if (!diagnosticMap.has(key)) {
      diagnosticMap.set(key, []);
    }

    const range = new vscode.Range(
      Math.max(0, error.line - 1),
      Math.max(0, error.column - 1),
      Math.max(0, error.line - 1),
      Number.MAX_SAFE_INTEGER
    );

    const diagnostic = new vscode.Diagnostic(
      range,
      error.message,
      error.severity
    );
    diagnostic.source = "Arduino";
    diagnosticMap.get(key)?.push(diagnostic);
  }

  for (const [uriString, diagnostics] of diagnosticMap) {
    diagnosticCollection.set(vscode.Uri.parse(uriString), diagnostics);
  }
}

export { compileSketch, getSketchPath };
