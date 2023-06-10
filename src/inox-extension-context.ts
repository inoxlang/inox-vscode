import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { InoxFS } from './inox-fs';
import { Configuration } from './configuration';
import { LSP_CLIENT_STOP_TIMEOUT_MILLIS, needsToRecreateLspClient } from './lsp';

type InoxExtensionContextArgs = {
    base: vscode.ExtensionContext,
    virtualWorkspace: boolean,
    initialConfig: Configuration,
    getCurrentConfig: (outputChannel: vscode.OutputChannel) => Promise<Configuration | undefined>,
    createLSPClient: (ctx: InoxExtensionContext) => LanguageClient
    needsToRecreateLspClient: (ctx: InoxExtensionContext, previousConfig: Configuration) => boolean
    outputChannel: vscode.OutputChannel
    debugChannel: vscode.OutputChannel
    traceChannel: vscode.OutputChannel
}

export class InoxExtensionContext {

    private _args: InoxExtensionContextArgs
    private _config: Configuration
    private _needsToRecreateLspClient = false

    inoxFS: InoxFS | undefined
    private _lspClient: LanguageClient | undefined

    readonly base: vscode.ExtensionContext

    readonly outputChannel: vscode.OutputChannel
    readonly debugChannel: vscode.OutputChannel
    readonly traceChannel: vscode.OutputChannel

    readonly virtualWorkspace: boolean

    constructor(args: InoxExtensionContextArgs) {
        this._args = args

        this.base = args.base
        this._config = args.initialConfig
        this.virtualWorkspace = args.virtualWorkspace
        this.outputChannel = args.outputChannel
        this.debugChannel = args.debugChannel
        this.traceChannel = args.traceChannel

        vscode.workspace.onDidChangeConfiguration(() => this.updateConfiguration())
    }

    async updateConfiguration(){
        const previousConfig = this.config

        const newConfig = await this._args.getCurrentConfig(this.outputChannel)
        if (newConfig != undefined) {

            this._config = newConfig
            this.debugChannel.appendLine('configuration updated')

            if (!this._needsToRecreateLspClient) {
                this._needsToRecreateLspClient = this._args.needsToRecreateLspClient(this, previousConfig)
                if (this._needsToRecreateLspClient) {
                    this.debugChannel.appendLine('the new configuration requires the LSP client to be recreated')
                }
            }
        }
    }

    //start or restart the LSP client.
    async restartLSPClient(): Promise<void> {
        if (this._lspClient === undefined) {
            this._lspClient = this._args.createLSPClient(this)
            this.base.subscriptions.push(this._lspClient)
        } else {
            const needsToRecreateLspClient = this._needsToRecreateLspClient
            this._needsToRecreateLspClient = false

            if (this.lspClient?.needsStop || needsToRecreateLspClient) {
                try {
                    this.debugChannel.appendLine('Stop LSP client')
                    await this._lspClient.stop(LSP_CLIENT_STOP_TIMEOUT_MILLIS)
                    this.debugChannel.appendLine('LSP client stopped')
                } catch {
                    if(this._lspClient.isRunning()){
                        this.debugChannel.appendLine('LSP client is still running !!')
                    }
                 }
            } else {
                this.debugChannel.appendLine('LSP client does not need to be stopped')
            }

            if (needsToRecreateLspClient) {
                this.debugChannel.appendLine('recreate LSP client')
                this._lspClient = this._args.createLSPClient(this)
                this.base.subscriptions.push(this._lspClient)
            }
        }

        if(this.config.project){
            if(this.inoxFS){
                this.inoxFS.lspClient = this._lspClient
            }
        } else if(this.inoxFS){
            //TODO: remove filesystem.
        }

        this.debugChannel.appendLine('Start / Restart LSP client')
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