import * as vscode from 'vscode';

import {
    Logger, logger,
    DebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint, ExitedEvent
} from '@vscode/debugadapter';

import { DebugProtocol } from '@vscode/debugprotocol'
import { InoxExtensionContext } from './inox-extension-context';
const { Subject } = require('await-notify')


const DAP_LOG_PREFIX = "[Debug Adapter Protocol] "

export class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    constructor(readonly ctx: InoxExtensionContext) {

    }

    createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new InoxDebugSession(this.ctx));
    }
}

/**
 * This interface describes the inox-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the mock-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
}


class InoxDebugSession extends DebugSession {

    private _variableHandles = new Handles<string>();

    private _configurationDone = new Subject();

    private _cancelationTokens = new Map<number, boolean>();
    private _isLongrunning = new Map<number, boolean>();

    private nextSeq = 1
    private sessionID = String(Math.random())

    public constructor(readonly ctx: InoxExtensionContext) {
        super()
    }

    private get lspClient() {
        if (this.ctx.lspClient === undefined || !this.ctx.lspClient.isRunning()) {
            throw new Error('LSP client is not running')
        }

        return this.ctx.lspClient
    }


    sendError<T extends DebugProtocol.Response>(response: T, reason: unknown) {
        response.success = false
        response.message = String(reason)
        this.ctx.debugChannel.appendLine(DAP_LOG_PREFIX + String(reason))
        this.sendResponse(response)
    }

    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        const lsp = this.lspClient;

        lsp.onNotification("debug/terminated", () => {
            this.sendEvent(new TerminatedEvent())
        })

        lsp.onNotification("debug/exited", () => {
            this.sendEvent(new ExitedEvent(0))
        })

        lsp.onNotification("debug/output", event => {
            this.sendEvent(event as DebugProtocol.OutputEvent)
        })

        lsp.onNotification("debug/stopped", event => {
            this.sendEvent(event as DebugProtocol.StoppedEvent)
        })

        const initRequest: DebugProtocol.InitializeRequest = {
            type: 'request',
            command: "initialize",
            seq: this.nextSeq++,
            arguments: args
        }

        lsp.sendRequest('debug/initialize', {
            sessionID: this.sessionID,
            request: initRequest
        }).then(response => {
            const resp = response as DebugProtocol.InitializeResponse
            resp.seq = 0
            this.sendResponse(resp)

            this.sendEvent(new InitializedEvent());
        }, reason => {
            this.sendError(response, reason)
        })
    }

    /**
     * Called at the end of the configuration sequence.
     * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
     */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        const lsp = this.lspClient;

        const configurationDoneRequest: DebugProtocol.ConfigurationDoneRequest = {
            type: 'request',
            command: "configurationDone",
            seq: this.nextSeq++,
            arguments: args
        }

        lsp.sendRequest('debug/configurationDone', {
            sessionID: this.sessionID,
            request: configurationDoneRequest
        }).then(() => {
            response.seq = 0
            this.sendResponse(response)

            // notify the launchRequest that configuration has finished
            this._configurationDone.notify();
        }, reason => {
            this.sendError(response, reason)
        })
    }

    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments, request?: DebugProtocol.Request | undefined): void {
        const lsp = this.lspClient;

        const setBreakpointsRequest: DebugProtocol.SetBreakpointsRequest = {
            type: 'request',
            command: "setBreakpoints",
            seq: this.nextSeq++,
            arguments: args
        }

        lsp.sendRequest('debug/setBreakpoints', {
            sessionID: this.sessionID,
            request: setBreakpointsRequest
        }).then(() => {
            response.seq = 0
            this.sendResponse(response)
        }, reason => {
            this.sendError(response, reason)
        })
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse, request?: DebugProtocol.Request | undefined): void {
        const lsp = this.lspClient;

        const threadsRequest: DebugProtocol.ThreadsRequest = {
            type: 'request',
            command: "threads",
            seq: this.nextSeq++,
            arguments: {}
        }

        this.ctx.debugChannel.appendLine('SEND THREADS REQUEST')
        lsp.sendRequest('debug/threads', {
            sessionID: this.sessionID,
            request: threadsRequest
        }).then(async response => {
            const resp = response as DebugProtocol.ThreadsResponse
            resp.seq = 0
            this.sendResponse(resp)
        }, reason => {
            this.sendError(response, reason)
        })
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        const lsp = this.lspClient;

        const launchRequest: DebugProtocol.LaunchRequest = {
            type: 'request',
            command: "launch",
            seq: this.nextSeq++,
            arguments: args
        }

        lsp.sendRequest('debug/launch', {
            sessionID: this.sessionID,
            request: launchRequest
        }).then(async response => {
            const resp = response as DebugProtocol.LaunchResponse

            resp.seq = 0
            this.sendResponse(resp)
            
            if(!resp.success){
                return
            }

            // wait until configuration has finished (and configurationDoneRequest has been called)
            await this._configurationDone.wait(1000);
            this.sendResponse(resp);
        }, reason => {
            this.sendError(response, reason)
        })
    }

    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request | undefined): void {
        const lsp = this.lspClient;

        const launchRequest: DebugProtocol.PauseRequest = {
            type: 'request',
            command: "pause",
            seq: this.nextSeq++,
            arguments: args
        }

        lsp.sendRequest('debug/pause', {
            sessionID: this.sessionID,
            request: launchRequest
        }).then(async response => {
            const resp = response as DebugProtocol.PauseResponse
            resp.seq = 0
            this.sendResponse(resp)
        }, reason => {
            this.sendError(response, reason)
        })
    }

}