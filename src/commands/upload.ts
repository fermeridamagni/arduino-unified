import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BoardConfigStore } from "../boards/config-store";
import type { BoardDiscoveryService } from "../boards/discovery";
import type { BoardSelector } from "../boards/selector";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { ArduinoSettings } from "../config/settings";
import { compileSketch, getSketchPath } from "./compile";

/**
 * Registers upload-related commands.
 */
export function registerUploadCommands(
  context: vscode.ExtensionContext,
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  configStore: BoardConfigStore,
  settings: ArduinoSettings,
  discovery: BoardDiscoveryService,
  outputChannel: vscode.OutputChannel,
  diagnosticCollection: vscode.DiagnosticCollection
): void {
  // Arduino: Upload Sketch
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.upload", () =>
      uploadSketch(
        client,
        selector,
        configStore,
        settings,
        discovery,
        outputChannel,
        diagnosticCollection
      )
    )
  );

  // Arduino: Upload Using Programmer
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "arduinoUnified.uploadUsingProgrammer",
      () =>
        uploadUsingProgrammer(
          client,
          selector,
          configStore,
          settings,
          discovery,
          outputChannel,
          diagnosticCollection
        )
    )
  );

  // Arduino: Burn Bootloader
  context.subscriptions.push(
    vscode.commands.registerCommand("arduinoUnified.burnBootloader", () =>
      burnBootloader(
        client,
        selector,
        configStore,
        settings,
        discovery,
        outputChannel
      )
    )
  );
}

/**
 * Upload result for AI tools.
 */
interface UploadResult {
  errors?: Array<{ file: string; line: number; message: string }>;
  success: boolean;
}

/**
 * Uploads the current sketch to the selected board.
 */
