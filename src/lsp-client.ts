import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import * as vscode from 'vscode';

export function startLSPClient({outputChannel, traceOutputChannel, serverOptions}: { 
    outputChannel: vscode.OutputChannel, 
    traceOutputChannel: vscode.OutputChannel, 
    serverOptions: ServerOptions }) {
        
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'inox' }],
        synchronize: {
            configurationSection: 'Inox',
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
        },
        outputChannel: outputChannel,
        traceOutputChannel: traceOutputChannel,
        middleware: {
            didOpen(data, next) {
                return next(data)
            }
        }
    };


    //create LSP client

    const client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
    outputChannel.appendLine('start LSP client')
    client.start();
    return client
}