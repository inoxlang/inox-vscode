import { inspect } from 'util';
import * as vscode from 'vscode';
import { MessageTransports } from 'vscode-languageclient/node';
import { WebSocket as _Websocket } from 'ws';
import { WebSocketMessageReader, WebSocketMessageWriter, toSocket } from './vscode-ws-jsonrpc/src/index';

export function connectToWebsocketServer(outputChannel: vscode.OutputChannel, traceOutputChannel: vscode.OutputChannel, websocketEndpoint: string): () => Promise<MessageTransports> {
    return async () => {
        outputChannel.appendLine('create websocket')

        const webSocket = new _Websocket(websocketEndpoint, {
            rejectUnauthorized: false,
        }) as any as WebSocket;

        webSocket.onerror = ev => {
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

            webSocket.onopen = () => {
                ok = true
                outputChannel.appendLine('websocket connected')
                const socket = toSocket(webSocket);
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
