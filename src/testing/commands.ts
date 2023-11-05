import * as vscode from 'vscode';
import { InoxExtensionContext } from "../inox-extension-context"
import { INOX_FS_SCHEME } from '../inox-fs';

export const RUN_ALL_TESTS_IN_FILE_CMD_NAME = "inox.testing.run-all-tests-in-file"
export const RUN_TESTSUITE_IN_FILE_CMD_NAME = "inox.testing.run-suite-in-file"
export const RUN_TESTCASE_IN_FILE_CMD_NAME = "inox.testing.run-case-in-file"


const TEST_FILE_METHOD = "testing/testFileAsync"
const TEST_OUTPUT_EVENT_METHOD = "testing/outputEvent"
const STOP_TEST_RUN_METHOD = "testing/stopRun"

const textDecoder = new TextDecoder()

const FILE_TEST_DEFAULT_TIMEOUT = 10_000
const TEST_FILE_REQUEST_CANCELLATION_TOKEN_TIMEOUT = 5000

export function registerCommands(ctx: InoxExtensionContext) {

    function createTokenSource(timeout: number) {
        const tokenSource = new vscode.CancellationTokenSource()
        setTimeout(() => {
            tokenSource.cancel()
            tokenSource.dispose()
        }, timeout)
        return tokenSource
    }

    vscode.commands.registerCommand(RUN_ALL_TESTS_IN_FILE_CMD_NAME, async ({ document }: { document: vscode.TextDocument }) => {
        const lspClient = ctx.lspClient
        if (lspClient === undefined || !lspClient.isRunning()) {
            return
        }

        if (document.uri.scheme != INOX_FS_SCHEME) {
            return
        }


        let runId = -1
        const testFileAsyncTokenSource = createTokenSource(TEST_FILE_REQUEST_CANCELLATION_TOKEN_TIMEOUT)

        const listenerDisposable = lspClient.onNotification(TEST_OUTPUT_EVENT_METHOD, ({ data }) => {
            const buffer = Buffer.from(data as string, 'base64')
            const decoded = textDecoder.decode(buffer)
            ctx.testChannel.append(decoded)
        })

        ctx.testChannel.clear()

        setTimeout(() => {
            listenerDisposable.dispose()

            if (runId >= 0 && lspClient.isRunning()) {
                const timeout = 1000
                const token = createTokenSource(timeout).token
                lspClient.sendRequest(STOP_TEST_RUN_METHOD, {
                    testRunId: runId,
                }, token)
            }
        }, FILE_TEST_DEFAULT_TIMEOUT)

        try {
            const resp = await lspClient.sendRequest(TEST_FILE_METHOD, {
                path: document.uri.path,
                positiveFilters: [{ regex: '.*' }]
            }, testFileAsyncTokenSource.token)

            if ((typeof resp != 'object') || resp === null) {
                listenerDisposable.dispose()
                return
            }

            runId = (resp as Record<string, unknown>).testRunid as number
        } catch {
            listenerDisposable.dispose()
        }
    })
}