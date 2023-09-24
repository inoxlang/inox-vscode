import * as vscode from 'vscode';
import { ApplyWorkspaceEditParams, LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient, ServerOptions, Range } from "vscode-languageclient/node";
import { InoxExtensionContext } from "./inox-extension-context";
import { INOX_FS_SCHEME } from "./inox-fs";
import { connectToWebsocketServer as createConnectToWebsocketServer, isWebsocketServerRunning } from "./websocket";
import child_process from 'child_process'
import { sleep } from './utils';
import { LOCAL_PROJECT_SERVER_COMMAND_ENTRY } from './configuration';

export const LSP_CLIENT_STOP_TIMEOUT_MILLIS = 2000

const LSP_SERVER_START_CHECK_INTERVAL_MILLIS = 500
const LSP_SERVER_START_CHECK_COUNT = 10
const LOCAL_LSP_SERVER_LOG_PREFIX = '[Local LSP server] '

function getLspServerOptions(ctx: InoxExtensionContext): ServerOptions {
  if(!ctx.config.websocketEndpoint){
    vscode.window.showErrorMessage('inox extension: no websocket endpoint specified')
    throw new Error('abort')
  } else {
    ctx.outputChannel.appendLine('use websocket')
    return createConnectToWebsocketServer(ctx)
  }
}

export async function startLocalProjectServerIfNecessary(ctx: InoxExtensionContext): Promise<boolean> {
  //if there is no websocket endpoint nor a command to start a local project server we do nothing
  if(ctx.config.websocketEndpoint == undefined){
    return true
  }

  let isRunning = await isWebsocketServerRunning(ctx, ctx.config.websocketEndpoint)
  if(isRunning){
    ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'Local server is running')
    return true
  }

  const command = ctx.config.localProjectServerCommand
  if(command.length == 0) {
    vscode.window.showWarningMessage(
      `No Inox LSP server is running on ${ctx.config.websocketEndpoint} and the setting ${LOCAL_PROJECT_SERVER_COMMAND_ENTRY} is not set.` +
      ` Either set the command to start a local Inox LSP server or manually start a server on ${ctx.config.websocketEndpoint}.`
    )
    return false
  }

  const msg = LOCAL_LSP_SERVER_LOG_PREFIX + 'LSP server is not running, execute command to start local server: ' + command.join(' ')
  ctx.outputChannel.appendLine(msg)
  ctx.debugChannel.appendLine(msg)

  const child = child_process.spawn(command[0], command.slice(1), {
    env: {
      ...process.env,
      ...ctx.config.localProjectServerEnv
    }
  })

  child.on('error', (err) => {
    const msg = LOCAL_LSP_SERVER_LOG_PREFIX + String(err)
    ctx.outputChannel.appendLine(msg)
    ctx.debugChannel.appendLine(msg)
    vscode.window.showErrorMessage(msg)
  })
 
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', data => {
    ctx.debugChannel.appendLine(
      LOCAL_LSP_SERVER_LOG_PREFIX + "\n-----------------\n" + 
      data.toString() +
      "-----------------\n")
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', data => {
    ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + data.toString())
  })

  //check if the websocket server is running
  for(let i = 0; i < LSP_SERVER_START_CHECK_COUNT; i++){
    await sleep(LSP_SERVER_START_CHECK_INTERVAL_MILLIS)

    if(child.exitCode != null){
      break
    }

    isRunning = await isWebsocketServerRunning(ctx, ctx.config.websocketEndpoint)
    if(isRunning){
      const msg = LOCAL_LSP_SERVER_LOG_PREFIX + 'local LSP server is running'
      ctx.outputChannel.appendLine(msg)
      ctx.debugChannel.appendLine(msg)
      return true
    }
  }

  //if process still running
  if(child.exitCode === null){
    const msg = LOCAL_LSP_SERVER_LOG_PREFIX + 'LSP server is still not running, kill child process'
    ctx.outputChannel.appendLine(msg)
    ctx.debugChannel.appendLine(msg)

    let killed = child.kill()
    if(!killed){
      killed = child.kill('SIGKILL')
    }

    if(killed){
      ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'child process killed')
    } else {
      ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'failed to kill child process')
    }
  } else {
    ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'child process exit code: ' + child.exitCode)
  }
 
  return false
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
  client.onRequest('cursor/setPosition', (params: Range) => {
    const editor = vscode.window.activeTextEditor;
    if(!editor) {
      return
    }
    const newCursorPosition = new vscode.Position(params.start.line, params.start.character)
    const newSelection = new vscode.Selection(newCursorPosition, newCursorPosition);
    editor.selections = [newSelection]
  })
  return client
}

