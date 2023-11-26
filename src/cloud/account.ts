import * as vscode from 'vscode';

import { InoxExtensionContext } from "../inox-extension-context";
import { getNonce } from '../utils';
import { getBaseStyleeshet as makeBaseStyleeshet } from '../style/stylesheet';
import { WebSocket as _Websocket } from 'ws';
import { inspect } from 'util';
import { join } from 'path';
import { getWebsocketOptions } from '../websocket';


const PROOF_HOSTERS = ['Github']
const LOG_PREFIX = "[Account] "

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

        webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'create-anon-account': {
					this.startAnonymousAccountCreation()
                    break
                }
			}
		});
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
                <span class="muted-text">The configured project server endpoint (websocket) is <b>${websocketEndpoint}</b>.</span>

                <span> 
                    <a href="https://inox.run">inox.run</a> provides free hosting for small Inox projects and a free project server.
                    You can create an <b>anonymous</b> account to persist and host your projects.
                </span>

                <button id="anon-creation-btn">Create Anonymous Account</button>

                <span class="muted-text"> No email or credit card required. No personal data is stored. </span>
            </div>


            <script nonce='${scriptNonce}'>
                //https://code.visualstudio.com/api/extension-guides/webview

                const vscode = acquireVsCodeApi();
                const oldState = vscode.getState() || { };

                const anonCreationButton = document.querySelector("#anon-creation-btn")
                anonCreationButton.addEventListener('click', () => {
                    vscode.postMessage({ type: 'create-anon-account' });
                })
            </script>
        </body>
        </html>`;
    }


    async startAnonymousAccountCreation() {
        const result = await vscode.window.showQuickPick(PROOF_HOSTERS, {
            placeHolder: 'Choose a platform where you have an account (no personal data or email address stored)',
            title: 'Account Creation (< 2 minutes)'
        })

        if(result === undefined || !PROOF_HOSTERS.includes(result)){
            return
        }

        let endpoint = this.ctx.config.websocketEndpoint!
        endpoint.pathname = join(endpoint.pathname, '/register-account')

        const webSocket = new _Websocket(endpoint, getWebsocketOptions(endpoint))
        const msgs = []

        webSocket.onerror = ev => {
            this.ctx.debugChannel.appendLine(inspect(ev))
        }

        webSocket.on('message', (data, isBinary) => {
            if(isBinary){
                return
            }

            let msg = data.toString().trim()
            msgs.push(msg)

            //hide token value before logging.
            if(msg.startsWith('token:')){
                msg = 'token:***'
            }

            this.ctx.debugChannel.appendLine(LOG_PREFIX + 'message received:' + msg)
        })
    }


}

