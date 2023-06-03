import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import type { RemoteFS } from './inox-fs';
import { Configuration } from './configuration';
import { LSP_CLIENT_STOP_TIMEOUT_MILLIS, needsToRecreateLspClient } from './lsp';

type InoxExtensionContextArgs = {
    base: vscode.ExtensionContext,
    initialConfig: Configuration,
    getCurrentConfig: (outputChannel: vscode.OutputChannel) => Configuration | undefined,
    createLSPClient: (ctx: InoxExtensionContext) => LanguageClient
    needsToRecreateLspClient: (ctx: InoxExtensionContext, previousConfig: Configuration) => boolean
    outputChannel: vscode.OutputChannel
    debugOutputChannel: vscode.OutputChannel
}

export class InoxExtensionContext {

    private _args: InoxExtensionContextArgs
    private _config: Configuration
    private _needsToRecreateLspClient = false

    remoteFs: RemoteFS | undefined
    private _lspClient: LanguageClient | undefined

    readonly base: vscode.ExtensionContext
    readonly outputChannel: vscode.OutputChannel
    readonly debugOutputChannel: vscode.OutputChannel

    constructor(args: InoxExtensionContextArgs) {
        this._args = args

        this.base = args.base
        this._config = args.initialConfig
        this.outputChannel = args.outputChannel
        this.debugOutputChannel = args.debugOutputChannel

        vscode.workspace.onDidChangeConfiguration(() => {
            const previousConfig = this.config

            const newConfig = this._args.getCurrentConfig(this.outputChannel)
            if (newConfig != undefined) {
                this._config = newConfig
                this.debugOutputChannel.appendLine('configuration updated')

                if (!this._needsToRecreateLspClient) {
                    this._needsToRecreateLspClient = this._args.needsToRecreateLspClient(this, previousConfig)
                    if (this._needsToRecreateLspClient) {
                        this.debugOutputChannel.appendLine('the new configuration requires the LSP client to be recreated')
                    }
                }
            }
        })
    }

    //start or restart the LSP client.
    async restartLSPClient(): Promise<void> {
        if (this._lspClient === undefined) {
            this._lspClient = this._args.createLSPClient(this)
        } else {
            const needsToRecreateLspClient = this._needsToRecreateLspClient
            this._needsToRecreateLspClient = false

            if (this.lspClient?.needsStop || needsToRecreateLspClient) {
                try {
                    this.debugOutputChannel.appendLine('Stop LSP client')
                    await this._lspClient.stop(LSP_CLIENT_STOP_TIMEOUT_MILLIS)
                    this.debugOutputChannel.appendLine('LSP client stopped')
                } catch {
                    if(this._lspClient.isRunning()){
                        this.debugOutputChannel.appendLine('LSP client is still running !!')
                    }
                 }
            } else {
                this.debugOutputChannel.appendLine('LSP client does not need to be stopped')
            }

            if (needsToRecreateLspClient) {
                this.debugOutputChannel.appendLine('recreate LSP client')
                this._lspClient = this._args.createLSPClient(this)
            }
        }

        if (this.remoteFs) {
            this.remoteFs.lspClient = this._lspClient
        }

        this.debugOutputChannel.appendLine('Start / Restart LSP client')
        try {
            return this._lspClient.restart()
        } catch (err) {
            this.outputChannel.appendLine(String(err))
        }
    }

    get lspClient() {
        return this._lspClient
    }

    get config() {
        return this._config
    }
}