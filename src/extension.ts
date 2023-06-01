import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, MessageTransports, RevealOutputChannelOn } from 'vscode-languageclient/node';
import { listen, WebSocketMessageReader, WebSocketMessageWriter, toSocket, ConsoleLogger } from './vscode-ws-jsonrpc/src/index'

import { WebSocket as _Websocket } from 'ws';
import { inspect } from 'util';
import { connectToWebsocketServer } from './websocket';
import { REMOTE_FS_SCHEME, RemoteFS as RemoteFilesystem } from './inox-fs';
import { startLSPClient } from './lsp-client';
import { getConfiguration } from './configuration';

let client: LanguageClient;
let outputChannel: vscode.OutputChannel;
let traceOutputChannel: vscode.OutputChannel;


export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');
  traceOutputChannel = vscode.window.createOutputChannel('Inox Extension (Trace)');

  const config = getConfiguration(outputChannel)
  if (!config) {
    return
  }

  //configure & start LSP client
  const serverOptions = getLspServerOptions(config.useInoxBinary, config.websocketEndpoint)
  const lspClient = startLSPClient({ serverOptions, outputChannel, traceOutputChannel })

  // create filesystem
  outputChannel.appendLine('create remote filesystem')
  const fls = new RemoteFilesystem(lspClient, outputChannel);
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider(REMOTE_FS_SCHEME, fls, { isCaseSensitive: true }));

  outputChannel.appendLine('update workspace folders')

  vscode.workspace.registerFileSystemProvider(REMOTE_FS_SCHEME, fls)
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}


function getLspServerOptions(useInoxBinary: boolean, websocketEndpoint: URL): ServerOptions {
  if (useInoxBinary) {
    outputChannel.appendLine('use inox binary')
    return {
      command: 'inox',
      args: ['lsp'],
    };
  }

  outputChannel.appendLine('use websocket')
  return connectToWebsocketServer(outputChannel, traceOutputChannel, websocketEndpoint.toString())
}
