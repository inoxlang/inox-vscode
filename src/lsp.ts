import * as vscode from 'vscode';
import { LanguageClientOptions, MessageTransports } from "vscode-languageclient";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import { Configuration } from "./configuration";
import { InoxExtensionContext } from "./inox-extension-context";
import { INOX_FS_SCHEME } from "./inox-fs";
import { connectToWebsocketServer as createConnectToWebsocketServer } from "./websocket";


export const LSP_CLIENT_STOP_TIMEOUT_MILLIS = 2000

function getLspServerOptions(ctx: InoxExtensionContext): ServerOptions {
  if(!ctx.config.websocketEndpoint){
    vscode.window.showErrorMessage('inox extension: no websocket endpoint specified')
    throw new Error('abort')
  } else {
    ctx.outputChannel.appendLine('use websocket')
    return createConnectToWebsocketServer(ctx)
  }
}

export function createLSPClient(ctx: InoxExtensionContext, forceProjetMode: boolean) {
  const serverOptions = getLspServerOptions(ctx)

  let documentScheme = INOX_FS_SCHEME
  if (!forceProjetMode && !ctx.config.project) {
    documentScheme = 'file'
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: documentScheme, language: 'inox' }],
    synchronize: {
      configurationSection: 'Inox',
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
    },
    outputChannel: ctx.outputChannel,
    traceOutputChannel: ctx.debugChannel,
  };

  const client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
  return client
}

