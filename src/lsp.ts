import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import * as vscode from 'vscode';
import { INOX_FS_SCHEME } from "./inox-fs";
import { InoxExtensionContext } from "./inox-extension-context";
import { connectToWebsocketServer } from "./websocket";
import { Configuration } from "./configuration";

export const LSP_CLIENT_STOP_TIMEOUT_MILLIS = 2000

export function needsToRecreateLspClient(ctx: InoxExtensionContext, previousConfig: Configuration): boolean {
  if ((ctx.config.project === undefined) != (previousConfig.project === undefined)) {
    return true
  }
  return false
}

function getLspServerOptions(ctx: InoxExtensionContext): ServerOptions {
  if (!ctx.config.project) {
    ctx.outputChannel.appendLine(' inox binary')
    return {
      command: 'inox',
      args: ['lsp'],
    };
  }

  ctx.outputChannel.appendLine('project mode: use websocket')
  return connectToWebsocketServer(ctx)
}

export function createLSPClient(ctx: InoxExtensionContext) {
  const serverOptions = getLspServerOptions(ctx)

  let documentScheme = INOX_FS_SCHEME
  if (!ctx.config.project) {
    documentScheme = 'file'
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: documentScheme, language: 'inox' }],
    synchronize: {
      configurationSection: 'Inox',
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
    },
    outputChannel: ctx.outputChannel,
    traceOutputChannel: ctx.debugOutputChannel,
  };

  const client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
  return client
}