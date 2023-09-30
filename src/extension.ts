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
import { sleep } from './utils';
const PROJECT_NAME_REGEX = /^[a-z][a-z0-9_-]+$/i

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
            await ctx.updateConfiguration()

            if (ctx.config.projectFilePresent) {
                const msg = '[project/initialize] project is already initialized'
                vscode.window.showWarningMessage(msg)
                ctx.debugChannel.appendLine(msg)
                return
            }


            let projectName: string
            {

                let input: string | undefined
                let tries = 2

                while (tries > 0 && input === undefined) {
                    tries--
                    input = await vscode.window.showInputBox({
                        placeHolder: 'Examples: learn-inox, my-web-app',
                        prompt: `Name of the project`,
                        async validateInput(value) {
                            if (PROJECT_NAME_REGEX.test(value)) {
                                return null
                            } else {
                                return {
                                    message: "The project's name should starts with a letter and should only contains letters, digits, '-' and '_'",
                                    severity: vscode.InputBoxValidationSeverity.Error
                                }
                            }
                        },
                    })
                }

                if (input === undefined) {
                    return
                }
                projectName = input
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
                for (let i = 0; i < 3; i++) {
                    if (!ctx.lspClient?.isRunning()) {
                        await sleep(1000)
                    }
                }

                if (!ctx.lspClient?.isRunning()) {
                    progress.report({ increment: 100 });
                    vscode.window.showErrorMessage(LSP_CLIENT_NOT_RUNNING_MSG)
                }

                await initializeNewProject(ctx, projectName)

                vscode.window.showInformationMessage(
                    "The project should have been created on the server. You can open it by clicking 'Open Workspace' in the `.code-workspace` file."
                )

                progress.report({ increment: 100 });
            });
        })
    }

    computeSuggestions(ctx, 2).forEach(suggestion => {
        suggestion.show()
    })

}

export function deactivate(): Thenable<void> | undefined {
    return
}

