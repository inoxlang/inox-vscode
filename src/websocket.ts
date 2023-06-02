import { inspect } from 'util';
import * as vscode from 'vscode';
import { MessageTransports } from 'vscode-languageclient/node';
import { WebSocket as _Websocket } from 'ws';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from './vscode-ws-jsonrpc/src/index';

const PING_INTERVAL_MILLIS = 5000; 

export function connectToWebsocketServer(outputChannel: vscode.OutputChannel, traceOutputChannel: vscode.OutputChannel, websocketEndpoint: string): () => Promise<MessageTransports> {
    return async () => {
        outputChannel.appendLine('create websocket')

        const libWebSocket = new _Websocket(websocketEndpoint, {
            rejectUnauthorized: false,
        }) 

        const websocket = libWebSocket as any as WebSocket;

        libWebSocket.onerror = ev => {
            outputChannel.appendLine(inspect(ev))
        }

        return new Promise((resolve, reject) => {
            let ok = false
            setTimeout(() => {
                if (!ok) {
                    outputChannel.appendLine('timeout')
                }
                reject()
            }, 1000)

            libWebSocket.onopen = function() {
                let pingStart = new Date()
                setInterval(() => {
                    pingStart = new Date()
                    traceOutputChannel.appendLine('ping LSP server')
                    libWebSocket.ping()
                }, PING_INTERVAL_MILLIS)

                libWebSocket.on('pong', () => {
                    let pingEnd = new Date()
                    traceOutputChannel.appendLine('LSP server sent a pong, time since ping: ' + (pingEnd.getTime() - pingStart.getTime()) + ' milliseconds')
                })

                ok = true
                outputChannel.appendLine('websocket connected')
                const socket = toSocket(websocket);
                const reader = new WebSocketMessageReader(socket);
                const writer = new WebSocketMessageWriter(socket);
                resolve({
                    reader,
                    writer,
                })
                traceOutputChannel.appendLine('after resolve')
            }

        })
    }

}
