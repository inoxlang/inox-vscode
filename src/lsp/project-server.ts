import child_process from 'child_process';
import * as vscode from 'vscode';
import { ServerOptions } from "vscode-languageclient/node";
import { connectToWebsocketServer as createConnectToWebsocketServer } from "../websocket";

import { fmtFailedToConnectToLSPServer } from '../errors';
import { InoxExtensionContext } from "../inox-extension-context";
import { sleep } from '../utils';
import { isWebsocketServerRunning } from "../websocket";

const LOCAL_LSP_SERVER_LOG_PREFIX = '[Local LSP server] '
const LOCAL_SERVER_START_CHECK_INTERVAL_MILLIS = 500
const LOCAL_SERVER_START_CHECK_COUNT = 10
export const MAX_WAIT_LOCAL_SERVER_DURATION_MILLIS = LOCAL_SERVER_START_CHECK_COUNT * LOCAL_SERVER_START_CHECK_INTERVAL_MILLIS


export function getLspServerOptions(ctx: InoxExtensionContext): ServerOptions {
  if (!ctx.config.websocketEndpoint) {
    vscode.window.showErrorMessage('inox extension: no websocket endpoint specified')
    throw new Error('abort')
  } else {
    ctx.outputChannel.appendLine('use websocket')
    return createConnectToWebsocketServer(ctx)
  }
}

export async function checkConnAndStartLocalProjectServerIfPossible(ctx: InoxExtensionContext): Promise<boolean> {
    //if there is no websocket endpoint nor a command to start a local project server we do nothing.
    if (ctx.config.websocketEndpoint == undefined) {
      return true
    }
  
    let isRunning = await isWebsocketServerRunning(ctx, ctx.config.websocketEndpoint)
    if (isRunning) {
      ctx.debugChannel.appendLine('LSP server is running')
      return true
    }
  
    const command = ctx.config.localProjectServerCommand
    if (command.length == 0 || process.platform != 'linux') {
      vscode.window.showErrorMessage(fmtFailedToConnectToLSPServer(ctx))
      return false
    }
  
    const msg = LOCAL_LSP_SERVER_LOG_PREFIX + 'LSP server is not running, executing command to start local server: ' + command.join(' ')
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
    for (let i = 0; i < LOCAL_SERVER_START_CHECK_COUNT; i++) {
      await sleep(LOCAL_SERVER_START_CHECK_INTERVAL_MILLIS)
  
      if (i == Math.ceil(LOCAL_SERVER_START_CHECK_COUNT/2)) {
          vscode.window.showInformationMessage("The local LSP server seems slow to start.")
      }

      if (child.exitCode != null) {
        vscode.window.showWarningMessage("The local LSP server process has exited unexpectedly.")
        break
      }
  
      isRunning = await isWebsocketServerRunning(ctx, ctx.config.websocketEndpoint)
      if (isRunning) {
        const msg = LOCAL_LSP_SERVER_LOG_PREFIX + 'local LSP server is running'
        ctx.outputChannel.appendLine(msg)
        ctx.debugChannel.appendLine(msg)
        return true
      }
    }
  
    //if process still running
    if (child.exitCode === null) {
      const msg = LOCAL_LSP_SERVER_LOG_PREFIX + 'LSP server is still not running, kill child process'
      ctx.outputChannel.appendLine(msg)
      ctx.debugChannel.appendLine(msg)
  
      let killed = child.kill()
      if (!killed) {
        killed = child.kill('SIGKILL')
      }
  
      if (killed) {
        ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'child process killed')
      } else {
        ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'failed to kill child process')
      }
    } else {
      ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'child process exit code: ' + child.exitCode)
    }
  
    return false
  }
  




export function createEmbeddedContentProvider(ctx: InoxExtensionContext): vscode.TextDocumentContentProvider {
  return {
    provideTextDocumentContent: uri => {
      const originalUri = uri.path.slice(1).slice(0, -4);
      const decodedUri = decodeURIComponent(originalUri);
      return ctx.virtualDocumentContents.get(decodedUri);
    }
  }
}