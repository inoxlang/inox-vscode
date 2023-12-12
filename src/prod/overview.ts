import * as vscode from 'vscode';

import { InoxExtensionContext } from "../inox-extension-context";
import { getNonce, stringifyCatchedValue } from '../utils';
import { getBaseStylesheet as makeBaseStyleeshet } from '../style/stylesheet';
import { WebSocket as _Websocket } from 'ws';


const APP_STATUSES_REFRESH_INTERVAL = 3_000;
const PROD_NOT_AVAILABLE_MSG = [
    `The project cannot be deployed in production.`,
    `This is likely due to the project server not being started by the inoxd daemon on a remote machine.`
].join('\n')

// LSP methods

const LIST_APPS_METHOD = 'project/listApplicationStatuses'
const REGISTER_APP_METHOD = 'project/registerApplication'
const DEPLOY_APP_METHOD = 'prod/deployApplication'
const STOP_APP_METHOD = 'prod/stopApplication'

//messages between ProdOverview and the webview

const REGISTER_APP_MSG_TYPE = "register-app"
const DO_APP_ACTION_MSG_TYPE = "do-app-action"
const APPLICATION_ACTION_NAMES: ApplicationAction[] = ['None', 'Deploy', 'Update', 'Stop']


type ApplicationStatus =
    'undeployed' | 'deploying' | 'deployed' | 'gracefully-stopping' | 'gracefully-stopped' | 'erroneously-stopped' | 'failed-to-prepare'

type ApplicationAction = 'None' | 'Deploy' | 'Update' | 'Stop'

export class ProdOverview implements vscode.WebviewViewProvider {

    constructor(readonly ctx: InoxExtensionContext) {
    }

    public static readonly viewType = 'prodOverview';
    private view?: vscode.WebviewView;

    private data: {
        applicationStatuses?: Record<string, ApplicationStatus>
    } = {}

    private viewUpdateNeeded = false

