import * as vscode from "vscode";
import type { BoardSelector } from "../boards/selector";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { LibraryManager } from "../libraries/manager";
import type { ArduinoSerialMonitor } from "../monitor/serial-monitor";

/**
 * Registers Arduino-specific Chat Tools for use by Copilot.
 * These tools allow the AI to interact with the Arduino toolchain.
 */
export function registerChatTools(
  context: vscode.ExtensionContext,
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  libraryManager: LibraryManager,
  serialMonitor: ArduinoSerialMonitor
): void {
  // Check if the LM tool API is available
  if (!vscode.lm?.registerTool) {
    return;
  }

  // Tool: arduino_compile
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_compile", {
      async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<unknown>,
        token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        try {
          const result = await vscode.commands.executeCommand(
            "arduinoUnified.compile"
          );

          const compileResult = result as {
            success: boolean;
            errors: Array<{ file: string; line: number; message: string }>;
            executableSectionsSize?: Array<{
              name: string;
              size: number;
              maxSize: number;
            }>;
          } | null;

          if (!compileResult) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                "Compilation was not started. Make sure a sketch is open and a board is selected."
              ),
            ]);
          }

          const summary = compileResult.success
            ? "Compilation successful!"
            : `Compilation failed with ${compileResult.errors.length} error(s).`;

          let details = summary;

          if (compileResult.errors.length > 0) {
            details += "\n\nErrors:\n";
            for (const err of compileResult.errors) {
              details += `- ${err.file}:${err.line}: ${err.message}\n`;
            }
          }

          if (compileResult.executableSectionsSize) {
            details += "\n\nMemory usage:\n";
            for (const section of compileResult.executableSectionsSize) {
              const percent =
                section.maxSize > 0
                  ? Math.round((section.size / section.maxSize) * 100)
                  : 0;
              details += `- ${section.name}: ${section.size}/${section.maxSize} bytes (${percent}%)\n`;
            }
          }

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(details),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Compilation error: ${message}`),
          ]);
        }
      },
    })
  );

  // Tool: arduino_upload
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_upload", {
      async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<unknown>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        try {
          const result = await vscode.commands.executeCommand(
            "arduinoUnified.upload"
          );

          const uploadResult = result as {
            success: boolean;
            errors?: Array<{ file: string; line: number; message: string }>;
          } | null;

          if (!uploadResult) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                "Upload was not started. Make sure a sketch is open and a board is selected."
              ),
            ]);
          }

          const summary = uploadResult.success
            ? "Upload successful!"
            : `Upload failed with ${uploadResult.errors?.length ?? 0} error(s).`;

          let details = summary;

          if (uploadResult.errors && uploadResult.errors.length > 0) {
            details += "\n\nErrors:\n";
            for (const err of uploadResult.errors) {
              details += `- ${err.file}:${err.line}: ${err.message}\n`;
            }
          }

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(details),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Upload error: ${message}`),
          ]);
        }
      },
    })
  );

  // Tool: arduino_serial_write
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_serial_write", {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<unknown>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input as { data?: string } | undefined;
        const data = input?.data ?? "";

        if (!data) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              "Please provide data to write to the serial port."
            ),
          ]);
        }

        try {
          serialMonitor.write(data);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Sent to serial: ${data}`),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Serial write error: ${message}`),
          ]);
        }
      },
    })
  );

  // Tool: arduino_select_board
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_select_board", {
      async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<unknown>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        try {
          await selector.showBoardPicker();
          const selection = selector.getSelection();

          if (!selection.board) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart("No board selected."),
            ]);
          }

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Selected board: ${selection.board.name} (${selection.fqbn})`
            ),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Board selection error: ${message}`
            ),
          ]);
        }
      },
    })
  );

  // Tool: arduino_board_info
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_board_info", {
      async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<unknown>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const selection = selector.getSelection();

        if (!selection.fqbn) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              "No board selected. Ask the user to select a board first."
            ),
          ]);
        }

        try {
          const details = await client.boardDetails(selection.fqbn);
          const boardData = details as {
            name?: string;
            fqbn?: string;
            configOptions?: Array<{
              option: string;
              optionLabel: string;
              values: Array<{
                value: string;
                valueLabel: string;
                selected: boolean;
              }>;
            }>;
            programmers?: Array<{ id: string; name: string }>;
          };

          let info = `Board: ${boardData.name ?? selection.board?.name ?? "Unknown"}\n`;
          info += `FQBN: ${boardData.fqbn ?? selection.fqbn}\n`;
          info += `Port: ${selection.portAddress || "Not connected"}\n`;

          if (boardData.configOptions?.length) {
            info += "\nConfiguration options:\n";
            for (const opt of boardData.configOptions) {
              const selected = opt.values.find((v) => v.selected);
              info += `- ${opt.optionLabel}: ${selected?.valueLabel ?? "default"}\n`;
            }
          }

          if (boardData.programmers?.length) {
            info += "\nAvailable programmers:\n";
            for (const prog of boardData.programmers) {
              info += `- ${prog.name} (${prog.id})\n`;
            }
          }

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(info),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Failed to get board info: ${message}`
            ),
          ]);
        }
      },
    })
  );

  // Tool: arduino_library_search
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_library_search", {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<unknown>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input as { query?: string } | undefined;
        const query = input?.query ?? "";

        if (!query) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              "Please provide a search query for the library."
            ),
          ]);
        }

        try {
          const results = await libraryManager.search(query);
          const topResults = results.slice(0, 10);

          if (topResults.length === 0) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `No libraries found matching "${query}".`
              ),
            ]);
          }

          let resultText = `Found ${results.length} libraries matching "${query}":\n\n`;
          for (const lib of topResults) {
            resultText += `**${lib.name}** v${lib.version}\n`;
            resultText += `  ${lib.sentence}\n`;
            resultText += `  Author: ${lib.author}\n`;
            resultText += `  Category: ${lib.category}\n\n`;
          }

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(resultText),
          ]);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Library search failed: ${message}`
            ),
          ]);
        }
      },
    })
  );

  // Tool: arduino_serial_read
  context.subscriptions.push(
    vscode.lm.registerTool("arduino_serial_read", {
      async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<unknown>,
        _token: vscode.CancellationToken
      ): Promise<vscode.LanguageModelToolResult> {
        const output = serialMonitor.getRecentOutput();

        if (output.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              "No serial output available. Make sure the Serial Monitor is connected and the board is sending data."
            ),
          ]);
        }

        const text = `Recent serial output (last ${output.length} lines):\n\n${output.join("\n")}`;

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(text),
        ]);
      },
    })
  );
}
