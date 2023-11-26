import { inspect } from 'util';
import { MessageTransports } from 'vscode-languageclient/node';
import { WebSocket as _Websocket } from 'ws';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from './vscode-ws-jsonrpc/src/index';
import { InoxExtensionContext } from './inox-extension-context';
import { URL } from 'url';
import { join } from 'path';

const PING_INTERVAL_MILLIS = 5000;
const WEBSOCKET_SERVER_CHECK_TIMEOUT = 2000
const WEBSOCKET_LOG_PREFIX = "[Web Socket] "

let nextId = 0

export function isWebsocketServerRunning(ctx: InoxExtensionContext, endpoint: URL){
    return new Promise<boolean>((resolve, reject) => {
        //reject after timeout.
        setTimeout(() => {
            resolve(false)
            webSocket.close()
        }, WEBSOCKET_SERVER_CHECK_TIMEOUT)


        const webSocket = new _Websocket(endpoint, getWebsocketOptions(endpoint))
        webSocket.addEventListener('error', ev => {
            ctx.debugChannel.appendLine(WEBSOCKET_LOG_PREFIX + ev.message)
            resolve(false)
            webSocket.close()
        })
        webSocket.addEventListener('open', ev => {
            resolve(true)
            webSocket.close()
        })
    })
}

export function connectToWebsocketServer(ctx: InoxExtensionContext, opts?: {appendPath: string}): () => Promise<MessageTransports> {
    return async () => {
        const websocketId = nextId++

        ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `create websocket (id ${websocketId})`)

        let endpoint = ctx.config.websocketEndpoint
        if(!endpoint){
            ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `no websocket endpoint set`)
            throw new Error(`no websocket endpoint set`)
        }

        if(opts?.appendPath) {
            endpoint.pathname = join(endpoint.pathname, opts.appendPath)
        }

        ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + `endpoint is ${endpoint.toString()}`)

        const webSocket = new _Websocket(endpoint, getWebsocketOptions(endpoint))

        webSocket.onerror = ev => {
            ctx.outputChannel.appendLine(inspect(ev))
        }

        return new Promise((resolve, reject) => {
            let ok = false
            let closed = {val: false}

            //reject after timeout.
            setTimeout(() => {
                if (!ok) {
                    ctx.outputChannel.appendLine(WEBSOCKET_LOG_PREFIX + 'timeout')
                }
                reject()
            }, 1000)

            webSocket.addEventListener('close', function(){
                closed.val = true
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


function sendPingPeriodically(ctx: InoxExtensionContext, webSocket: _Websocket, websocketId: number, closed: {val: boolean}){
    //send ping periodically.
    let pingStart = new Date()
    {
        const handle = setInterval(() => {
            if(closed.val){
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

export function getWebsocketOptions(endpoint: URL){
    return {
        //ignore certificate errors for localhost / 127.0.0.1
        rejectUnauthorized: !(['localhost', '127.0.0.1'].includes(endpoint.hostname)),
    }
}