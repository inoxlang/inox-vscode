import * as vscode from 'vscode';

import { DocumentFormattingParams, TextDocumentIdentifier } from 'vscode-languageclient';
import { getConfiguration } from './configuration';
import { InlineDebugAdapterFactory } from './debug';
import { LSP_CLIENT_NOT_RUNNING_MSG } from './errors';
import { InoxExtensionContext } from './inox-extension-context';
import { INOX_FS_SCHEME, createAndRegisterInoxFs } from './inox-fs';
import { registerLearningCodeLensAndCommands } from './learn/learn';
import { createLSPClient, startLocalProjectServerIfNecessary } from './lsp';
import { initializeNewProject } from './project';
import { SecretEntry, SecretKeeper } from './project/secret-keeper';
import { computeSuggestions } from './suggestions';

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


    //
    registerLearningCodeLensAndCommands(ctx)

    //register commands
    {
        vscode.commands.registerCommand('inox.clear-global-state', async () => {
            ctx.clearState()
        })

        vscode.commands.registerCommand('inox.lsp.restart', async () => {
            await ctx.updateConfiguration()
            return ctx.restartLSPClient(false)
        })

        vscode.commands.registerCommand('inox.project.initialize', async () => {
            return initializeNewProject(ctx)
        })
    }

    computeSuggestions(ctx, 2).forEach(suggestion => {
        suggestion.show()
    })

}

export function deactivate(): Thenable<void> | undefined {
    return
}

