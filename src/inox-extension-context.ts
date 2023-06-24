import * as vscode from 'vscode';
import { LanguageClient, State } from 'vscode-languageclient/node';
import { InoxFS } from './inox-fs';
import { Configuration } from './configuration';
import { LSP_CLIENT_STOP_TIMEOUT_MILLIS } from './lsp';
import { stringifyCatchedValue } from './utils';

type InoxExtensionContextArgs = {
    base: vscode.ExtensionContext,
    virtualWorkspace: boolean,
    initialConfig: Configuration,
    getCurrentConfig: (outputChannel: vscode.OutputChannel) => Promise<Configuration | undefined>,
    createLSPClient: (ctx: InoxExtensionContext, forceProjetMode: boolean) => LanguageClient
    startLocalProjectServerIfNecessary: (ctx: InoxExtensionContext) => Promise<void>
    openProject: (ctx: InoxExtensionContext) => Promise<void>
    outputChannel: vscode.OutputChannel
    debugChannel: vscode.OutputChannel
    traceChannel: vscode.OutputChannel
}

export class InoxExtensionContext {

    private _args: InoxExtensionContextArgs
    private _config: Configuration
    private _lspClient: LanguageClient | undefined
    private _lspClientFailedStart = false
    private _projectOpen: boolean = false
	private _projectOpenEmitter = new vscode.EventEmitter<void>();

    readonly outputChannel: vscode.OutputChannel
    readonly debugChannel: vscode.OutputChannel
    readonly traceChannel: vscode.OutputChannel
    
    readonly base: vscode.ExtensionContext
    readonly virtualWorkspace: boolean
    readonly onProjectOpen = this._projectOpenEmitter.event
    
    inoxFS: InoxFS | undefined


    constructor(args: InoxExtensionContextArgs) {
        this._args = args

        this.base = args.base
        this._config = args.initialConfig
        this.virtualWorkspace = args.virtualWorkspace
        this.outputChannel = args.outputChannel
        this.debugChannel = args.debugChannel
        this.traceChannel = args.traceChannel

        vscode.workspace.onDidChangeConfiguration(() => this.updateConfiguration())

        args.base.subscriptions.push(this)
    }

    async updateConfiguration(){
        const previousConfig = this.config

        const newConfig = await this._args.getCurrentConfig(this.outputChannel)
        if (newConfig != undefined) {

            this._config = newConfig
            this.debugChannel.appendLine('configuration updated')
        }
    }

    //start or restart the LSP client.
    async restartLSPClient(forceProjetMode: boolean): Promise<void> {
        this.projectOpen = false

        await this._args.startLocalProjectServerIfNecessary(this)

        if (this._lspClient === undefined) {
            this._lspClient = this._args.createLSPClient(this, forceProjetMode)
            this.base.subscriptions.push(this._lspClient)
        } else if(this._lspClientFailedStart) {
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
                    if(this._lspClient.isRunning()){
                        this.debugChannel.appendLine('LSP client is still running !!')
                    }
                 }
            } else {
                this.debugChannel.appendLine('LSP client does not need to be stopped')
            }
        }

        if(this.config.project){
            if(this.inoxFS){
                this.inoxFS.ctx = this
            }
        } else if(this.inoxFS){
            //TODO: remove filesystem.
        }

        this.debugChannel.appendLine('Start / Restart LSP client')
        try {
            await this._lspClient.restart()
            await this._args.openProject(this)
        } catch (err) {
            const msg = stringifyCatchedValue(err)
            this.outputChannel.appendLine(msg)
            this.debugChannel.appendLine(msg)
        } finally {
            this._lspClientFailedStart = this._lspClient.state == State.Stopped
        }
    }

    get lspClient() {
        return this._lspClient
    }

    get config() {
        return this._config
    }

    get fileWorkspaceFolder(){
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

    set projectOpen(val: boolean) {
        if(val){
            this._projectOpenEmitter.fire()
        }
        this._projectOpen = val
    }


    dispose(){
        this._projectOpenEmitter.dispose()
    }
}