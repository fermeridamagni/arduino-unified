import * as vscode from "vscode";

/**
 * Arduino-specific Code Action provider.
 * Provides quick fixes for common Arduino coding mistakes.
 */
export class ArduinoCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "Arduino") {
        continue;
      }

      // Fix: Missing #include
      const includeMatch =
        /(?:'(.+\.h)' file not found|No such file: (.+\.h)|undefined reference.*'(\w+)')/i.exec(
          diagnostic.message
        );

      if (includeMatch) {
        const header = includeMatch[1] ?? includeMatch[2];
        if (header) {
          const action = new vscode.CodeAction(
            `Add #include <${header}>`,
            vscode.CodeActionKind.QuickFix
          );

          action.edit = new vscode.WorkspaceEdit();
          action.edit.insert(
            document.uri,
            new vscode.Position(0, 0),
            `#include <${header}>\n`
          );
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }
      }

      // Fix: Suggest pinMode for undeclared pins
      const pinMatch = /'(\w+)' was not declared/.exec(diagnostic.message);
      if (pinMatch) {
        const varName = pinMatch[1];
        // Check if it looks like a pin constant
        if (/^(LED_BUILTIN|A\d+|D\d+|\d+)$/.test(varName)) {
          const action = new vscode.CodeAction(
            `Add pinMode(${varName}, OUTPUT) in setup()`,
            vscode.CodeActionKind.QuickFix
          );

          // Find setup() function to insert into
          const text = document.getText();
          const setupMatch = /void\s+setup\s*\(\s*\)\s*\{/.exec(text);

          if (setupMatch?.index !== undefined) {
            const insertPosition = document.positionAt(
              setupMatch.index + setupMatch[0].length
            );
            action.edit = new vscode.WorkspaceEdit();
            action.edit.insert(
              document.uri,
              insertPosition,
              `\n  pinMode(${varName}, OUTPUT);`
            );
          }

          action.diagnostics = [diagnostic];
          actions.push(action);
        }
      }

      // Offer: Explain with Copilot (only if Chat API is available)
      if (typeof vscode.chat?.createChatParticipant === "function") {
        const explainAction = new vscode.CodeAction(
          "$(sparkle) Explain Error with Copilot",
          vscode.CodeActionKind.QuickFix
        );
        explainAction.command = {
          command: "arduinoUnified.explainError",
          title: "Explain Error",
          arguments: [diagnostic.message, document.uri, range],
        };
        explainAction.diagnostics = [diagnostic];
        actions.push(explainAction);
      }
    }

    return actions;
  }
}

/**
 * Registers the Arduino code action provider and related commands.
 */
export function registerCodeActions(context: vscode.ExtensionContext): void {
  // Register code action provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", pattern: "**/*.{ino,pde,cpp,c,h,hpp}" },
      new ArduinoCodeActionProvider(),
      {
        providedCodeActionKinds:
          ArduinoCodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // Register the "Explain Error" command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "arduinoUnified.explainError",
      async (
        errorMessage: string,
        documentUri: vscode.Uri,
        range: vscode.Range
      ) => {
        // Open Copilot chat with the error context
        const prompt = [
          "I got this Arduino compile error:",
          "",
          "```",
          errorMessage,
          "```",
          "",
          "Please explain what this error means and how to fix it.",
          "Keep the explanation beginner-friendly.",
        ].join("\n");

        // Try to use chat API, fallback to opening a new chat
        try {
          await vscode.commands.executeCommand(
            "workbench.panel.chat.view.copilot.focus"
          );
          // Use sendInteractiveRequestToProvider if available
          await vscode.commands.executeCommand("workbench.action.chat.open", {
            query: `@arduino ${prompt}`,
          });
        } catch {
          // Fallback: show in information message
          await vscode.window.showInformationMessage(
            `Error: ${errorMessage}. Enable GitHub Copilot for AI-powered explanations.`
          );
        }
      }
    )
  );
}
