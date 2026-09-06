import type * as vscode from "vscode";

/**
 * Registers language support for Arduino sketch files (.ino, .pde).
 *
 * Files retain their native "ino" language identifier to prevent conflicts
 * with other C/C++ extensions (such as cpptools or vscode-clangd). Syntax
 * highlighting is powered by syntaxes/ino.tmLanguage.json, and semantic
 * features (completion, hover, go-to-definition, diagnostics) are provided
 * by arduino-language-server paired with clangd.
 */
export function registerLanguageSupport(
  _context: vscode.ExtensionContext
): void {
  // .ino and .pde retain native language "ino" without remapping to cpp.
  // Fake hover and completion providers have been deleted in favor of real ALS IntelliSense.
}