async function uploadSketch(
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  configStore: BoardConfigStore,
  settings: ArduinoSettings,
  discovery: BoardDiscoveryService,
  outputChannel: vscode.OutputChannel,
  diagnosticCollection: vscode.DiagnosticCollection
): Promise<UploadResult | null> {
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

  if (!selection.portAddress) {
    await vscode.window
      .showErrorMessage(
        "No port selected. Please select a port first.",
        "Select Port"
      )
      .then((action) => {
        if (action === "Select Port") {
          vscode.commands.executeCommand("arduinoUnified.selectPort");
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

  // Auto-verify (compile) before upload if enabled
  if (settings.uploadAutoVerify) {
    const compileResult = await compileSketch(
      client,
      selector,
      configStore,
      settings,
      outputChannel,
      diagnosticCollection
    );
    if (!compileResult?.success) {
      return null; // Compile failed, abort upload
    }
  }

  const fqbn = configStore.getFqbnWithOptions(selection.fqbn);
  const port = selection.port;
  // Ensure sketchDir is resolved properly
  let isDir = false;
  try {
    const stat = await fs.promises.stat(sketchPath);
    isDir = stat.isDirectory();
  } catch {
    // Ignore error, treat as not a directory
  }
  const sketchDir = isDir ? sketchPath : path.dirname(sketchPath);
  const folderName = path.basename(sketchDir);
  const expectedMainFile = path.join(sketchDir, `${folderName}.ino`);

  let mainFileExists = false;
  try {
    await fs.promises.access(expectedMainFile);
    mainFileExists = true;
  } catch {
    // Ignore error, file doesn't exist
  }

  if (!mainFileExists) {
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
          `Renamed to ${folderName}.ino! You can now upload.`
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
  outputChannel.appendLine(`Uploading sketch: ${sketchDir}`);
  outputChannel.appendLine(
    `Board: ${selection.board?.name ?? fqbn} @ ${selection.portAddress}`
  );
  outputChannel.appendLine("─".repeat(60));

  // Pause board discovery during upload
  discovery.pause();

  // Emit event to pause serial monitor
  vscode.commands.executeCommand("arduinoUnified.monitor.pause");

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Uploading to ${selection.board?.name ?? fqbn}...`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Uploading..." });

        await client.upload(
          {
            sketchPath: sketchDir,
            fqbn,
            port: {
              address: port?.address ?? selection.portAddress,
              protocol: port?.protocol ?? "serial",
            },
            verbose: settings.uploadVerbose,
            verify: settings.uploadVerify,
          },
          (data) => {
            const msg = data as { type: string; text: string };
            if (msg.type === "stdout" || msg.type === "stderr") {
              outputChannel.append(msg.text);
            }
          }
        );

        outputChannel.appendLine("");
        outputChannel.appendLine("✅ Upload successful");
        progress.report({ message: "Done!" });
      }
    );

    await vscode.window.showInformationMessage("Upload successful!");
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine("");
    outputChannel.appendLine(`❌ Upload failed: ${message}`);
    await vscode.window.showErrorMessage(`Upload failed: ${message}`);
    return {
      success: false,
      errors: [{ file: "", line: 0, message }],
    };
  } finally {
    // Resume board discovery
    discovery.resume(client);
    // Resume serial monitor
    vscode.commands.executeCommand("arduinoUnified.monitor.resume");
  }
}

/**
 * Uploads using a programmer (bypassing bootloader).
 */
async function uploadUsingProgrammer(
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  configStore: BoardConfigStore,
  settings: ArduinoSettings,
  discovery: BoardDiscoveryService,
  outputChannel: vscode.OutputChannel,
  diagnosticCollection: vscode.DiagnosticCollection
): Promise<void> {
  const selection = selector.getSelection();

  if (!(selection.fqbn && selection.portAddress)) {
    await vscode.window.showErrorMessage(
      "Please select a board and port first."
    );
    return;
  }

  // Get or prompt for programmer
  let programmer = configStore.getProgrammer(selection.fqbn);
  if (!programmer) {
    programmer = await promptForProgrammer(client, selection.fqbn);
    if (!programmer) {
      return;
    }
    await configStore.setProgrammer(selection.fqbn, programmer);
  }

  const sketchPath = getSketchPath();
  if (!sketchPath) {
    await vscode.window.showErrorMessage("No sketch file open.");
    return;
  }

  // Auto-compile if needed
  if (settings.uploadAutoVerify) {
    const compileResult = await compileSketch(
      client,
      selector,
      configStore,
      settings,
      outputChannel,
      diagnosticCollection
    );
    if (!compileResult?.success) {
      return;
    }
  }

  const fqbn = configStore.getFqbnWithOptions(selection.fqbn);
  const sketchDir = path.dirname(sketchPath);

  outputChannel.show(true);
  outputChannel.appendLine(`Uploading using programmer: ${programmer}`);

  discovery.pause();

  try {
    await client.uploadUsingProgrammer(
      {
        sketchPath: sketchDir,
        fqbn,
        port: {
          address: selection.portAddress,
          protocol: selection.port?.protocol ?? "serial",
        },
        programmer,
        verbose: settings.uploadVerbose,
        verify: settings.uploadVerify,
      },
      (data) => {
        const msg = data as { type?: string; text?: string };
        if (msg.text) {
          outputChannel.append(msg.text);
        }
      }
    );

    outputChannel.appendLine("✅ Upload using programmer successful");
    await vscode.window.showInformationMessage(
      "Upload using programmer successful!"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`❌ Upload failed: ${message}`);
    await vscode.window.showErrorMessage(`Upload failed: ${message}`);
  } finally {
    discovery.resume(client);
  }
}

/**
 * Burns bootloader to the selected board.
 */
async function burnBootloader(
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  configStore: BoardConfigStore,
  settings: ArduinoSettings,
  discovery: BoardDiscoveryService,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const selection = selector.getSelection();

  if (!(selection.fqbn && selection.portAddress)) {
    await vscode.window.showErrorMessage(
      "Please select a board and port first."
    );
    return;
  }

  let programmer = configStore.getProgrammer(selection.fqbn);
  if (!programmer) {
    programmer = await promptForProgrammer(client, selection.fqbn);
    if (!programmer) {
      return;
    }
    await configStore.setProgrammer(selection.fqbn, programmer);
  }

  const confirm = await vscode.window.showWarningMessage(
    "Burning the bootloader will erase the current sketch. Continue?",
    { modal: true },
    "Burn Bootloader"
  );

  if (confirm !== "Burn Bootloader") {
    return;
  }

  const fqbn = configStore.getFqbnWithOptions(selection.fqbn);

  outputChannel.show(true);
  outputChannel.appendLine(
    `Burning bootloader to ${selection.board?.name ?? fqbn}...`
  );

  discovery.pause();

  try {
    await client.burnBootloader(
      {
        fqbn,
        port: {
          address: selection.portAddress,
          protocol: selection.port?.protocol ?? "serial",
        },
        programmer,
        verbose: settings.uploadVerbose,
      },
      (data) => {
        outputChannel.appendLine(JSON.stringify(data));
      }
    );

    outputChannel.appendLine("✅ Bootloader burned successfully");
    await vscode.window.showInformationMessage(
      "Bootloader burned successfully!"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`❌ Burn bootloader failed: ${message}`);
    await vscode.window.showErrorMessage(`Burn bootloader failed: ${message}`);
  } finally {
    discovery.resume(client);
  }
}

/**
 * Prompts the user to select a programmer from available options.
 */
async function promptForProgrammer(
  client: ArduinoGrpcClient,
  fqbn: string
): Promise<string | undefined> {
  try {
    const result = await client.listProgrammers(fqbn);
    const programmers = (result.programmers ?? []) as Array<{
      id: string;
      name: string;
      platform: string;
    }>;

    if (programmers.length === 0) {
      await vscode.window.showErrorMessage(
        "No programmers available for this board."
      );
      return undefined;
    }

    const items = programmers.map((p) => ({
      label: p.name,
      description: p.id,
      detail: p.platform,
      programmerId: p.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select Programmer",
    });

    return selected?.programmerId;
  } catch {
    await vscode.window.showErrorMessage("Failed to list programmers.");
    return undefined;
  }
}
