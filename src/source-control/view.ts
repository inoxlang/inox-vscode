import * as vscode from 'vscode';
import * as path from 'path'
import * as fs from 'fs'

import { InoxExtensionContext } from "../inox-extension-context";
import { assertNotNil, getNonce, stringifyCatchedValue } from '../utils';
import { getBaseStylesheet as makeBaseStyleeshet } from '../style/stylesheet';
import { WebSocket as _Websocket } from 'ws';
import { CommitInfo } from './data_types';
import { CSS_SCOPE_INLINE_JS, HYPER_SCRIPT_MIN_JS } from './js';
import { renderLog } from './log-view';

let surrealJS: string | undefined
let cssScopeInlineJS: string | undefined


export class SourceControlPanel {

    //static

    public static currentPanel: SourceControlPanel | undefined;
    public static readonly viewType = 'sourceControl';
    private static _ctx: InoxExtensionContext | undefined

    public static set ctx(ctx: InoxExtensionContext) {
        this._ctx = ctx
    }

    public static createOrShow() {
        if (this._ctx === undefined) {
            throw new Error('context not set')
        }

        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (SourceControlPanel.currentPanel) {
            SourceControlPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            SourceControlPanel.viewType,
            'Source Control',
            column || vscode.ViewColumn.One,
            getWebviewOptions(this._ctx),
        );

        SourceControlPanel.currentPanel = new SourceControlPanel(panel);
    }

    public static revive(panel: vscode.WebviewPanel) {
        SourceControlPanel.currentPanel = new SourceControlPanel(panel);
    }

    //instance properties

    private _disposables: vscode.Disposable[] = [];
    private _viewUpdateNeeded = false

    constructor(
        private readonly _panel: vscode.WebviewPanel,
    ) {

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) { }
            },
            null,
            this._disposables
        );
    }


    public dispose() {
        SourceControlPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private get sourceControl() {
        const sourceControl = SourceControlPanel._ctx!.sourceControl
        assertNotNil(sourceControl)
        return sourceControl
    }

    private async _update() {
        const webview = this._panel.webview;

        const hash = await this.sourceControl.getLastDevCommitHash()

        let commits: CommitInfo[] = []

        if (typeof hash == 'string') {
            const result = await this.sourceControl.getDevLog(hash)
            if (Array.isArray(result)) {
                commits = result
            } else {
                vscode.window.showWarningMessage('Failed to get commit log: ' + result.message)
            }
        } else if (hash instanceof Error) {
            vscode.window.showWarningMessage('Failed to get last dev commit: ' + hash.message)
        }

        webview.html = await this.getHTML(webview, commits)
    }


    private async getHTML(webview: vscode.Webview, commits: CommitInfo[]) {
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

        return /*html*/`<!DOCTYPE html>
        <html lang="en">
            ${head}
        <body>
            <style nonce='${cssNonce}'>
                ${makeBaseStyleeshet()}
                ${this.makeStylesheet()}
            </style>

            <script nonce='${scriptNonce}'>
                ${HYPER_SCRIPT_MIN_JS}

                ${CSS_SCOPE_INLINE_JS}
            </script>


            <main>
                ${renderLog(commits, cssNonce)}
            </main>

            <footer>
                <span class="muted-text"></span>
            </footer>

            <script nonce='${scriptNonce}'>
                //https://code.visualstudio.com/api/extension-guides/webview

                const vscode = acquireVsCodeApi();
                const oldState = vscode.getState() || { };                
            </script>
        </body>
        </html>`;
    }


    private makeStylesheet() {
        return /*css*/`
            html, body {
                overflow-y: scroll;
            }

            main {
                display: grid;
                grid-template-columns: 40% 60%;
                width: 100%;
                align-items: start;
                gap: 20px;
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

            .hidden {
                display: none;
            }
        `
    }
}

function getWebviewOptions(ctx: InoxExtensionContext): vscode.WebviewOptions {

    const extensionUri = ctx.base.extensionUri

    return {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
}