import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, MessageTransports, RevealOutputChannelOn } from 'vscode-languageclient/node';

import { WebSocket as _Websocket } from 'ws';
import { inspect } from 'util';
import { connectToWebsocketServer } from './websocket';
import { REMOTE_FS_SCHEME, RemoteFS as RemoteFilesystem } from './inox-fs';
import { createLSPClient, needsToRecreateLspClient } from './lsp';
import { getConfiguration } from './configuration';
import { InoxExtensionContext } from './inox-extension-context';

let client: LanguageClient;
let outputChannel: vscode.OutputChannel;
let debugOutputChannel: vscode.OutputChannel;


export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');
  debugOutputChannel = vscode.window.createOutputChannel('Inox Extension (Debug)');

  const config = getConfiguration(outputChannel)
  if (!config) {
    return
  }

  const ctx = new InoxExtensionContext({
    base: context,
    initialConfig: config,
    outputChannel: outputChannel,
    debugOutputChannel: debugOutputChannel,

    getCurrentConfig: getConfiguration,
    createLSPClient: createLSPClient,
    needsToRecreateLspClient: needsToRecreateLspClient,
  })

  const useWebsocket = !config.useInoxBinary

  if (useWebsocket) {
    // create filesystem
    outputChannel.appendLine('create remote filesystem')
    ctx.remoteFs = new RemoteFilesystem(outputChannel);
    ctx.base.subscriptions.push(vscode.workspace.registerFileSystemProvider(REMOTE_FS_SCHEME, ctx.remoteFs, { isCaseSensitive: true }));

    outputChannel.appendLine('update workspace folders')

    vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.parse(`${REMOTE_FS_SCHEME}:/`), name: "Remote FS" });
  }

  ctx.restartLSPClient()

  vscode.commands.registerCommand('lsp/restart', () => {
    return ctx.restartLSPClient()
  })

}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

