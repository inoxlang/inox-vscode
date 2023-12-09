import * as vscode from 'vscode';

import { LanguageClient, State } from 'vscode-languageclient/node';
import { Configuration } from './configuration';
import { InoxFS } from './inox-fs';
import { LSP_CLIENT_STOP_TIMEOUT_MILLIS } from './lsp';
import { stringifyCatchedValue } from './utils';

const GLOBAL_STATE_ENTRY_PREFIX = 'inox/'

type InoxExtensionContextArgs = {
    base: vscode.ExtensionContext,
    initialConfig: Configuration,
    getCurrentConfig: (outputChannel: vscode.OutputChannel) => Promise<Configuration | undefined>,
    createLSPClient: (ctx: InoxExtensionContext, forceProjetMode: boolean) => LanguageClient
    checkConnAndStartLocalProjectServerIfPossible: (ctx: InoxExtensionContext) => Promise<boolean>
    outputChannel: vscode.OutputChannel
    debugChannel: vscode.OutputChannel
    testChannel: vscode.OutputChannel
}

export class InoxExtensionContext {

    private _args: InoxExtensionContextArgs
    private _config: Configuration
    private _lspClient: LanguageClient | undefined
    private _lspClientFailedStart = false
    private _projectOpen: boolean = false
    private _canProjectBeDeployedInProd: boolean = false
    private _projectOpenEmitter = new vscode.EventEmitter<void>();
    private _restartingClient = false
    private _lastFailedToConnectTime: number|null = null

    readonly outputChannel: vscode.OutputChannel
    readonly debugChannel: vscode.OutputChannel
    readonly testChannel: vscode.OutputChannel


    readonly base: vscode.ExtensionContext
    readonly virtualWorkspace: boolean
    readonly onProjectOpen = this._projectOpenEmitter.event

    readonly virtualDocumentContents = new Map<string, string>();

    inoxFS: InoxFS | undefined


    constructor(args: InoxExtensionContextArgs) {
        this._args = args

        this.base = args.base
        this._config = args.initialConfig
        this.virtualWorkspace = args.initialConfig.inVirtualWorkspace,
            this.outputChannel = args.outputChannel
        this.debugChannel = args.debugChannel
        this.testChannel = args.testChannel

        vscode.workspace.onDidChangeConfiguration(() => this.updateConfiguration())

        args.base.subscriptions.push(this)
    }

    async updateConfiguration() {
        const previousConfig = this.config

        const newConfig = await this._args.getCurrentConfig(this.outputChannel)
        if (newConfig != undefined) {

            this._config = newConfig
            this.debugChannel.appendLine('configuration updated')
        }
    }

    //start or restart the LSP client.
    async restartLSPClient(forceProjetMode: boolean): Promise<void> {
        if (this._restartingClient) {
            return
        }
        this._projectOpen = false
        this._restartingClient = true

        if (! await this._args.checkConnAndStartLocalProjectServerIfPossible(this)) {
            this._lastFailedToConnectTime = Date.now()

            this.debugChannel.appendLine('LSP server is not running, abort client restart')
            this._restartingClient = false
            return
        }
        this._lastFailedToConnectTime = null

        if (this._lspClient === undefined) {
            this._lspClient = this._args.createLSPClient(this, forceProjetMode)
            this.base.subscriptions.push(this._lspClient)
        } else if (this._lspClientFailedStart) {
            //note: no need to call this._lspClient.dispose() because close() will be called.
            this._lspClient = this._args.createLSPClient(this, forceProjetMode)
            this.base.subscriptions.push(this._lspClient)
        } else {
            if (this._lspClient.needsStop()) {
                try {
                    this.debugChannel.appendLine('Stop LSP client')
                    await this._lspClient.stop(LSP_CLIENT_STOP_TIMEOUT_MILLIS)
                    this.debugChannel.appendLine('LSP client stopped')
                } catch {
                    if (this._lspClient.isRunning()) {
                        this.debugChannel.appendLine('LSP client is still running !!')
                    }
                }
            } else {
                this.debugChannel.appendLine('LSP client does not need to be stopped')
            }
        }

        if (!this.config.project) {
            //TODO: remove filesystem.
        }

        this.debugChannel.appendLine('Start / Restart LSP client')
        try {
            await this._lspClient.restart()
            //the project will be open on restart
        } catch (err) {
            const msg = stringifyCatchedValue(err)
            this.outputChannel.appendLine(msg)
            this.debugChannel.appendLine(msg)
        } finally {
            this._lspClientFailedStart = this._lspClient.state == State.Stopped
            this._restartingClient = false
        }
    }

    get lspClient() {
        return this._lspClient
    }

    get config() {
        return this._config
    }

    get fileWorkspaceFolder() {
        let fileFsFolder: vscode.WorkspaceFolder | undefined

        for (const folder of vscode.workspace.workspaceFolders || []) {
            if (folder.uri.scheme != 'file') {
                continue
            }

            fileFsFolder = folder
        }

        if (!fileFsFolder) {
            vscode.window.showErrorMessage("no file:// folder")
            throw new Error('no file:// folder')
        }

        return fileFsFolder
    }

    get projectOpen() {
        return this._projectOpen
    }

    markProjectAsOpen(args: {canProjectBeDeployedInProd: boolean}) {
        this._projectOpen = true
        this._projectOpenEmitter.fire()
        this._canProjectBeDeployedInProd = args.canProjectBeDeployedInProd
        this.outputChannel.appendLine('project is now open')
        this.debugChannel.appendLine('project is now open ' + JSON.stringify(args))
    }

    get canProjectBeDeployedInProd(): boolean {
        return this._canProjectBeDeployedInProd
    }

    get lastFailedToConnectTime() {
        return this._lastFailedToConnectTime
    }

    getStateValue(key: string) {
        return this.base.globalState.get(GLOBAL_STATE_ENTRY_PREFIX + key)
    }

    setStateValue(key: string, value: unknown) {
        const serialized = JSON.stringify(value)
        if (JSON.stringify(JSON.parse(serialized)) != serialized) {
            throw new Error('value is not properly serializable')
        }

        return this.base.globalState.update(GLOBAL_STATE_ENTRY_PREFIX + key, value)
    }

    clearState() {
        //remove all keys
        this.base.globalState.keys().forEach(key => this.base.globalState.update(key, undefined))
    }

    dispose() {
        this._projectOpenEmitter.dispose()
    }


}