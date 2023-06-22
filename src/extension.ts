import * as vscode from 'vscode';

import { getConfiguration } from './configuration';
import { InoxExtensionContext } from './inox-extension-context';
import { createAndRegisterInoxFs } from './inox-fs';
import { createLSPClient } from './lsp';
import { initializeNewProject, openProject } from './project';

let outputChannel: vscode.OutputChannel;
let debugChannel: vscode.OutputChannel;
let traceChannel: vscode.OutputChannel;


export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');
  outputChannel.appendLine('Inox extension activate()')

  debugChannel = vscode.window.createOutputChannel('Inox Extension (Debug)');
  traceChannel = vscode.window.createOutputChannel('Inox Extension (Trace)');

  const config = await getConfiguration(outputChannel)
  if (!config) {
    return
  }

  const isVirtualWorkspace =
    vscode.workspace.workspaceFolders != undefined &&
    vscode.workspace.workspaceFolders.every(f => f.uri.scheme !== 'file');

  if(isVirtualWorkspace){
    vscode.window.showErrorMessage('virtual workspaces not supported yet')
    return
  }

  const ctx = new InoxExtensionContext({
    base: context,
    initialConfig: config,
    virtualWorkspace: isVirtualWorkspace,
    outputChannel: outputChannel,
    debugChannel: debugChannel,
    traceChannel: traceChannel,

    getCurrentConfig: getConfiguration,
    createLSPClient: createLSPClient,
  })

  if (config.project) {
    ctx.inoxFS = createAndRegisterInoxFs(ctx)
  }

  ctx.restartLSPClient(false).then(() => {
    if(ctx.config.project?.id){
      openProject(ctx)
    }
  })

  vscode.commands.registerCommand('lsp/restart', async () => {
    await ctx.updateConfiguration()
    return ctx.restartLSPClient(false)
  })

  vscode.commands.registerCommand('project/initialize', async () => {
    debugChannel.appendLine('restart LSP client in project mode')
    await ctx.updateConfiguration()
    await ctx.restartLSPClient(true) //restart LSP client in project mode
    await initializeNewProject(ctx)
  })

}

export function deactivate(): Thenable<void> | undefined {
  return
}

