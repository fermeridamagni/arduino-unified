import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export class WebviewProvider {
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  openWebview(
    id: string,
    title: string,
    mode: "libraries" | "platforms" | "plotter",
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active
  ): vscode.WebviewPanel {
    let panel = this.panels.get(id);

    if (panel) {
      panel.reveal(viewColumn);
      return panel;
    }

    panel = vscode.window.createWebviewPanel(id, title, viewColumn, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(
          path.join(this.context.extensionPath, "webview", "dist")
        ),
      ],
    });

    panel.webview.html = this.getHtmlForWebview(panel.webview, mode);

    panel.onDidDispose(() => {
      this.panels.delete(id);
    });

    this.panels.set(id, panel);
    return panel;
  }

  private getHtmlForWebview(webview: vscode.Webview, mode: string): string {
    const distPath = path.join(this.context.extensionPath, "webview", "dist");

    // Read the Vite-generated index.html
    const indexPath = path.join(distPath, "index.html");
    if (!fs.existsSync(indexPath)) {
      return `<!DOCTYPE html><html><body><h2>Engineering Error</h2><p>Webview build not found. Run 'pnpm run compile-webview'.</p></body></html>`;
    }

    let html = fs.readFileSync(indexPath, "utf8");

    // Replace the root element to inject the panelMode dataset var
    html = html.replace(
      '<div id="root"></div>',
      `<div id="root" data-panel-mode="${mode}"></div>`
    );

    // Transform relative paths to vscode-resource URIs
    // Vite generates paths like: src="/assets/app.js" or href="/assets/app.css"
    const htmlRegex = /(src|href)="\/([^"]+)"/g;
    html = html.replace(htmlRegex, (match, attr, relPath) => {
      const fileUri = vscode.Uri.file(path.join(distPath, relPath));
      const webviewUri = webview.asWebviewUri(fileUri);
      return `${attr}="${webviewUri}"`;
    });

    return html;
  }
}
