import * as vscode from 'vscode'
import * as https from 'https'
import * as http from 'http'

import { LanguageClient } from 'vscode-languageclient/node'
import { generate } from 'selfsigned'

import { InoxExtensionContext } from '../inox-extension-context'
import { stringifyCatchedValue } from '../utils'
import { getSelfSignedCertificate } from './certs'


export const PROJECT_SERVER_DEV_PORT_0 = 8100
export const PROJECT_SERVER_DEV_PORT_1 = 8101
export const PROJECT_SERVER_DEV_PORT_2 = 8102

const DEV_TOOLS_PORT = PROJECT_SERVER_DEV_PORT_2

const HTTP_REQUEST_ASYNC_METHOD = "httpClient/requestAsync"
const HTTP_RESPONSE_EVENT_METHOD = "httpClient/responseEvent"
const LSP_REQUEST_TIMEOUT_MILLIS = 5_000
const LSP_NOTIF_WAIT_TIMEOUT_MILLIS = 25_000

const LOCALHOST_PROXY_LOG_PREFIX = "[Localhost Proxy] "
const DEVTOOLS_LOG_PREFIX = "[DevTools Proxy] "


//Mapping request ID -> {resolve, reject}.
const pendindgRequests = new Map<string, { method: string, url: string, resolve: Function, reject: Function }>()
const lspClients = new WeakSet<LanguageClient>()

let runningProxies = new Set<number>()

export function isLocalhostProxyRunning(localhostPort: number){
    return runningProxies.has(localhostPort)
}

export function startLocalhostProxyServer(ctx: InoxExtensionContext, localhostPort: number) {
    const serverOptions = getServerOptions(ctx, localhostPort)
    const isDevToolsProxy = localhostPort == DEV_TOOLS_PORT
    const server = https.createServer(serverOptions, ((req, resp) => handleRequest(ctx, req, resp, isDevToolsProxy)))

    try {
        //Start server.

        server.on('listening', () => {
            runningProxies.add(localhostPort)
            ctx.outputChannel.appendLine(`start proxy listening on localhost:${localhostPort} (local machine)`)
        })

        server.on('close', () => {
            runningProxies.delete(localhostPort)
        })

        server.on('error', err => {
            const message = `failed to start localhost server (port ${localhostPort}) on local machine: ${err.message}.` +
                `Another Inox project may be open. You can fix this by changing the 'Default Localhost Proxy Port' in the extension settings (workspace).`

            vscode.window.showErrorMessage(message)
        })

        server.listen(localhostPort, 'localhost')
    } catch (reason) {
        runningProxies.delete(localhostPort)
        vscode.window.showErrorMessage("localhost server on local machine: " + stringifyCatchedValue(reason))
    }
}

