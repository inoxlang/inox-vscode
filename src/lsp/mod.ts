import * as vscode from 'vscode';
import { CloseAction, ErrorAction, LanguageClientOptions, State } from "vscode-languageclient";
import { LanguageClient, Range, ServerOptions } from "vscode-languageclient/node";
import { InoxExtensionContext } from "../inox-extension-context";
import { INOX_FS_SCHEME } from "../inoxfs/mod";
import { openProject } from '../project/mod';
import { sleep } from '../utils';
import { connectToWebsocketServer as createConnectToWebsocketServer } from "../websocket";
import { makeProvideCompletionItemFn } from './completion-middleware';

export { checkConnAndStartLocalProjectServerIfPossible } from './project-server';

export const LSP_CLIENT_STOP_TIMEOUT_MILLIS = 2000

const LSP_CLIENT_LOG_PREFIX = '[LSP client] '


function getLspServerOptions(ctx: InoxExtensionContext): ServerOptions {
  if (!ctx.config.websocketEndpoint) {
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

  let client: LanguageClient
  let lastCloseTimes = [0, 0]


  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: documentScheme, language: 'inox', pattern: '**/*.ix' }],
    synchronize: {
      configurationSection: 'Inox',
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
    },
    outputChannel: ctx.outputChannel,
    traceOutputChannel: ctx.debugChannel,
    middleware: {
      provideCompletionItem: makeProvideCompletionItemFn(ctx)
    },
    errorHandler: {
      error(error, message, count) {
        ctx.debugChannel.appendLine(LSP_CLIENT_LOG_PREFIX + error)
        return {
          action: ErrorAction.Continue,
          handled: false
        }
      },
      async closed() {
        const now = Date.now()

        if (lastCloseTimes.every(time => (now - time) < 10_000)) {
          ctx.debugChannel.appendLine(LSP_CLIENT_LOG_PREFIX + 'connection was closed too many times')
          return {
            action: CloseAction.DoNotRestart,
            handled: false,
          }
        }

        await sleep(500)

        // [T1, T2] --> [T2, now]
        lastCloseTimes.shift()
        lastCloseTimes.push(now)

        return {
          action: CloseAction.Restart,
          handled: true,
          message: 'restart LSP client'
        }
      }
    }
  };

  client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
  client.onRequest('cursor/setPosition', (params: Range) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return
    }
    const newCursorPosition = new vscode.Position(params.start.line, params.start.character)
    const newSelection = new vscode.Selection(newCursorPosition, newCursorPosition);
    editor.selections = [newSelection]
  })

  const disposable = client.onDidChangeState(async e => {
    //dispose the listener if client is not the current LSP client
    if (ctx.lspClient !== undefined && ctx.lspClient !== client) {
      disposable.dispose()
      return
    }

    if (e.newState == State.Running) {
      ctx.debugChannel.appendLine(LSP_CLIENT_LOG_PREFIX + ' client is now running')

      if(ctx.config.project && ctx.config.inVirtualWorkspace) {
        ctx.debugChannel.appendLine(LSP_CLIENT_LOG_PREFIX + ' open project')
        openProject(ctx)
      }

      return
    }

    if (e.newState != State.Stopped) {
      return
    }

    // try to restart several times if the client is still not running one second after
    let trials = 5
    let delay = 1000

    let handle: NodeJS.Timeout

    const retry = () => {
      ctx.debugChannel.appendLine(LSP_CLIENT_LOG_PREFIX + ' restart - decision not made by LSP client itself')
      clearInterval(handle)

      if (trials <= 0 || ctx.lspClient != client || client.isRunning()) {
        return
      }

      trials--
      delay += 1000
      ctx.restartLSPClient(ctx.config.project !== undefined)
      handle = setTimeout(retry, delay)
    }

    handle = setTimeout(retry, delay)
  })

  return client
}


