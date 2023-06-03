import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

import { getConfiguration } from './configuration';
import { InoxExtensionContext } from './inox-extension-context';
import { INOX_FS_SCHEME, InoxFS, createAndRegisterInoxFs } from './inox-fs';
import { createLSPClient, needsToRecreateLspClient } from './lsp';

let client: LanguageClient;
let outputChannel: vscode.OutputChannel;
let debugOutputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');
  debugOutputChannel = vscode.window.createOutputChannel('Inox Extension (Debug)');
  outputChannel.appendLine('Inox extension activate()')

  const config = await getConfiguration(outputChannel)
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

  if(config.project){
    ctx.inoxFS = createAndRegisterInoxFs(ctx)
  }

  ctx.restartLSPClient()

  vscode.commands.registerCommand('lsp/restart', async () => {
    await ctx.updateConfiguration()
    return ctx.restartLSPClient()
  })

}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