async function handleRequest(ctx: InoxExtensionContext, req: http.IncomingMessage, resp: http.ServerResponse, isDevToolsProxy: boolean) {
    const lspClient = ctx.lspClient
    const logPrefix = isDevToolsProxy ? DEVTOOLS_LOG_PREFIX : LOCALHOST_PROXY_LOG_PREFIX

    if (!lspClient?.isRunning()) {
        resp.statusCode = 500
        resp.write('Cannot forward request: no connection to project server')
        resp.end()
        return
    }

    if (req.url === undefined) {
        resp.statusCode = 500
        resp.write('Cannot forward request: request has no URL')
        resp.end()
        return
    }

    if (!lspClients.has(lspClient)) {
        lspClients.add(lspClient)

        //Register notification handler.
        lspClient.onNotification(HTTP_RESPONSE_EVENT_METHOD, lspMessage => {
            const reqID = lspMessage.reqID
            const pendindgRequest = pendindgRequests.get(reqID)
            if (pendindgRequest === undefined) {
                ctx.debugChannel.appendLine(logPrefix + `Error/Response of unregistered pending request received from project server.`)
                return
            }

            if (lspMessage.error) {
                ctx.debugChannel.appendLine(logPrefix + `${pendindgRequest.method} ${pendindgRequest.url} (id ${reqID}) - Error received from project server.`)
            } else {
                ctx.debugChannel.appendLine(logPrefix + `${pendindgRequest.method} ${pendindgRequest.url} (id ${reqID}) - Response received from project server.`)
            }

            pendindgRequest.resolve(lspMessage)
        })
    }

    //Wait to receive all the body.

    let chunks: Uint8Array[] = []
    const allDataReceived = new Promise((resolve, reject) => {

        req.on('end', () => {
            resolve(null)
        });

        req.on('error', (err) => {
            reject(err)
        })

        req.on('data', (chunk) => {
            if (typeof chunk == 'string') {
                chunk = Buffer.from(chunk)
            }
            chunks.push(chunk);
        })
    })

    try {
        await allDataReceived
    } catch (reason) {
        resp.statusCode = 500
        resp.write('Cannot forward request: failed to read body ' + stringifyCatchedValue(reason))
        resp.end()
        return
    }

    //Create the LSP parameters.

    const normalizedHeaders: Record<string, string[]> = {}

    for (const headerName in req.headers) {
        let values = req.headers[headerName]
        if (values === undefined) {
            continue
        }
        if (!Array.isArray(values)) {
            values = [values]
        }
        normalizedHeaders[headerName] = values
    }

    const body = Buffer.concat(chunks)
    const base64RequestBody = body.toString('base64')

    const targetPort = isDevToolsProxy ? DEV_TOOLS_PORT : PROJECT_SERVER_DEV_PORT_0

    const url = new URL(req.url, 'https://localhost:' + targetPort)
    const reqID = String(Math.random())

    const params = {
        url: url.toString(),
        reqId: reqID,
        method: req.method,
        headers: normalizedHeaders,
        body: base64RequestBody,
    }

    //Register the resolver and rejecter.
    //If the project server is on the same machine the registration should
    //be made before sending the LSP message. If the registration is made
    //afterwards and the project server sends a notification very quickly
    //the notification handler may be called before the registration.

    const promise = new Promise((resolve, reject) => {
        pendindgRequests.set(reqID, { resolve, reject, method: req.method!, url: url.toString(), })

        setTimeout(() => {
            reject()
            pendindgRequests.delete(reqID)
        }, LSP_NOTIF_WAIT_TIMEOUT_MILLIS)
    })


    //Send the LSP message.

    const tokenSource = new vscode.CancellationTokenSource()
    let timeout = false

    setTimeout(() => {
        timeout = false
        tokenSource.cancel()
        tokenSource.dispose()
    }, LSP_REQUEST_TIMEOUT_MILLIS)

    try {
        await lspClient.sendRequest(HTTP_REQUEST_ASYNC_METHOD, params, tokenSource.token)
    } catch (reason) {
        if (timeout) {
            resp.statusCode = 500
            resp.write('Timeout. Project server did not acknowledge it received the response.')
        } else {
            resp.statusCode = 500
            resp.write(stringifyCatchedValue(reason))
        }
        return
    }

    let message: any;
    try {
        message = await promise
    } catch (reason) {
        resp.statusCode = 500
        resp.write(stringifyCatchedValue(reason))
        return
    }

    let object = message as Record<string, unknown>

    if ('error' in object) {
        resp.statusCode = 500
        resp.write(object.error)
        resp.end()
        return
    }

    //Create the response the LSP response.
    const statusCode = object.statusCode as number
    const base64Body = object.body

    let buffer: Buffer | undefined;

    if (base64Body) {
        try {
            buffer = Buffer.from((base64Body as any), 'base64')

            const bodyS = buffer.toString('utf-8')
            if(bodyS.includes('This server is not expected to receive requests from a browser')){
                resp.statusCode = 500
                resp.write("No target server is listening.")
                resp.end()
                return
            }
        } catch (reason) {
            resp.statusCode = 500
            resp.write("failed to deserialize response body in message sent by project server")
            resp.end()
            return
        }
    }

    ctx.debugChannel.appendLine(LOCALHOST_PROXY_LOG_PREFIX + `${req.method} ${req.url} (id ${reqID}) - Respond to request from local machine.`)

    const headers = object.headers as Record<string, string[]>
    resp.writeHead(statusCode, headers)

    if (buffer) {
        resp.write(buffer)
    }
    resp.end()
}

function getServerOptions(ctx: InoxExtensionContext, localhostPort: number): https.ServerOptions {
    const { cert, key } = getSelfSignedCertificate(ctx)
    return {
        cert: cert,
        key: key,
    }
}