import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as vscode from "vscode";
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
  validateSketchFolder(folderPath: string): {
    valid: boolean;
    mainFile?: string;
    error?: string;
  } {
    const folderName = path.basename(folderPath);
    const expectedMainFile = path.join(folderPath, `${folderName}.ino`);

    if (!fs.existsSync(folderPath)) {
      return { valid: false, error: `Folder does not exist: ${folderPath}` };
    }

    if (!fs.statSync(folderPath).isDirectory()) {
      // Maybe it's a .ino file - check parent
      if (folderPath.endsWith(".ino")) {
        const dir = path.dirname(folderPath);
        const dirName = path.basename(dir);
        const fileName = path.basename(folderPath, ".ino");
        if (dirName === fileName) {
          return { valid: true, mainFile: folderPath };
        }
        return {
          valid: false,
          error: `Sketch file name "${fileName}.ino" doesn't match folder name "${dirName}"`,
        };
      }
      return { valid: false, error: "Path is not a directory" };
    }

    if (!fs.existsSync(expectedMainFile)) {
      return {
        valid: false,
        error: `Missing main sketch file: ${folderName}.ino`,
      };
    }

    return { valid: true, mainFile: expectedMainFile };
  }

  /**
   * Archives a sketch to a zip file.
   */
  async archiveSketch(
    sketchPath: string,
    outputPath?: string
  ): Promise<string> {
    const sketchDir = fs.statSync(sketchPath).isDirectory()
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
    const sourceDir = fs.statSync(sourcePath).isDirectory()
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
  addToRecent(sketchPath: string): void {
    const dir = fs.statSync(sketchPath).isDirectory()
      ? sketchPath
      : path.dirname(sketchPath);

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
    const sketchDir = fs.statSync(sketchPath).isDirectory()
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
