import * as vscode from 'vscode';
import * as fs from 'fs';

import { DocumentFormattingParams, TextDocumentIdentifier } from 'vscode-languageclient';
import { getConfiguration } from './configuration';
import { InlineDebugAdapterFactory } from './debug';
import { InoxExtensionContext } from './inox-extension-context';
import { INOX_FS_SCHEME, createAndRegisterInoxFs } from './inox-fs';
import { registerLearningCodeLensAndCommands } from './learn/mod';
import { createLSPClient, createEmbeddedContentProvider, startLocalProjectServerIfNecessary } from './lsp';
import { initializeNewProject } from './project';
import { SecretEntry, SecretKeeper } from './project/secret-keeper';
import { computeSuggestions } from './suggestions';
import { registerSpecCodeLensAndCommands } from './testing/mod';
import { AccountManager } from './cloud/mod';
import { ProdOverview, registerProdManagerCommands } from './prod/mod';


// after this duration the local file cache is used as a fallack
const LOCAL_FILE_CACHE_FALLBACK_TIMEOUT_MILLIS = 3000;

let outputChannel: vscode.OutputChannel;
let debugChannel: vscode.OutputChannel;
let testChannel: vscode.OutputChannel;



export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Inox Extension');
    outputChannel.appendLine('Inox extension activate()')

    debugChannel = vscode.window.createOutputChannel('Inox Extension (Debug)');
    testChannel = vscode.window.createOutputChannel('Inox Tests');


    const config = await getConfiguration(outputChannel)
    if (!config) {
        return
    }

    const ctx = new InoxExtensionContext({
        base: context,
        initialConfig: config,
        outputChannel: outputChannel,
        debugChannel: debugChannel,
        testChannel: testChannel,

        getCurrentConfig: getConfiguration,
        createLSPClient: createLSPClient,
        startLocalProjectServerIfNecessary: startLocalProjectServerIfNecessary,
    })

    if (config.project) {
        ctx.inoxFS = createAndRegisterInoxFs(ctx)
        ctx.inoxFS.ctx = ctx
        setTimeout(() => {
            if (!ctx.lspClient?.isRunning()) {
                ctx.inoxFS?.fallbackOnLocalFileCache()
            }
        }, LOCAL_FILE_CACHE_FALLBACK_TIMEOUT_MILLIS)

        const secretKeeper = new SecretKeeper(ctx);
        vscode.window.registerTreeDataProvider('secretKeeper', secretKeeper);
        vscode.commands.registerCommand('inox.secretKeeper.addEntry', secretKeeper.addSecret.bind(secretKeeper))
        vscode.commands.registerCommand('inox.secretKeeper.deleteEntry', (entry: SecretEntry) => secretKeeper.deleteSecret(entry.label))
        vscode.commands.registerCommand('inox.secretKeeper.updateEntry', (entry: SecretEntry) => secretKeeper.updateSecret(entry.label))

        const accountManager = new AccountManager(ctx);
        vscode.window.registerWebviewViewProvider('accountManager', accountManager);

        const prodOverview = new ProdOverview(ctx);
        vscode.window.registerWebviewViewProvider('prodOverview', prodOverview);

        context.subscriptions.push(...registerProdManagerCommands(ctx));
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


    //------------

    vscode.workspace.registerTextDocumentContentProvider('embedded-content', createEmbeddedContentProvider(ctx))

    const debug = new InlineDebugAdapterFactory(ctx)
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('inox', debug));

    registerLearningCodeLensAndCommands(ctx)
    registerSpecCodeLensAndCommands(ctx)

    //register commands
    {
        vscode.commands.registerCommand('inox.clear-global-state', async () => {
            ctx.clearState()
        })

        vscode.commands.registerCommand('inox.clear-project-file-cache', async () => {
            ctx.inoxFS?.clearFileCache()
        })

        vscode.commands.registerCommand('inox.get-project-file-cache-dir', async () => {
            const dir = ctx.inoxFS?.fileCacheDir

            if (dir) {
                const entries = await fs.promises.readdir(dir).catch(() => null)
                if (entries === null) {
                    vscode.window.showWarningMessage('failed to read file cache dir: ' + dir + '. It may not exist.')
                } else {
                    vscode.window.showInformationMessage(((entries.length == 0) ? '(empty) ' : '') + dir)
                }
            } else {
                vscode.window.showInformationMessage('no file cache found for the current project')
            }
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

