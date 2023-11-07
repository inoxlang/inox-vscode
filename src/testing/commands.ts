import * as vscode from 'vscode';
import { InoxExtensionContext } from "../inox-extension-context"
import { INOX_FS_SCHEME } from '../inox-fs';
import { NodeSpan } from '../parse/ast';
import { LanguageClient } from 'vscode-languageclient/node';

export const RUN_ALL_TESTS_IN_FILE_CMD_NAME = "inox.testing.run-all-tests-in-file"
export const RUN_TESTSUITE_IN_FILE_CMD_NAME = "inox.testing.run-suite-in-file"
export const RUN_TESTCASE_IN_FILE_CMD_NAME = "inox.testing.run-case-in-file"


const TEST_FILE_METHOD = "testing/testFileAsync"
const TEST_OUTPUT_EVENT_METHOD = "testing/outputEvent"
const STOP_TEST_RUN_METHOD = "testing/stopRun"

const textDecoder = new TextDecoder()

const FILE_TEST_DEFAULT_TIMEOUT = 10_000
const TEST_FILE_REQUEST_CANCELLATION_TOKEN_TIMEOUT = 5000


interface Filter {
    regex: string
    path?: string
    span?: NodeSpan
}

export function registerCommands(ctx: InoxExtensionContext) {

    function createTokenSource(timeout: number) {
        const tokenSource = new vscode.CancellationTokenSource()
        setTimeout(() => {
            tokenSource.cancel()
            tokenSource.dispose()
        }, timeout)
        return tokenSource
    }

    function stopRun(lspClient: LanguageClient, runId: string) {
        const timeout = 1000
        const token = createTokenSource(timeout).token
        return lspClient.sendRequest(STOP_TEST_RUN_METHOD, {
            testRunId: runId,
        }, token)
    }

    //used to stop 
    let currentSingleFileTestRunId = ""


    async function runTestInFile(document: vscode.TextDocument, positiveFilters: Filter[]) {
        const lspClient = ctx.lspClient
        if (lspClient === undefined || !lspClient.isRunning()) {
            return
        }

        if (document.uri.scheme != INOX_FS_SCHEME) {
            return
        }

        if (currentSingleFileTestRunId != "") {
            await stopRun(lspClient, currentSingleFileTestRunId)
        }

        let runId = ""
        const testFileAsyncTokenSource = createTokenSource(TEST_FILE_REQUEST_CANCELLATION_TOKEN_TIMEOUT)

        const listenerDisposable = lspClient.onNotification(TEST_OUTPUT_EVENT_METHOD, ({ data }) => {
            const buffer = Buffer.from(data as string, 'base64')
            const decoded = textDecoder.decode(buffer)
            ctx.testChannel.append(decoded)
        })

        ctx.testChannel.clear()
        ctx.testChannel.show(true)

        setTimeout(() => {
            listenerDisposable.dispose()

            if (runId != "" && lspClient.isRunning()) {
                stopRun(lspClient, runId)
            }
        }, FILE_TEST_DEFAULT_TIMEOUT)

        try {
            const resp = await lspClient.sendRequest(TEST_FILE_METHOD, {
                path: document.uri.path,
                positiveFilters: positiveFilters,
            }, testFileAsyncTokenSource.token)

            if ((typeof resp != 'object') || resp === null) {
                listenerDisposable.dispose()
                return
            }

            runId = (resp as Record<string, unknown>).testRunid as string
            currentSingleFileTestRunId = runId
        } catch {
            listenerDisposable.dispose()
        }
    }

    vscode.commands.registerCommand(
        RUN_ALL_TESTS_IN_FILE_CMD_NAME,
        async ({ document, span }: { document: vscode.TextDocument, span: NodeSpan }) => {
            return runTestInFile(document, [{ regex: '.*' }])
        }
    )

    vscode.commands.registerCommand(
        RUN_TESTSUITE_IN_FILE_CMD_NAME,
        async ({ document, span }: { document: vscode.TextDocument, span: NodeSpan }) => {
            return runTestInFile(document, [
                {
                    regex: '.*',
                    path: document.uri.path,
                    span: span,
                }
            ])
        }
    )

    vscode.commands.registerCommand(
        RUN_TESTCASE_IN_FILE_CMD_NAME,
        async ({ document, span }: { document: vscode.TextDocument, span: NodeSpan }) => {
            return runTestInFile(document, [
                {
                    regex: '.*',
                    path: document.uri.path,
                    span: span,
                }
            ])
        }
    )
}