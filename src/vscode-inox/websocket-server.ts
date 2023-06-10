
import * as http from "http";
import * as net from "net";
import * as url from "url";
import ws from 'ws';


import { inspect } from 'util';
import { MessageWriter, NotificationMessage, RequestMessage, ResponseMessage, createMessageConnection } from "vscode-jsonrpc";
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from "../vscode-ws-jsonrpc/src/index";
import { PORT } from "./const";
import { printDebug } from "./debug";
import { InoxExports } from "./wasm";


const MAX_PAYLOAD_BYTES = 1_000_000

export class WebsocketLanguageServer {

  private closing = false
  private pendingRequests: Record<string, { 
    writer: MessageWriter, 
    method: string, 
    resolve: (result: unknown) => void,
    reject: (error: unknown) => void
  }> = {};

  private writer: MessageWriter | undefined;


  constructor(readonly wasm: InoxExports) { }

  start() {
    const websocketServer = new ws.Server({
      perMessageDeflate: false,
      port: PORT,
      maxPayload: MAX_PAYLOAD_BYTES
    });

    websocketServer.on('connection', (webSocket) => {
      if (this.writer) {
        printDebug("another connection is already alive")
        return
      }

      const socket: IWebSocket = {
        send: (content: any) => webSocket.send(content, (error: any) => {
          if (error) {
            throw error;
          }
        }),
        onMessage: (cb: any) => webSocket.on('message', cb),
        onError: (cb: any) => webSocket.on('error', cb),
        onClose: (cb: any) => webSocket.on('close', cb),
        dispose: () => webSocket.close()
      };

      // connect websocket to vscode-inox
      if (webSocket.readyState === webSocket.OPEN) {
        this.handleNewSocket(socket);
      } else {
        webSocket.on('open', () => {
          this.handleNewSocket(socket);
        });
      }
    })

    this.startReadOutputMessagesLoop()
  }

  handleNewSocket(socket: IWebSocket) {
    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);
    const connection = createMessageConnection(reader, writer, {
      error(msg) {
        printDebug('error', msg)
      },
      info(msg) {
        printDebug('info', msg)
      },
      log(msg) {
        printDebug('log', msg)
      },
      warn(msg) {
        printDebug('warn', msg)
      }
    });

    connection.onClose(() => {
      connection.dispose()
      if (this.writer == writer) {
        this.writer = undefined
      }
    });

    this.writer = writer

    //add handlers for requests & notifications

    connection.onRequest((method, params, token) => {
      printDebug("receive request from the client", method);

      const requestId = Math.random();

      const req = JSON.stringify({
        method: method,
        params: params,
        id: requestId,
      });

      this.wasm.write_lsp_message(req)

      //add request to pending requests
      const promise = new Promise((resolve, reject) => {
        token.onCancellationRequested(() => reject())

        setTimeout(() => reject(), 2000)

        this.pendingRequests[requestId] = {
          method: method,
          writer: writer,
          resolve,
          reject
        }
      });

      return promise;
    })

    connection.onNotification((method, params) => {
      printDebug("receive notifcation from the client", method);

      const req = JSON.stringify({
        method: method,
        params: params,
      });

      this.wasm.write_lsp_message(req)
    })

    connection.listen()
  }

  async startReadOutputMessagesLoop() {
    while (!this.closing) {
      let message: string;
      try {
        const result = this.wasm.read_lsp_message()
        if(result === null){
          await sleepMillis(50)
          continue
        }
        message = result
      } catch(err){
        printDebug(
          "error while calling read_lsp_message()",
          inspect(err),
        );
        continue
      }

      try {
        this.handleRPC(message);
      } catch (err) {
        printDebug(
          "error while parsing & handling JSON RPC request",
          inspect(err),
          "\nrequest:",
          message,
        );
      }

    }
  }

  handleRPC(message: string) {
    const arg = JSON.parse(message)
    if (typeof arg != "object" || arg === null) {
      printDebug("error", "invalid JSON, should be an object:", JSON.stringify(arg));
      return;
    }

    const json = arg as Record<string, unknown>

    if (("id" in json) && json.id !== undefined) { //requests have an id
      //request reponse
      if (("result" in json) || ("error" in json)) {
        const id = String(json.id);
        const pendingRequest = this.pendingRequests[id];
        if (pendingRequest === undefined) {
          printDebug("error", "get response for request of unknown id", id, message);
          return;
        }
        delete this.pendingRequests[id];

        const error = json.error;
        const result = json.result; //a null result is okay if error is not present or null

        if (error) {
          pendingRequest.reject(error)
        } else {
          pendingRequest.resolve(result)
        }

      } else { //request sent by the server

        if (!('method' in json) || (typeof json.method !== 'string')) {
          printDebug("error", "missing/invalid .method in request sent by server:", message);
          return
        }

        if (!('params' in json)) {
          printDebug("error", "missing .params in request sent by server:", message);
          return
        }

        printDebug("debug", "receive request from the server:", json.method);

        this.writer?.write(json as any as RequestMessage)
      }
    } else { //notification sent by the server

      if (!('method' in json) || (typeof json.method !== 'string')) {
        printDebug("error", "missing/invalid .method in notification sent by server:", message);
        return
      }

      if (!('params' in json)) {
        printDebug("error", "missing .params in request notification by server:", message);
        return
      }

      printDebug("receive notifcation from the server:", json.method);
      this.writer?.write(json as any as NotificationMessage)
    }
  }
}


function sleepMillis(timeMillis: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeMillis);
  });
}