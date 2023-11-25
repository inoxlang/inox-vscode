import * as vscode from 'vscode';

import { InoxExtensionContext } from "../inox-extension-context";
import { getNonce } from '../utils';
import { getBaseStyleeshet as makeBaseStyleeshet } from '../style/stylesheet';

export class AccountManager implements vscode.WebviewViewProvider {

    constructor(readonly ctx: InoxExtensionContext) {
    }

    public static readonly viewType = 'accountManager';
    private view?: vscode.WebviewView;

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): void | Thenable<void> {
        this.view = webviewView

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.ctx.base.extensionUri]
        };


        this.view.webview.html = this.getHTML()
    }

    startAnonymousAccountCreation(ctx: InoxExtensionContext, websocketEndpoint: string) {


        vscode.window.showQuickPick(['XXX'], {

        })
    }


    private getHTML() {
        if (!this.view) {
            return 'NO VIEW'
        }

        const webview = this.view.webview
        const scriptNonce = getNonce()
        const cssNonce = getNonce()

        return `<!DOCTYPE html>

        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta 
                http-equiv="Content-Security-Policy" 
                content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${cssNonce}'; script-src 'nonce-${scriptNonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Account</title>
        </head>
        <body>
            <style nonce='${cssNonce}'>${makeBaseStyleeshet()}</style>
            

            <button>ALLOW</button>
        </body>
        </html>`;
    }

}

