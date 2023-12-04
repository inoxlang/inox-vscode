import * as vscode from 'vscode';

import { InoxExtensionContext } from "../inox-extension-context";
import { getNonce } from '../utils';
import { getBaseStylesheet as makeBaseStyleeshet } from '../style/stylesheet';
import { WebSocket as _Websocket } from 'ws';


export class ProdOverview implements vscode.WebviewViewProvider {

    constructor(readonly ctx: InoxExtensionContext) {
    }

    public static readonly viewType = 'prodOverview';
    private view?: vscode.WebviewView;

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): void | Thenable<void> {
        this.view = webviewView

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.ctx.base.extensionUri]
        };


        this.view.webview.html = this.getHTML()
    }

    private getHTML() {
        if (!this.view) {
            return 'NO VIEW'
        }

        const webview = this.view.webview
        const scriptNonce = getNonce()
        const cssNonce = getNonce()

        return /*html*/`<!DOCTYPE html>
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

            <section class="actions">
                <button id="show-prod-btn">Open Manager</button>
            </div>


            <script nonce='${scriptNonce}'>
                //https://code.visualstudio.com/api/extension-guides/webview

                const vscode = acquireVsCodeApi();
                const oldState = vscode.getState() || { };

                const showProdButton = document.querySelector("#show-prod-btn")
                showProdButton.addEventListener('click', () => {
                    vscode.postMessage({ type: 'show-prod-manager' });
                })
            </script>
        </body>
        </html>`;
    }
}

