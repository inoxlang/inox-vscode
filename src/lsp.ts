import child_process from 'child_process';
import * as vscode from 'vscode';
import { CloseAction, CloseHandlerResult, ErrorAction, LanguageClientOptions, State, ConnectionError } from "vscode-languageclient";
import { ErrorHandlerResult, LanguageClient, Range, ServerOptions } from "vscode-languageclient/node";
import { InoxExtensionContext } from "./inox-extension-context";
import { INOX_FS_SCHEME } from "./inoxfs/mod";
import { sleep } from './utils';
import { connectToWebsocketServer as createConnectToWebsocketServer, isWebsocketServerRunning } from "./websocket";
import { openProject } from './project/mod';
import { fmtFailedToConnectToLSPServer } from './errors';
import { getEmbeddedBlockVirtualContent, isInsideEmbeddedRegion } from './embedded-support';
import { getLanguageService } from 'vscode-html-languageservice';
export const LSP_CLIENT_STOP_TIMEOUT_MILLIS = 2000

const htmlLanguageService = getLanguageService();

const LSP_SERVER_START_CHECK_INTERVAL_MILLIS = 500
const LSP_SERVER_START_CHECK_COUNT = 10
const LOCAL_LSP_SERVER_LOG_PREFIX = '[Local LSP server] '
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

export async function checkConnAndStartLocalProjectServerIfPossible(ctx: InoxExtensionContext): Promise<boolean> {
  //if there is no websocket endpoint nor a command to start a local project server we do nothing
  if (ctx.config.websocketEndpoint == undefined) {
    return true
  }

  let isRunning = await isWebsocketServerRunning(ctx, ctx.config.websocketEndpoint)
  if (isRunning) {
    ctx.debugChannel.appendLine(LOCAL_LSP_SERVER_LOG_PREFIX + 'Local server is running')
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
  for (let i = 0; i < LSP_SERVER_START_CHECK_COUNT; i++) {
    await sleep(LSP_SERVER_START_CHECK_INTERVAL_MILLIS)

    if (child.exitCode != null) {
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
      provideCompletionItem: async (document, position, context, token, next) => {
        const docText = document.getText()
        const offsetAtPosition = document.offsetAt(position)

        const inCSS = isInsideEmbeddedRegion(htmlLanguageService, docText, offsetAtPosition, 'css')
        const inJS = isInsideEmbeddedRegion(htmlLanguageService, docText, offsetAtPosition, 'js')

        //if not in CSS or JS do no forward request forwarding
        if (!inCSS && !inJS) {
          return await next(document, position, context, token);
        }

        const lang = inCSS ? 'css' : 'js'

        const originalUri = document.uri.toString(true);
        ctx.virtualDocumentContents.set(originalUri, getEmbeddedBlockVirtualContent(htmlLanguageService, docText, lang));

        const vdocUriString = `embedded-content://${lang}/${encodeURIComponent(
          originalUri
        )}.${lang}`;

        const vdocUri = vscode.Uri.parse(vdocUriString);
        return await vscode.commands.executeCommand<vscode.CompletionList>(
          'vscode.executeCompletionItemProvider',
          vdocUri,
          position,
          context.triggerCharacter
        );
      }
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



export function createEmbeddedContentProvider(ctx: InoxExtensionContext): vscode.TextDocumentContentProvider {
  return {
    provideTextDocumentContent: uri => {
      const originalUri = uri.path.slice(1).slice(0, -4);
      const decodedUri = decodeURIComponent(originalUri);
      return ctx.virtualDocumentContents.get(decodedUri);
    }
  }
}