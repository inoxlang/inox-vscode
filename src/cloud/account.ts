import * as vscode from 'vscode';

import { InoxExtensionContext } from "../inox-extension-context";
import { getNonce } from '../utils';




export class AccountManager  implements vscode.WebviewViewProvider {

    constructor(readonly ctx: InoxExtensionContext){}
	public static readonly viewType = 'accountManager';
    private view?: vscode.WebviewView;

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): void | Thenable<void> {
        this.view = webviewView

        webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.ctx.base.extensionUri]
		};


        const nonce = getNonce()
        webviewView.webview.html = `<!DOCTYPE html>

        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webviewView.webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Account</title>
        </head>
        <body>
            HELLO
        </body>
        </html>`;
    }

    startAnonymousAccountCreation(ctx: InoxExtensionContext, websocketEndpoint: string){
    
        vscode.window.showQuickPick(['XXX'], {
    
        })
    }
    
}