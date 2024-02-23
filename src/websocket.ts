import * as vscode from 'vscode';
import { inspect } from 'util';
import { MessageTransports } from 'vscode-languageclient/node';
import { WebSocket as _Websocket, ClientOptions } from 'ws';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from './vscode-ws-jsonrpc/src/index';
import { InoxExtensionContext } from './inox-extension-context';
import { URL } from 'url';
import { isIP } from 'net';
import { join as joinPosix } from 'path/posix';
import { sleep } from './utils';

const PING_INTERVAL_MILLIS = 15_000;
const WEBSOCKET_SERVER_CHECK_TIMEOUT = 2000
const WEBSOCKET_LOG_PREFIX = "[Web Socket] "

let nextId = 0

export function isWebsocketServerRunning(ctx: InoxExtensionContext, endpoint: URL) {
    return new Promise<boolean>((resolve, reject) => {
        //reject after timeout.
        setTimeout(() => {
            resolve(false)
            webSocket.close()
        }, WEBSOCKET_SERVER_CHECK_TIMEOUT)


        const webSocket = new _Websocket(endpoint, getWebsocketOptions(endpoint))
        webSocket.addEventListener('error', async ev => {
            webSocket.close()
            await sleep(200) //Make sure the WebSocket is closed.

            ctx.debugChannel.appendLine(WEBSOCKET_LOG_PREFIX + ev.message)
            resolve(false)
        })

        webSocket.addEventListener('close', () => {
            ctx.debugChannel.appendLine(WEBSOCKET_LOG_PREFIX + `temporary websocket is now closed`)
        })

        webSocket.addEventListener('open', ev => {
            webSocket.addEventListener('message', async () => {
                webSocket.close()
                await sleep(200) //Make sure the WebSocket is closed.

                resolve(true)
            })

            //Send a message to make the server sends a response with an 'MethodNotFound' error.
            webSocket.send('{}') 
        })
    })
}

export function connectToWebsocketServer(ctx: InoxExtensionContext, opts?: { appendPath: string }): () => Promise<MessageTransports> {

    let current: _Websocket|undefined;

    return async () => {
        if(current != undefined){
            current.close()

            //Wait for the previous connection to be closed.
            for(let i = 0; i < 10; i++){
                await sleep(50)
                if(current == undefined){
                    break
                }
            }

            if(current != undefined){
                //Almost impossible
                throw new Error('Failed to stop WebSocket of previous LSP session')
            }
        }

        const websocketId = nextId++

        ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `create websocket (id ${websocketId})`)

        let endpoint = ctx.config.websocketEndpoint
        if (!endpoint) {
            ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `no websocket endpoint set`)
            throw new Error(`no websocket endpoint set`)
        }

        if (opts?.appendPath) {
            endpoint.pathname = joinPosix(endpoint.pathname, opts.appendPath)
        }

        ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `endpoint is ${endpoint.toString()}`)

        const webSocket = new _Websocket(endpoint, getWebsocketOptions(endpoint))
        current = webSocket

        webSocket.onerror = ev => {
            ctx.outputChannel.appendLine(inspect(ev))
        }

        return new Promise((resolve, reject) => {
            let ok = false
            let closed = { val: false }

            //reject after timeout.
            setTimeout(() => {
                if (!ok) {
                    ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + 'timeout')
                }
                reject()
            }, 1000)

            webSocket.addEventListener('close', function () {
                closed.val = true
                current = undefined
                ctx.debugChannel.appendLine(WEBSOCKET_LOG_PREFIX + `websocket with id ${websocketId} is now closed`)
            })

            webSocket.addEventListener("open", function () {
                ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `websocket connected (id:${websocketId})`)
                ok = true

                sendPingPeriodically(ctx, webSocket, websocketId, closed)

                //create an object implementing MessageTransports and "return" it.
                const socket = toSocket(webSocket as any);
                const reader = new WebSocketMessageReader(socket);
                const writer = new WebSocketMessageWriter(socket);
                resolve({
                    reader,
                    writer,
                })
                ctx.debugChannel.appendLine(WEBSOCKET_LOG_PREFIX + 'after resolve message transports')
            })

        })
    }

}


function sendPingPeriodically(ctx: InoxExtensionContext, webSocket: _Websocket, websocketId: number, closed: { val: boolean }) {
    //send ping periodically.
    let pingStart = new Date()
    {
        const handle = setInterval(() => {
            if (closed.val) {
                clearTimeout(handle)
            }

            pingStart = new Date()
            ctx.debugChannel.appendLine(WEBSOCKET_LOG_PREFIX + `ping LSP server (websocket id ${websocketId})`)
            webSocket.ping()
        }, PING_INTERVAL_MILLIS)
    }

    //log pongs.
    webSocket.on('pong', () => {
        let pingEnd = new Date()
        ctx.debugChannel.appendLine(
            WEBSOCKET_LOG_PREFIX + 'LSP server sent a pong, time since ping: ' +
            (pingEnd.getTime() - pingStart.getTime()) +
            ` milliseconds (websocket id ${websocketId})`
        )
    })
}

export function getWebsocketOptions(endpoint: URL): ClientOptions {
    //ignore certificate errors for localhost and IP addresses
    const reject = (endpoint.hostname != "localhost") && !isIP(endpoint.hostname)

    return {
        rejectUnauthorized: reject
    }
}