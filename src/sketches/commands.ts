import * as vscode from "vscode";
import type { SketchService } from "./sketch-service";

const RECENT_SKETCHES_KEY = "arduinoUnified.recentSketches";

/**
 * Registers sketch management commands.
 */
export function registerSketchCommands(
  context: vscode.ExtensionContext,
  sketchService: SketchService
): void {
  // Restore recent sketches from global state
  const savedRecent = context.globalState.get<string[]>(
    RECENT_SKETCHES_KEY,
    []
  );
  sketchService.setRecentSketches(savedRecent);

  // Arduino: New Sketch
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.newSketch", () =>
      newSketch(context, sketchService)
    )
  );

  // Arduino: Open Recent Sketch
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.openRecentSketch", () =>
      openRecentSketch(sketchService)
    )
  );

  // Arduino: Archive Sketch
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.archiveSketch", () =>
      archiveCurrentSketch(sketchService)
    )
  );

  // Arduino: Save As...
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.saveSketchAs", () =>
      saveSketchAs(sketchService)
    )
  );
}

/**
 * Creates a new sketch and opens it.
 */
async function newSketch(
  context: vscode.ExtensionContext,
  sketchService: SketchService
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Enter sketch name",
    placeHolder: "my_sketch",
    validateInput: (value) => {
      if (!value) {
        return "Name is required";
      }
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
        return "Name must start with a letter and contain only letters, numbers, and underscores";
      }
      return null;
    },
  });

  if (!name) {
    return;
  }

  try {
    const mainFile = await sketchService.createNewSketch(name);
    const sketchDir = mainFile.substring(0, mainFile.lastIndexOf("/"));

    // Save to sketchbook or let user choose
    const choices = [
      "Open in Current Window",
      "Open in New Window",
      "Save to Sketchbook First",
    ];
    const action = await vscode.window.showQuickPick(choices, {
      placeHolder: "How would you like to open the sketch?",
    });

    if (action === "Open in New Window") {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(sketchDir),
        true
      );
    } else if (action === "Open in Current Window") {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(sketchDir),
        false
      );
    } else if (action === "Save to Sketchbook First") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(sketchDir),
        filters: { "Arduino Sketch": ["ino"] },
      });
      if (uri) {
        const newDir = uri.fsPath.replace(/\.ino$/, "");
        const newName = newDir.split("/").pop() ?? name;
        const newMainFile = await sketchService.copySketch(
          sketchDir,
          newDir.substring(0, newDir.lastIndexOf("/")),
          newName
        );
        const newSketchDir = newMainFile.substring(
          0,
          newMainFile.lastIndexOf("/")
        );
        await vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(newSketchDir),
          false
        );
      }
    }

    sketchService.addToRecent(mainFile);
    await context.globalState.update(
      RECENT_SKETCHES_KEY,
      sketchService.getRecentSketches()
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Failed to create sketch: ${message}`);
  }
}

/**
 * Shows a quick pick of recently opened sketches.
 */
async function openRecentSketch(sketchService: SketchService): Promise<void> {
  const recent = sketchService.getRecentSketches();

  if (recent.length === 0) {
    await vscode.window.showInformationMessage("No recent sketches.");
    return;
  }

  const items = recent.map((sketchPath) => {
    const name = sketchPath.split("/").pop() ?? sketchPath;
    return {
      label: `$(file-code) ${name}`,
      description: sketchPath,
      path: sketchPath,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a recent sketch",
  });

  if (selected) {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(selected.path),
      false
    );
  }
}

/**
 * Archives the current sketch to a zip file.
 */
async function archiveCurrentSketch(
  sketchService: SketchService
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    await vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  const sketchDir = workspaceFolders[0].uri.fsPath;
  const validation = sketchService.validateSketchFolder(sketchDir);

  if (!validation.valid) {
    await vscode.window.showErrorMessage(
      `Not a valid Arduino sketch: ${validation.error}`
    );
    return;
  }

  const savePath = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${sketchDir}.zip`),
    filters: { "ZIP Archive": ["zip"] },
  });

  if (!savePath) {
    return;
  }

  try {
    const archivePath = await sketchService.archiveSketch(
      sketchDir,
      savePath.fsPath
    );
    await vscode.window.showInformationMessage(
      `Sketch archived to: ${archivePath}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(
      `Failed to archive sketch: ${message}`
    );
  }
}

/**
 * Saves the current sketch to a new location with a new name.
 */
async function saveSketchAs(sketchService: SketchService): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    await vscode.window.showErrorMessage("No workspace folder open.");
    return;
  }

  const sketchDir = workspaceFolders[0].uri.fsPath;

  const newName = await vscode.window.showInputBox({
    prompt: "Enter new sketch name",
    placeHolder: "my_sketch_copy",
    validateInput: (value) => {
      if (!value) {
        return "Name is required";
      }
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
        return "Invalid sketch name";
      }
      return null;
    },
  });

  if (!newName) {
    return;
  }

  const destUri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: "Save Here",
  });

  if (!destUri || destUri.length === 0) {
    return;
  }

  try {
    const newMainFile = await sketchService.copySketch(
      sketchDir,
      destUri[0].fsPath,
      newName
    );
    const newDir = newMainFile.substring(0, newMainFile.lastIndexOf("/"));
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(newDir),
      false
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Failed to save sketch: ${message}`);
  }
}
