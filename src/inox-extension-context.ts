import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { InoxFS } from './inox-fs';
import { Configuration } from './configuration';
import { LSP_CLIENT_STOP_TIMEOUT_MILLIS } from './lsp';

type InoxExtensionContextArgs = {
    base: vscode.ExtensionContext,
    virtualWorkspace: boolean,
    initialConfig: Configuration,
    getCurrentConfig: (outputChannel: vscode.OutputChannel) => Promise<Configuration | undefined>,
    createLSPClient: (ctx: InoxExtensionContext, forceProjetMode: boolean) => LanguageClient
    outputChannel: vscode.OutputChannel
    debugChannel: vscode.OutputChannel
    traceChannel: vscode.OutputChannel
}

export class InoxExtensionContext {

    private _args: InoxExtensionContextArgs
    private _config: Configuration
    private _lspClient: LanguageClient | undefined

    inoxFS: InoxFS | undefined

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
        }
    }

    //start or restart the LSP client.
    async restartLSPClient(forceProjetMode: boolean): Promise<void> {
        if (this._lspClient === undefined) {
            this._lspClient = this._args.createLSPClient(this, forceProjetMode)
            this.base.subscriptions.push(this._lspClient)
        } else {
            if (this.lspClient?.needsStop()) {
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
}