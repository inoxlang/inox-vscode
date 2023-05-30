import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, MessageTransports, RevealOutputChannelOn } from 'vscode-languageclient/node';
import { listen, WebSocketMessageReader, WebSocketMessageWriter, toSocket, ConsoleLogger } from './vscode-ws-jsonrpc/src/index'

import { WebSocket as _Websocket } from 'ws';
import { inspect } from 'util';

let client: LanguageClient;
let outputChannel: vscode.OutputChannel;
let traceOutputChannel: vscode.OutputChannel;


export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');
  traceOutputChannel = vscode.window.createOutputChannel('Inox Extension (Trace)');

  const config = vscode.workspace.getConfiguration('inox')
  const useInoxBinary = config.get('useInoxBinary') === true
  const serverOptions = getLspServerOptions(useInoxBinary)


  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'inox' }],
    synchronize: {
      configurationSection: 'Inox',
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
    },
    outputChannel: outputChannel,
    traceOutputChannel: traceOutputChannel,
  };

  client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
  outputChannel.appendLine('start LSP client')
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

function getLspServerOptions(useInoxBinary: boolean): ServerOptions {
  if(useInoxBinary) {
    outputChannel.appendLine('use inox binary')
    return {
      command: 'inox',
      args: ['lsp'],
    };
  }

  outputChannel.appendLine('use websocket')
  return connectToWebsocketServer(outputChannel)
}


export function connectToWebsocketServer(outputChannel: vscode.OutputChannel): () => Promise<MessageTransports> {
  return async () => {
    outputChannel.appendLine('create websocket')

    const webSocket = new _Websocket('wss://localhost:8888', {
      rejectUnauthorized: false,
    }) as any as WebSocket;

    webSocket.onerror = ev => {
      outputChannel.appendLine(inspect(ev))
    }

    return new Promise((resolve, reject) => {
      let ok = false
      setTimeout(() => {
        if(!ok) {
          outputChannel.appendLine('timeout')
        }
        reject()
      }, 1000)

      webSocket.onopen = () => {
        ok = true
        outputChannel.appendLine('websocket connected')
        const socket = toSocket(webSocket);
        const reader = new WebSocketMessageReader(socket);
        const writer = new WebSocketMessageWriter(socket);
        resolve({
          reader,
          writer,
        })
        traceOutputChannel.appendLine('after resolve')
      }
    })
  }

}
