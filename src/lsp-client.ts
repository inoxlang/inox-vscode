import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import * as vscode from 'vscode';
import { REMOTE_FS_SCHEME } from "./inox-fs";

export function createLSPClient({outputChannel, traceOutputChannel, serverOptions, useInoxBinary}: { 
    outputChannel: vscode.OutputChannel, 
    traceOutputChannel: vscode.OutputChannel, 
    serverOptions: ServerOptions,
    useInoxBinary: boolean,
}) {
 
    let documentScheme = REMOTE_FS_SCHEME
    if(useInoxBinary){
        documentScheme = 'file'
    }

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: documentScheme, language: 'inox' }],
        synchronize: {
            configurationSection: 'Inox',
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
        },
        outputChannel: outputChannel,
        traceOutputChannel: traceOutputChannel,
    };

    //create LSP client

    const client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
    outputChannel.appendLine('start LSP client')
    return client
}