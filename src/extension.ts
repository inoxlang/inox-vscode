import * as vscode from 'vscode';

import { getConfiguration } from './configuration';
import { InoxExtensionContext } from './inox-extension-context';
import { createAndRegisterInoxFs } from './inox-fs';
import { createLSPClient, startLocalProjectServerIfNecessary } from './lsp';
import { initializeNewProject, openProject } from './project';
import { sleep } from './utils';
import { InlineDebugAdapterFactory } from './debug';

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
    startLocalProjectServerIfNecessary: startLocalProjectServerIfNecessary,
    openProject: openProject
  })

  if (config.project) {
    ctx.inoxFS = createAndRegisterInoxFs(ctx)
  }

  ctx.restartLSPClient(false)


  //register debug adapter

  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('inox', new InlineDebugAdapterFactory()));

  //register commands

  vscode.commands.registerCommand('lsp/restart', async () => {
    await ctx.updateConfiguration()
    return ctx.restartLSPClient(false)
  })

  vscode.commands.registerCommand('project/initialize', async () => {
    await ctx.updateConfiguration()

    if(ctx.config.projectFilePresent){
      const msg = '[project/initialize] project is already initialized'
      vscode.window.showWarningMessage(msg)
      ctx.debugChannel.appendLine(msg)
      return
    }

    debugChannel.appendLine('[project/initialize] restart LSP client in project mode')
    await ctx.restartLSPClient(true) //restart LSP client in project mode

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        cancellable: false,
        title: 'Creating Inox project in current folder'
    }, async (progress) => {
        progress.report({  increment: 0 });

        //wait for LSP client
        await sleep(3000) //TODO: replace sleep

        await initializeNewProject(ctx)
    
        progress.report({ increment: 100 });
    });
  })

}

export function deactivate(): Thenable<void> | undefined {
  return
}

