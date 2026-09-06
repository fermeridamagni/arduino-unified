import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { ArduinoSettings } from "../config/settings";

/**
 * Sketch info returned from loading.
 */
export interface SketchInfo {
  additionalFiles: string[];
  mainFile: string;
  name: string;
  rootFolder: string;
}

/**
 * Result of validating and resolving a sketch folder/file.
 */
export interface SketchValidationResult {
  error?: string;
  expectedMainFile: string;
  sketchDir: string;
  valid: boolean;
}

/**
 * Validates board and port selection, prompting user if missing.
 */
export async function validateBoardAndPortSelection(
  selection: { fqbn?: string; portAddress?: string },
  options: { requirePort?: boolean } = {}
): Promise<boolean> {
  if (!selection.fqbn) {
    const action = await vscode.window.showErrorMessage(
      "No board selected. Please select a board first.",
      "Select Board"
    );
    if (action === "Select Board") {
      await vscode.commands.executeCommand("arduinoUnified.selectBoard");
    }
    return false;
  }

  if (options.requirePort && !selection.portAddress) {
    const action = await vscode.window.showErrorMessage(
      "No port selected. Please select a port first.",
      "Select Port"
    );
    if (action === "Select Port") {
      await vscode.commands.executeCommand("arduinoUnified.selectPort");
    }
    return false;
  }

  return true;
}

/**
 * Validates and resolves sketch directory and main file asynchronously.
 */
export async function validateAndResolveSketch(
  sketchPath: string
): Promise<SketchValidationResult> {
  let isDir = false;
  let statExists = true;
  try {
    const stat = await fs.promises.stat(sketchPath);
    isDir = stat.isDirectory();
  } catch {
    statExists = false;
  }

  if (!statExists) {
    if (sketchPath.toLowerCase().endsWith(".ino")) {
      const sketchDir = path.dirname(sketchPath);
      const folderName = path.basename(sketchDir);
      const expectedMainFile = path.join(sketchDir, `${folderName}.ino`);
      if (path.basename(sketchPath) === `${folderName}.ino`) {
        return {
          valid: false,
          sketchDir,
          expectedMainFile,
          error: `Path does not exist: ${sketchPath}`,
        };
      }
      return {
        valid: false,
        sketchDir,
        expectedMainFile,
        error: `Arduino strictly requires the main sketch file to match its folder name. Expected: "${folderName}.ino"`,
      };
    }
    return {
      valid: false,
      sketchDir: sketchPath,
      expectedMainFile: "",
      error: `Path does not exist: ${sketchPath}`,
    };
  }

  const sketchDir = isDir ? sketchPath : path.dirname(sketchPath);
  const folderName = path.basename(sketchDir);
  const expectedMainFile = path.join(sketchDir, `${folderName}.ino`);

  try {
    await fs.promises.access(expectedMainFile, fs.constants.F_OK);
    return {
      valid: true,
      sketchDir,
      expectedMainFile,
    };
  } catch {
    return {
      valid: false,
      sketchDir,
      expectedMainFile,
      error: `Arduino strictly requires the main sketch file to match its folder name. Expected: "${folderName}.ino"`,
    };
  }
}

/**
 * Prompts user to fix mismatch between sketch folder and main file if missing.
 */
