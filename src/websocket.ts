import { inspect } from 'util';
import { MessageTransports } from 'vscode-languageclient/node';
import { WebSocket as _Websocket } from 'ws';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from './vscode-ws-jsonrpc/src/index';
import { InoxExtensionContext } from './inox-extension-context';

const PING_INTERVAL_MILLIS = 5000;

let nextId = 0

export function connectToWebsocketServer(ctx: InoxExtensionContext): () => Promise<MessageTransports> {
    return async () => {
        const websocketId = nextId++

        ctx.outputChannel.appendLine(`create websocket (id ${websocketId})`)

        const endpoint = ctx.config.websocketEndpoint
        const webSocket = new _Websocket(endpoint, {
            rejectUnauthorized: false,
        })

        webSocket.onerror = ev => {
            ctx.outputChannel.appendLine(inspect(ev))
        }

        return new Promise((resolve, reject) => {
            let ok = false
            let closed = false

            //reject after timeout.
            setTimeout(() => {
                if (!ok) {
                    ctx.outputChannel.appendLine('timeout')
                }
                reject()
            }, 1000)

            webSocket.addEventListener('close', function(){
                closed = true
                ctx.debugOutputChannel.appendLine(`websocket with id ${websocketId} is now closed`)
            })

            webSocket.addEventListener("open", function () {
                ctx.outputChannel.appendLine(`websocket connected (id:${websocketId})`)
                ok = true

                //send ping periodically.
                let pingStart = new Date()
                {
                    const handle = setInterval(() => {
                        if(closed){
                            clearTimeout(handle)
                        }

                        pingStart = new Date()
                        ctx.debugOutputChannel.appendLine(`ping LSP server (websocket id ${websocketId})`)
                        webSocket.ping()
                    }, PING_INTERVAL_MILLIS)
                }
              
                //log pongs.
                webSocket.on('pong', () => {
                    let pingEnd = new Date()
                    ctx.debugOutputChannel.appendLine(
                        'LSP server sent a pong, time since ping: ' +
                        (pingEnd.getTime() - pingStart.getTime()) +
                        ` milliseconds (websocket id ${websocketId})`
                    )
                })
                
                //create an object implementing MessageTransports and "return" it.
                const socket = toSocket(webSocket as any);
                const reader = new WebSocketMessageReader(socket);
                const writer = new WebSocketMessageWriter(socket);
                resolve({
                    reader,
                    writer,
                })
                ctx.debugOutputChannel.appendLine('after resolve')
            })

        })
    }

}
