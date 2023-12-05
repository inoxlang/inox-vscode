import * as vscode from 'vscode';

import { InoxExtensionContext } from "../inox-extension-context";
import { getNonce, stringifyCatchedValue } from '../utils';
import { getBaseStylesheet as makeBaseStyleeshet } from '../style/stylesheet';
import { WebSocket as _Websocket } from 'ws';


const APP_STATUSES_REFRESH_INTERVAL = 5_000;
const REGISTER_APP_MSG_TYPE = "register-app"

export class ProdOverview implements vscode.WebviewViewProvider {

    constructor(readonly ctx: InoxExtensionContext) {
    }

    public static readonly viewType = 'prodOverview';
    private view?: vscode.WebviewView;

    private data: {
        applicationStatuses?: Record<string, string>
    } = {}

    private viewUpdateNeeded = false

    async resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): Promise<void> {
        this.view = webviewView

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.ctx.base.extensionUri]
        };

        const view = this.view
       
        this.ctx.onProjectOpen(() => {
            this.fetchApplicationStatuses().then(() => {
                this.updateViewIfNeeded()
            })
        })

        setInterval(async () => {
            this.fetchApplicationStatuses()
            this.updateViewIfNeeded()
        }, APP_STATUSES_REFRESH_INTERVAL)


        // handle messages from the webview

        view.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case REGISTER_APP_MSG_TYPE: {
                    const error = await this.registerApplication(data.name)
                    if (error != null) {
                        this.ctx.debugChannel.appendLine(error.message)
                        vscode.window.showErrorMessage(error.message)
                        return
                    }
                    await this.fetchApplicationStatuses()
                    await this.updateViewIfNeeded()
                    break
                }
            }
        })
    }


    private async getHTML() {
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
                .applications, .actions {
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

            <section class="applications">
                <header>Applications</header>
                ${(this.data.applicationStatuses === undefined) ?
                'failed to get application statuses' :
                Object.entries(this.data.applicationStatuses ?? {}).map(([appName, appStatus]) => {
                    return /*html*/`<div>
                            <span>${appName}</span>
                            <span>${appStatus}</span>
                        </div>`
                }).join('\n')
            }
            </section>

            <section class="actions">
                <form id="register-app-form">
                    <input name="name" type="text" pattern="^[a-z]([a-z0-9]|-)*$" placeholder="name, example: main-app">            
                    <button id="show-prod-btn">Register Application</button>
                </form>
            </div>


            <script nonce='${scriptNonce}'>
                //https://code.visualstudio.com/api/extension-guides/webview

                const vscode = acquireVsCodeApi();
                const oldState = vscode.getState() || { };

                const registerAppForm = document.querySelector("#register-app-form")

                registerAppForm.addEventListener('submit', event => {
                    event.preventDefault()
                    event.returnValue = false;
                    const data = new FormData(registerAppForm);
                    const name = String(data.get("name"));
                    vscode.postMessage({ type: '${REGISTER_APP_MSG_TYPE}', name: name });
                })
            </script>
        </body>
        </html>`;
    }

    private async fetchApplicationStatuses() {
        const lspClient = this.ctx.lspClient

        const prevStatuses = this.data.applicationStatuses
        let newStatuses: any

        if (lspClient === undefined || !lspClient.isRunning()) {
            newStatuses = undefined
            return
        }

        try {
            const { statuses } = <any>await lspClient.sendRequest('project/listApplicationStatuses', {})
            newStatuses = statuses
        } catch {
            newStatuses = undefined
        }


        //no changes
        if(JSON.stringify(prevStatuses) == JSON.stringify(newStatuses)){
            return
        }

        this.viewUpdateNeeded = true
        this.data.applicationStatuses = newStatuses
    }

    private async registerApplication(name: string): Promise<Error | null> {
        const lspClient = this.ctx.lspClient
        if (lspClient === undefined || !lspClient.isRunning()) {
            return new Error('LSP client not running')
        }

        try {
            const resp = <any>await lspClient.sendRequest('project/registerApplication', {
                name: name
            })
            if ('error' in resp) {
                return new Error(resp.error)
            }
            return null
        } catch (err) {
            return new Error(stringifyCatchedValue(err))
        }
    }

    private async updateViewIfNeeded() {
        if(! this.viewUpdateNeeded){
            return
        }
        if (this.view === undefined) {
            return
        }
        this.viewUpdateNeeded = false
        this.view.webview.html = await this.getHTML()
    }
}

