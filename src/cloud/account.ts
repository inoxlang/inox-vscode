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


        //data
        const websocketEndpoint = this.ctx.config.websocketEndpoint!

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
            <style nonce='${cssNonce}'>
                ${makeBaseStyleeshet()}
                .no-account-box {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    align-items: center;
                    gap: 5px;
                }

                .no-account-box > span {
                    text-align: center;
                }
            </style>

            <div class="no-account-box">
                <span class="muted-text">You are currently using a Websocket connection to <b>${websocketEndpoint}</b>.</span>

                <span> 
                    <a href="https://inox.run">inox.run</a> provides free hosting for small Inox projects and a free project server.
                    You can create an <b>anonymous</b> account to persist and host your projects.
                </span>

                <button class="align-self-center">Create Anonymous Account</button>

                <span class="muted-text"> No email or credit card required. No personal data is stored. </span>
            </div>
        </body>
        </html>`;
    }

}