export async function ensureSketchMainFile(
  sketchPath: string,
  operationName: "compile" | "upload" = "compile"
): Promise<SketchValidationResult | null> {
  const result = await validateAndResolveSketch(sketchPath);
  if (result.valid) {
    return result;
  }

  const folderName = path.basename(result.sketchDir);
  const isDir =
    (await fs.promises.stat(sketchPath).catch(() => null))?.isDirectory() ??
    false;

  const action = await vscode.window.showErrorMessage(
    `Arduino strictly requires the main sketch file to match its folder name. Expected: "${folderName}.ino"`,
    `Rename active file to ${folderName}.ino`
  );

  if (action && !isDir) {
    try {
      await fs.promises.rename(sketchPath, result.expectedMainFile);
      vscode.window.showInformationMessage(
        `Renamed to ${folderName}.ino! You can now ${operationName}.`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Rename failed: ${e}`);
    }
  }

  return null;
}

const SKETCH_FILE_EXTENSIONS = [".ino", ".pde"];

/**
 * Explicit inputs for resolveActiveSketchDir; when omitted, the values are
 * read from the current VS Code state (kept injectable for unit tests).
 */
export interface SketchDirResolutionInputs {
  activeFileName?: string | null;
  openFileNames?: readonly string[];
  workspaceFolderPaths?: readonly string[];
}

function isSketchFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SKETCH_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Resolves the folder of the sketch the user is currently working on.
 *
 * IntelliSense needs the sketch *folder* — not the workspace root — because
 * the language server compiles that folder to discover libraries. This
 * matters in monorepos where the sketch sits in a subfolder (e.g.
 * apps/arduino-r4-firmware).
 *
 * Resolution order: active editor sketch file → any open sketch document →
 * workspace folder containing a top-level sketch file (preferring one that
 * matches the folder name).
 */
export async function resolveActiveSketchDir(
  inputs: SketchDirResolutionInputs = {}
): Promise<string | null> {
  const activeFileName =
    inputs.activeFileName === undefined
      ? (vscode.window.activeTextEditor?.document.fileName ?? null)
      : inputs.activeFileName;
  const openFileNames =
    inputs.openFileNames ??
    vscode.workspace.textDocuments?.map((doc) => doc.fileName) ??
    [];
  const workspaceFolderPaths =
    inputs.workspaceFolderPaths ??
    vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ??
    [];

  if (activeFileName && isSketchFileName(activeFileName)) {
    return path.dirname(activeFileName);
  }

  for (const fileName of openFileNames) {
    if (isSketchFileName(fileName)) {
      return path.dirname(fileName);
    }
  }

  for (const folderPath of workspaceFolderPaths) {
    try {
      const entries = await fs.promises.readdir(folderPath);
      const folderName = path.basename(folderPath).toLowerCase();
      const preferred = entries.find(
        (entry) => entry.toLowerCase() === `${folderName}.ino`
      );
      const sketchEntry = preferred ?? entries.find((e) => isSketchFileName(e));
      if (sketchEntry) {
        return folderPath;
      }
    } catch {
      // Skip folders that cannot be read (removed, permissions, ...)
    }
  }

  return null;
}

/**
 * SketchService handles sketch creation, validation, loading, and archiving.
 * Enforces the Arduino sketch specification: folder name = main .ino file name.
 */
export class SketchService {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly client: ArduinoGrpcClient;
  private readonly settings: ArduinoSettings;
  private recentSketches: string[] = [];

  constructor(
    outputChannel: vscode.OutputChannel,
    client: ArduinoGrpcClient,
    settings: ArduinoSettings
  ) {
    this.outputChannel = outputChannel;
    this.client = client;
    this.settings = settings;
  }

  /**
   * Creates a new sketch with a temp name, to be saved later.
   */
  async createNewSketch(name?: string): Promise<string> {
    const sketchName = name ?? this.generateSketchName();
    const tempDir = path.join(os.tmpdir(), "arduino-unified-sketches");
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
      const result = await this.client.newSketch(sketchName, tempDir);
      this.outputChannel.appendLine(
        `[Sketch] Created new sketch: ${result.mainFile}`
      );
      return result.mainFile;
    } catch {
      // If gRPC fails, create manually
      const sketchDir = path.join(tempDir, sketchName);
      await fs.promises.mkdir(sketchDir, { recursive: true });

      const mainFile = path.join(sketchDir, `${sketchName}.ino`);
      const template = this.settings.sketchTemplate;
      await fs.promises.writeFile(mainFile, template, "utf8");

      this.outputChannel.appendLine(
        `[Sketch] Created new sketch manually: ${mainFile}`
      );
      return mainFile;
    }
  }

  /**
   * Loads sketch information from a path.
   */
  async loadSketch(sketchPath: string): Promise<SketchInfo> {
    try {
      const result = await this.client.loadSketch(sketchPath);
      const sketch = result.sketch as
        | {
            mainFile?: string;
            locationPath?: string;
            otherSketchFiles?: string[];
            additionalFiles?: string[];
            rootFolderFiles?: string[];
          }
        | undefined;

      return {
        mainFile: sketch?.mainFile ?? "",
        rootFolder: sketch?.locationPath ?? path.dirname(sketchPath),
        additionalFiles: [
          ...(sketch?.otherSketchFiles ?? []),
          ...(sketch?.additionalFiles ?? []),
          ...(sketch?.rootFolderFiles ?? []),
        ],
        name: path.basename(sketch?.locationPath ?? sketchPath),
      };
    } catch {
      // Fallback: manually construct sketch info
      return this.loadSketchManually(sketchPath);
    }
  }

  /**
   * Validates that a folder follows Arduino sketch specification.
   * The folder must contain a .ino file with the same name as the folder.
   */
  async validateSketchFolder(folderPath: string): Promise<{
    valid: boolean;
    mainFile?: string;
    error?: string;
  }> {
    const res = await validateAndResolveSketch(folderPath);
    if (!res.valid) {
      return { valid: false, error: res.error };
    }
    return { valid: true, mainFile: res.expectedMainFile };
  }

  /**
   * Archives a sketch to a zip file.
   */
  async archiveSketch(
    sketchPath: string,
    outputPath?: string
  ): Promise<string> {
    const stat = await fs.promises.stat(sketchPath);
    const sketchDir = stat.isDirectory()
      ? sketchPath
      : path.dirname(sketchPath);

    const archivePath =
      outputPath ??
      path.join(path.dirname(sketchDir), `${path.basename(sketchDir)}.zip`);

    await this.client.archiveSketch(sketchDir, archivePath, false);
    this.outputChannel.appendLine(`[Sketch] Archived to: ${archivePath}`);
    return archivePath;
  }

  /**
   * Copies a sketch to a new location with a new name.
   */
  async copySketch(
    sourcePath: string,
    destDir: string,
    newName: string
  ): Promise<string> {
    const stat = await fs.promises.stat(sourcePath);
    const sourceDir = stat.isDirectory()
      ? sourcePath
      : path.dirname(sourcePath);

    const newDir = path.join(destDir, newName);
    await fs.promises.mkdir(newDir, { recursive: true });

    const entries = await fs.promises.readdir(sourceDir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const srcPath = path.join(sourceDir, entry.name);
      let destName = entry.name;

      // Rename the main .ino file to match new folder name
      const oldName = path.basename(sourceDir);
      if (destName === `${oldName}.ino`) {
        destName = `${newName}.ino`;
      }

      const destPath = path.join(newDir, destName);

      if (entry.isFile()) {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }

    const mainFile = path.join(newDir, `${newName}.ino`);
    this.outputChannel.appendLine(`[Sketch] Copied to: ${mainFile}`);
    return mainFile;
  }

  /**
   * Adds a sketch path to the recent sketches list.
   */
  async addToRecent(sketchPath: string): Promise<void> {
    let dir = sketchPath;
    try {
      const stat = await fs.promises.stat(sketchPath);
      dir = stat.isDirectory() ? sketchPath : path.dirname(sketchPath);
    } catch {
      dir = path.dirname(sketchPath);
    }

    // Remove if already present, add to front
    this.recentSketches = this.recentSketches.filter((s) => s !== dir);
    this.recentSketches.unshift(dir);

    // Keep only last 20
    if (this.recentSketches.length > 20) {
      this.recentSketches = this.recentSketches.slice(0, 20);
    }
  }

  /**
   * Returns the list of recently opened sketches.
   */
  getRecentSketches(): string[] {
    return [...this.recentSketches];
  }

  /**
   * Sets the recent sketches list (for restoring from persistence).
   */
  setRecentSketches(sketches: string[]): void {
    this.recentSketches = [...sketches];
  }

  /**
   * Generates a unique sketch name like "sketch_apr7a".
   */
  private generateSketchName(): string {
    const now = new Date();
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const month = months[now.getMonth()];
    const day = now.getDate();
    const suffix = String.fromCharCode(97 + Math.floor(Math.random() * 26));
    return `sketch_${month}${day}${suffix}`;
  }

  /**
   * Manually loads sketch info without gRPC.
   */
  private async loadSketchManually(sketchPath: string): Promise<SketchInfo> {
    const stat = await fs.promises.stat(sketchPath);
    const sketchDir = stat.isDirectory()
      ? sketchPath
      : path.dirname(sketchPath);

    const name = path.basename(sketchDir);
    const mainFile = path.join(sketchDir, `${name}.ino`);
    const validExtensions = new Set([
      ".ino",
      ".pde",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".S",
    ]);

    const entries = await fs.promises.readdir(sketchDir);
    const additionalFiles = entries
      .filter((f) => {
        const ext = path.extname(f);
        return validExtensions.has(ext) && f !== `${name}.ino`;
      })
      .map((f) => path.join(sketchDir, f));

    return {
      mainFile,
      rootFolder: sketchDir,
      additionalFiles,
      name,
    };
  }
}