    async resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext<unknown>, token: vscode.CancellationToken): Promise<void> {
        if(this.view == webviewView){
            return
        }

        this.view = webviewView
        const view = this.view

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.ctx.base.extensionUri]
        };
        webviewView.webview.html = '[loading]'
  
        if(this.ctx.projectOpen){
            this.fetchApplicationStatuses().then(() => {
                this.updateViewIfNeeded()
            }).catch()
        } else {
            this.ctx.onProjectOpen(() => {
                this.fetchApplicationStatuses().then(() => {
                    this.updateViewIfNeeded()
                }).catch()
            })
        }

        const timer = setInterval(async () => {
            if(this.ctx.projectOpen && !this.ctx.canProjectBeDeployedInProd) {
                clearInterval(timer)
                this.viewUpdateNeeded = true
                this.updateViewIfNeeded()
                return
            }

            this.fetchApplicationStatuses()
            this.updateViewIfNeeded()
        }, APP_STATUSES_REFRESH_INTERVAL)


        // handle messages from the webview

        view.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case REGISTER_APP_MSG_TYPE: {
                    const error = await this.registerApplication(data.name, data.modulePath)
                    if (error != null) {
                        this.ctx.debugChannel.appendLine(error.message)
                        vscode.window.showErrorMessage(error.message)
                        return
                    }
                    await this.fetchApplicationStatuses()
                    await this.updateViewIfNeeded()
                    break
                }
                case DO_APP_ACTION_MSG_TYPE: {
                    const action = data.action as ApplicationAction;
                    const appName = data.appName

                    switch (action) {
                        case 'Deploy': case 'Update': {
                            const error = await this.deployApplication({
                                name: appName,
                                updateRunningApp: (action == 'Update')
                            })
                            this.fetchApplicationStatuses().then(() => this.updateViewIfNeeded()).catch()

                            if (error != null) {
                                this.ctx.debugChannel.appendLine(error.message)
                                vscode.window.showErrorMessage(error.message)
                                return
                            }
                            break
                        }
                        case 'Stop': {
                            const error = await this.stopApplication({ name: appName, force: false })
                            this.fetchApplicationStatuses().then(() => this.updateViewIfNeeded()).catch()

                            if (error != null) {
                                this.ctx.debugChannel.appendLine(error.message)
                                vscode.window.showErrorMessage(error.message)
                                return
                            }
                            break
                        }
                    }
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

        const head = /*html*/`<head>
            <meta charset="UTF-8">
            <meta 
                http-equiv="Content-Security-Policy" 
                content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${cssNonce}'; script-src 'nonce-${scriptNonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Account</title>
        </head>`

        if(! this.ctx.canProjectBeDeployedInProd){
            return /*html*/`<!DOCTYPE html><html>
                ${head}
                    <body>
                    <style nonce='${cssNonce}'>
                        ${makeBaseStyleeshet()}
                    </style>

                    <span class="muted-text">${PROD_NOT_AVAILABLE_MSG}</span>
                </body>
            </html>`
        }


        return /*html*/`<!DOCTYPE html>
        <html lang="en">
            ${head}
        <body>
            <style nonce='${cssNonce}'>
                ${makeBaseStyleeshet()}
                ${this.makeStylesheet()}
            </style>

            <main>
                ${this.renderApplicationsSection()}
                ${this.renderActionsSection()}
            </main>

            <footer>
                <span class="muted-text">In the near future the project server will provide a dashboard to perform more complex operations.</span>
            </footer>

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
                    const modulePath = String(data.get("modulePath"));
                    vscode.postMessage({ type: '${REGISTER_APP_MSG_TYPE}', name: name, modulePath: modulePath });
                })

                const actionButtons = document.querySelectorAll('[data-action]')
                for(const button of actionButtons){
                    button.addEventListener('click', event => {
                        vscode.postMessage({ 
                            type: '${DO_APP_ACTION_MSG_TYPE}', 
                            action: button.dataset.action,
                            appName: button.dataset.appName,
                         });
                    })
                }
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
            const { statuses } = <any>await lspClient.sendRequest(LIST_APPS_METHOD, {})
            newStatuses = statuses
        } catch {
            newStatuses = undefined
        }


        //no changes
        if (JSON.stringify(prevStatuses) == JSON.stringify(newStatuses)) {
            return
        }

        this.viewUpdateNeeded = true
        this.data.applicationStatuses = newStatuses
    }

    private async registerApplication(name: string, modulePath: string): Promise<Error | null> {
        const lspClient = this.ctx.lspClient
        if (lspClient === undefined || !lspClient.isRunning()) {
            return new Error('LSP client not running')
        }

        try {
            const resp = <any>await lspClient.sendRequest(REGISTER_APP_METHOD, {
                name: name,
                modulePath: modulePath
            })
            if ('error' in resp) {
                return new Error(resp.error)
            }
            return null
        } catch (err) {
            return new Error(stringifyCatchedValue(err))
        }
    }

    private async deployApplication(args: { name: string, updateRunningApp: boolean }): Promise<Error | null> {
        const lspClient = this.ctx.lspClient
        if (lspClient === undefined || !lspClient.isRunning()) {
            return new Error('LSP client not running')
        }

        try {
            const resp = <any>await lspClient.sendRequest(DEPLOY_APP_METHOD, {
                name: args.name,
                updateRunningApp: args.updateRunningApp,
            })
            if ('error' in resp) {
                return new Error(resp.error)
            }
            return null
        } catch (err) {
            return new Error(stringifyCatchedValue(err))
        }
    }

    private async stopApplication(args: { name: string, force: boolean }): Promise<Error | null> {
        const lspClient = this.ctx.lspClient
        if (lspClient === undefined || !lspClient.isRunning()) {
            return new Error('LSP client not running')
        }

        try {
            const resp = <any>await lspClient.sendRequest(STOP_APP_METHOD, { name: args.name, })
            if ('error' in resp) {
                return new Error(resp.error)
            }
            return null
        } catch (err) {
            return new Error(stringifyCatchedValue(err))
        }
    }

    private async updateViewIfNeeded() {
        if (!this.viewUpdateNeeded) {
            return
        }
        if (this.view === undefined) {
            return
        }
        this.viewUpdateNeeded = false
        this.view.webview.html = await this.getHTML()
    }

    private renderApplicationsSection() {
        const liElements = Object.entries(this.data.applicationStatuses ?? {}).map(([appName, appStatus]) => {
            let deployAction: ApplicationAction = 'None'
            let stopAction: ApplicationAction = 'Stop'
            let allowStop = false
            let appStatusName: string|undefined


            switch (appStatus) {
                case 'undeployed':
                    deployAction = 'Deploy'
                    appStatusName = appStatus
                    break
                case 'erroneously-stopped':
                    deployAction = 'Deploy'
                    appStatusName = 'stopped with errors'
                    break
                case 'failed-to-prepare':
                    deployAction = 'Deploy'
                    appStatusName = 'failed prep.'
                    break
                case 'gracefully-stopped':
                    deployAction = 'Deploy'
                    appStatusName = 'stopped'
                    break
                case 'gracefully-stopping':
                    deployAction = 'None'
                    appStatusName = 'stopping'
                    break
                case 'deployed':
                    deployAction = 'Update'
                    allowStop = true
                    stopAction = 'Stop'
                    break
                default:
                    appStatusName = appStatus
            }


            if(appStatusName == undefined){
                appStatusName = appStatus
            }


            return /*html*/`<li><section class="app">
                <header>${appName}</header>
                <div>
                    <span class="label">Status: </span>
                    <span data-status="${appStatus}">${appStatusName}</span>
                </div>
              
                <div class="app-actions">
                    ${(deployAction == 'None') ? '' :
                        /*html*/`<button data-action=${deployAction} data-app-name=${appName}>${deployAction}</button>
                        `

                }
                    <button ${!allowStop ? 'disabled' : ''} data-action=${stopAction} data-app-name=${appName}>${stopAction}</button>
                </div>
            </section></li>`
        }).join('\n')

        return /*html*/`<section class="applications">
            <header>Applications</header>

            ${(this.data.applicationStatuses === undefined) ?
                'failed to get application statuses' :
                (Object.keys(this.data.applicationStatuses).length == 0) ?
                /*html*/`<span class="muted-text"> No applications registered.</span>` :
                /*html*/`<ul class="apps">${liElements} </ul>`
            }
        </section>`
    }

    private renderActionsSection() {
        return /*html*/`<section class="actions">
            <header>Register Application</header>

            <span class="muted-text">Registering an application module makes it deployable.</span>

            <form id="register-app-form">
                <input required name="name" type="text" pattern="^[a-z]([a-z0-9]|-)*$" placeholder="name (example: main-app)">
                <input required name="modulePath" type="text" pattern="^/.*\.ix*$" placeholder="absolute module path (example: /main.ix)">            
                <button id="show-prod-btn">Register</button>
            </form>
        </section>`
    }

    private makeStylesheet() {
        return /*css*/`
            html, body {
                overflow-y: scroll;
            }

            main {
                display: flex;
                flex-direction: column;
                width: 100%;
                align-items: start;
                gap: 20px;
            }

            .applications, .actions {
                display: flex;
                flex-direction: column;
                width: 100%;
                align-items: start;
                gap: 5px;
            }

            form {
                display: flex;
                flex-direction: column;
                width: 100%;
                align-items: start;
                gap: 10px;
            }

            header {
                font-size: 18px;
            }

            footer {
                margin-top: 5px;
                font-size: 12px;

                display: flex;
                flex-direction: column;
                width: 100%;
                align-items: center;
                gap: 5px;
            }

            input {
                width: 100%;
            }

            .apps {
                width: 100%;

                border-bottom: var(--thin-border);
                display: flex;
                flex-direction: column;
            }

            .app {
                border-top: var(--thin-border);
                padding: 5px;

                display: flex;
                flex-direction: column;
                gap: 7px;
            }

            .app button {
                height: 23px;
                display: inline-flex;
                align-items: center; 
            }

            .app-actions {
                display: flex;
                flex-direction: row;
                gap: 10px;
                padding-top: 5px;
            }

            .label {
                font-weight: 600;
                font-size: 13px;
            }

            [data-status] {
                font-weight: 700;
                border-radius: 2px;
                padding: 3px;
            }

            [data-status=undeployed] {
                color: var(--vscode-descriptionForeground);
            }

            [data-status=deploying],  [data-status=gracefully-stopping] {
                color: var(--transitional-state-foreground);
                background-color: var(--transitional-state-background);
            }

            [data-status=deployed] {
                color: var(--success-foreground);
                background-color: var(--success-background);
            }

            [data-status=gracefully-stopped] {
                color: var(--vscode-descriptionForeground);
            }

            [data-status=erroneously-stopped], [data-status=failed-to-prepare] {
                color: var(--error-state-foreground);
                background-color: var(--error-state-background);
            }
        `
    }
}


