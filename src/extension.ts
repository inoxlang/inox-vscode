import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, MessageTransports, RevealOutputChannelOn } from 'vscode-languageclient/node';
import { listen, WebSocketMessageReader, WebSocketMessageWriter, toSocket, ConsoleLogger } from './vscode-ws-jsonrpc/src/index'

import { WebSocket as _Websocket } from 'ws';
import { inspect } from 'util';

let client: LanguageClient;
let outputChannel: vscode.OutputChannel;
let traceOutputChannel: vscode.OutputChannel;

const USE_INOX_BINARY_CONFIG_ENTRY = 'useInoxBinary'
const WS_ENDPOINT_CONFIG_ENTRY = 'websocketEndpoint'

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');
  traceOutputChannel = vscode.window.createOutputChannel('Inox Extension (Trace)');

  // read & check user settings
  const config = vscode.workspace.getConfiguration('inox')
  const useInoxBinary = config.get(USE_INOX_BINARY_CONFIG_ENTRY) === true
  const websocketEndpoint = config.get(WS_ENDPOINT_CONFIG_ENTRY)

  if(typeof websocketEndpoint != 'string'){
    let msg: string
    if(!config.has(WS_ENDPOINT_CONFIG_ENTRY)){
      msg = WS_ENDPOINT_CONFIG_ENTRY + ' not found in the extension\'s configuration'
    } else {
      msg = WS_ENDPOINT_CONFIG_ENTRY + '  provided in the extension\'s configuration is not a string, value is: ' + inspect(websocketEndpoint)
    }

    outputChannel.appendLine(msg)
    vscode.window.showErrorMessage(msg)
    return
  } else {
    let errorMessage: string|undefined

    try {
      const url = new URL(websocketEndpoint)
      if(url.protocol != 'wss:'){
        errorMessage = WS_ENDPOINT_CONFIG_ENTRY + ' provided in the extension\'s configuration should have a [wss://] scheme, value is: ' + websocketEndpoint
      }
    } catch(err){
      errorMessage = WS_ENDPOINT_CONFIG_ENTRY + ' provided in the extension\'s configuration is not a valid URL, value is: ' + websocketEndpoint
    }

    if(errorMessage){
      outputChannel.appendLine(errorMessage)
      vscode.window.showErrorMessage(errorMessage)
      return
    }
  }

  //set server & client options

  const serverOptions = getLspServerOptions(useInoxBinary, websocketEndpoint)

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'inox' }],
    synchronize: {
      configurationSection: 'Inox',
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
    },
    outputChannel: outputChannel,
    traceOutputChannel: traceOutputChannel,
  };
  
  //create LSP client

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

function getLspServerOptions(useInoxBinary: boolean, websocketEndpoint: string): ServerOptions {
  if (useInoxBinary) {
    outputChannel.appendLine('use inox binary')
    return {
      command: 'inox',
      args: ['lsp'],
    };
  }

  outputChannel.appendLine('use websocket')
  return connectToWebsocketServer(outputChannel, websocketEndpoint)
}


export function connectToWebsocketServer(outputChannel: vscode.OutputChannel, websocketEndpoint: string): () => Promise<MessageTransports> {
  return async () => {
    outputChannel.appendLine('create websocket')

    const webSocket = new _Websocket(websocketEndpoint, {
      rejectUnauthorized: false,
    }) as any as WebSocket;

    webSocket.onerror = ev => {
      outputChannel.appendLine(inspect(ev))
    }

    return new Promise((resolve, reject) => {
      let ok = false
      setTimeout(() => {
        if (!ok) {
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
