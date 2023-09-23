import * as vscode from 'vscode';

import { getConfiguration } from './configuration';
import { InoxExtensionContext } from './inox-extension-context';
import { INOX_FS_SCHEME, createAndRegisterInoxFs } from './inox-fs';
import { createLSPClient, startLocalProjectServerIfNecessary } from './lsp';
import { initializeNewProject, openProject } from './project';
import { sleep } from './utils';
import { InlineDebugAdapterFactory } from './debug';
import { DocumentFormattingParams, DocumentFormattingRequest, TextDocumentIdentifier } from 'vscode-languageclient';
import { SecretEntry, SecretKeeper } from './project/secret-keeper';

let outputChannel: vscode.OutputChannel;
let debugChannel: vscode.OutputChannel;


export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Inox Extension');
    outputChannel.appendLine('Inox extension activate()')

    debugChannel = vscode.window.createOutputChannel('Inox Extension (Debug)');

    const config = await getConfiguration(outputChannel)
    if (!config) {
        return
    }

    const isVirtualWorkspace =
        vscode.workspace.workspaceFolders != undefined &&
        vscode.workspace.workspaceFolders.every(f => f.uri.scheme !== 'file');

    if (isVirtualWorkspace) {
        vscode.window.showErrorMessage('virtual workspaces not supported yet')
        return
    }

    const ctx = new InoxExtensionContext({
        base: context,
        initialConfig: config,
        virtualWorkspace: isVirtualWorkspace,
        outputChannel: outputChannel,
        debugChannel: debugChannel,

        getCurrentConfig: getConfiguration,
        createLSPClient: createLSPClient,
        startLocalProjectServerIfNecessary: startLocalProjectServerIfNecessary,
        openProject: openProject
    })

    if (config.project) {
        ctx.inoxFS = createAndRegisterInoxFs(ctx)

        const secretKeeper = new SecretKeeper(ctx);
        vscode.window.registerTreeDataProvider('secretKeeper', secretKeeper);
        vscode.commands.registerCommand('inox.secretKeeper.addEntry', secretKeeper.addSecret.bind(secretKeeper))
        vscode.commands.registerCommand('inox.secretKeeper.deleteEntry', (entry: SecretEntry) => secretKeeper.deleteSecret(entry.label))
        vscode.commands.registerCommand('inox.secretKeeper.updateEntry', (entry: SecretEntry) => secretKeeper.updateSecret(entry.label))
    }

    ctx.restartLSPClient(false)

    //register formatting provider

    vscode.languages.registerDocumentFormattingEditProvider([{ scheme: INOX_FS_SCHEME, language: 'inox' }], {
        provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.ProviderResult<vscode.TextEdit[]> {
            if (ctx.lspClient === undefined) {
                return []
            }

            const params: DocumentFormattingParams = {
                textDocument: TextDocumentIdentifier.create(document.uri.toString()),
                options: options,
            }

            return ctx.lspClient.sendRequest('textDocument/formatting', params)
        }
    })


    //register debug adapter

    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('inox', new InlineDebugAdapterFactory(ctx)));

  //register commands

  vscode.commands.registerCommand('lsp/restart', async () => {
    await ctx.updateConfiguration()
    return ctx.restartLSPClient(false)
  })

    //register commands
    {
        vscode.commands.registerCommand('inox.lsp.restart', async () => {
            await ctx.updateConfiguration()
            return ctx.restartLSPClient(false)
        })

        vscode.commands.registerCommand('inox.project.initialize', async () => {
            await ctx.updateConfiguration()

            if (ctx.config.projectFilePresent) {
                const msg = '[project/initialize] project is already initialized'
                vscode.window.showWarningMessage(msg)
                ctx.debugChannel.appendLine(msg)
                return
            }

            debugChannel.appendLine('[project/initialize] restart LSP client in project mode')
            await ctx.restartLSPClient(true) //restart LSP client in project mode

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                cancellable: false,
                title: 'Creating Inox project in current folder'
            }, async (progress) => {
                progress.report({ increment: 0 });

                //wait for LSP client
                await sleep(3000) //TODO: replace sleep

                await initializeNewProject(ctx)

                progress.report({ increment: 100 });
            });
        })
    }


}

export function deactivate(): Thenable<void> | undefined {
    return
}

