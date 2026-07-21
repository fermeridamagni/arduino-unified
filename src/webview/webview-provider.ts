import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export class WebviewProvider {
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async openWebview(
    id: string,
    title: string,
    mode: "libraries" | "platforms" | "plotter",
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active
  ): Promise<vscode.WebviewPanel> {
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

    panel.webview.html = await this.getHtmlForWebview(panel.webview, mode);

    panel.onDidDispose(() => {
      this.panels.delete(id);
    });

    this.panels.set(id, panel);
    return panel;
  }

  private async getHtmlForWebview(
    webview: vscode.Webview,
    mode: string
  ): Promise<string> {
    const distPath = path.join(this.context.extensionPath, "webview", "dist");
    const indexPath = path.join(distPath, "index.html");

    let html: string;
    try {
      html = await fs.promises.readFile(indexPath, "utf8");
    } catch {
      return `<!DOCTYPE html><html><body><h2>Engineering Error</h2><p>Webview build not found. Run 'pnpm run compile-webview'.</p></body></html>`;
    }

    // Add Content Security Policy (CSP) header for webview security
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">`;

    if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>\n    ${csp}`);
    } else {
      html = `${csp}\n${html}`;
    }

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
