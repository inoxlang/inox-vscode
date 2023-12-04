
import * as vscode from 'vscode';
import { InoxExtensionContext } from '../inox-extension-context';
import { getNonce } from '../utils';
import { getBaseStylesheet } from '../style/stylesheet';


export const OPEN_PROD_MANAGER_COMMAND = 'prodManager.openView'


let prodManager: ProdManager | null = null

export function registerProdManagerCommands(ctx: InoxExtensionContext) {
  return [
    vscode.commands.registerCommand(OPEN_PROD_MANAGER_COMMAND, () => {
      if (!prodManager) {
        prodManager = new ProdManager(ctx)
      }

      prodManager.show()
    })
  ]
}

class ProdManager {

  panel: vscode.WebviewPanel | null = null

  constructor(readonly ctx: InoxExtensionContext) {

  }

  private createPanel() {
    // Create and show a new webview
    const panel = vscode.window.createWebviewPanel(
      'prodManager', // Identifies the type of the webview. Used internally
      'Production', // Title of the panel displayed to the user
      vscode.ViewColumn.One, // Editor column to show the new webview panel in.
      {

      } // Webview options. More on these later.
    );

    this.panel = panel
    panel.webview.html = this.getWebviewContent(panel);
    

    panel.onDidDispose(
      () => {
        this.panel = null
        // TODO: cancel any future updates to the webview content (clear intervals, etc)
      },
      null,
      this.ctx.base.subscriptions
    );
  }


  private getWebviewContent(panel: vscode.WebviewPanel) {
    const scriptNonce = getNonce()
    const cssNonce = getNonce()
    const view = panel.webview

    return /*html*/`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta 
            http-equiv="Content-Security-Policy" 
            content="default-src 'none'; style-src ${view.cspSource} 'nonce-${cssNonce}'; script-src 'nonce-${scriptNonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body>
        <style nonce='${cssNonce}'>
            ${getBaseStylesheet()}
            .actions {
                display: flex;
                flex-direction: column;
                width: 100%;
                align-items: start;
                gap: 5px;
            }

            header {
                font-weight: 700;
            }
        </style>

        <section class="deployment">
            <header>Deployment</header>
        </div>


        <script nonce='${scriptNonce}'>
            //https://code.visualstudio.com/api/extension-guides/webview

            const vscode = acquireVsCodeApi();
            const oldState = vscode.getState() || { };
        </script>
    </body>
    </html>`;
  }


  show(){
      this.getCreatePanel().reveal()
  }

  getCreatePanel(){
    if(this.panel == null){
      this.createPanel()
    }

    return this.panel!
  }
}

