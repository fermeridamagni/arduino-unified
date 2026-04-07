import * as vscode from "vscode";
import type { BoardSelector } from "../boards/selector";
import type { ArduinoGrpcClient } from "../cli/grpc-client";
import type { LibraryManager } from "../libraries/manager";
import type { ArduinoSerialMonitor } from "../monitor/serial-monitor";

/**
 * System prompt providing Arduino context to the AI.
 */
function buildSystemPrompt(
  board: string,
  fqbn: string,
  port: string,
  installedLibraries: string[]
): string {
  return [
    "You are an Arduino programming assistant integrated into the Arduino Unified VSCode extension.",
    "You help users write, debug, and understand Arduino code.",
    "",
    "## Current Context",
    `- **Board**: ${board || "Not selected"}`,
    `- **FQBN**: ${fqbn || "Not set"}`,
    `- **Port**: ${port || "Not connected"}`,
    installedLibraries.length > 0
      ? `- **Installed Libraries**: ${installedLibraries.join(", ")}`
      : "- **Installed Libraries**: None",
    "",
    "## Guidelines",
    "- Write code compatible with the Arduino framework (C/C++ with Arduino extensions)",
    "- Always include necessary #include directives",
    "- Use appropriate pin modes (INPUT, OUTPUT, INPUT_PULLUP)",
    "- Prefer non-blocking approaches (millis() instead of delay()) when appropriate",
    "- Add clear comments explaining the code",
    "- When suggesting hardware connections, be specific about pin numbers",
    "- Consider memory constraints (RAM/Flash) of the target board",
    "- Suggest appropriate libraries from the Arduino ecosystem",
    "",
    "## Available Tools",
    "- `arduino_compile`: Compile the current sketch and return errors",
    "- `arduino_board_info`: Get current board details and pin mappings",
    "- `arduino_library_search`: Search the Arduino library registry",
    "- `arduino_serial_read`: Read recent serial monitor output",
  ].join("\n");
}

/**
 * Registers the @arduino Copilot Chat Participant.
 * Provides Arduino-aware AI assistance using VSCode's built-in Copilot API.
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  client: ArduinoGrpcClient,
  selector: BoardSelector,
  libraryManager: LibraryManager,
  serialMonitor: ArduinoSerialMonitor
): void {
  // Check if the Chat API is available
  if (!vscode.chat?.createChatParticipant) {
    // Copilot Chat API not available — silently skip
    return;
  }

  const participant = vscode.chat.createChatParticipant(
    "arduino-unified.arduino",
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const selection = selector.getSelection();

      // Build context-aware system prompt
      let installedLibraries: string[] = [];
      try {
        const libs = await libraryManager.listInstalled();
        installedLibraries = libs.map((l) => l.name);
      } catch {
        // Ignore - libraries may not be loaded yet
      }

      const systemPrompt = buildSystemPrompt(
        selection.board?.name ?? "",
        selection.fqbn,
        selection.portAddress,
        installedLibraries
      );

      // Use VSCode Language Model API
      const models = await vscode.lm.selectChatModels({
        vendor: "copilot",
        family: "gpt-4o",
      });

      const model = models[0];
      if (!model) {
        stream.markdown(
          "⚠️ GitHub Copilot is not available. Please make sure you have an active Copilot subscription."
        );
        return;
      }

      // Build messages with history context
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
      ];

      // Add conversation history
      for (const turn of chatContext.history) {
        if (turn instanceof vscode.ChatRequestTurn) {
          messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
        } else if (turn instanceof vscode.ChatResponseTurn) {
          const responseText = turn.response
            .map((part) => {
              if (part instanceof vscode.ChatResponseMarkdownPart) {
                return part.value.value;
              }
              return "";
            })
            .join("");
          messages.push(
            vscode.LanguageModelChatMessage.Assistant(responseText)
          );
        }
      }

      // Add current request
      messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

      try {
        const response = await model.sendRequest(messages, {}, token);

        for await (const chunk of response.text) {
          if (token.isCancellationRequested) {
            break;
          }
          stream.markdown(chunk);
        }
      } catch (error) {
        if (error instanceof vscode.LanguageModelError) {
          stream.markdown(`⚠️ AI Error: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  );

  participant.iconPath = new vscode.ThemeIcon("circuit-board");

  context.subscriptions.push(participant);
}
