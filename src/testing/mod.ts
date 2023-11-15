
import * as vscode from 'vscode';
import { findTestSuiteAndCaseStatements, getNodeBase, getSpanLineColumn, parseInoxChunk } from '../parse/mod';
import { InoxExtensionContext } from '../inox-extension-context';
import { INOX_FS_SCHEME } from '../inox-fs';
import { RUN_ALL_TESTS_IN_FILE_CMD_NAME, RUN_TESTCASE_IN_FILE_CMD_NAME, RUN_TESTSUITE_IN_FILE_CMD_NAME, registerCommands } from './commands';

export function registerSpecCodeLensAndCommands(ctx: InoxExtensionContext) {
    const provider = new SpecFileLensProvider(ctx)

    let codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(
        {
            language: 'inox',
            scheme: INOX_FS_SCHEME,
            pattern: '**/*.ix'
        },
        provider,
    )

    ctx.base.subscriptions.push(codeLensProviderDisposable)

    registerCommands(ctx)
}

export class SpecFileLensProvider implements vscode.CodeLensProvider {

    constructor(readonly ctx: InoxExtensionContext) { }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if (!this.ctx.lspClient?.isRunning()) {
            return []
        }

        let topOfDocument = new vscode.Range(0, 0, 0, 0)
        const selectSeriesCommand: vscode.Command = {
            command: RUN_ALL_TESTS_IN_FILE_CMD_NAME,
            title: 'Run All Tests',
            arguments: [{ document }]
        }

        const result = await parseInoxChunk(this.ctx, document.uri.path, document.getText())
        if (!result.chunk || !result.chunkId) {
            return []
        }

        const chunkId = result.chunkId

        const statements = findTestSuiteAndCaseStatements(result.chunk)
        if (statements.length == 0) {
            return []
        }

        const lenses = [new vscode.CodeLens(topOfDocument, selectSeriesCommand)]

        //add a lens above each test suite and test case statement.
        await Promise.allSettled(statements.map(async stmt => {
            const span = getNodeBase(stmt)!.span
            const [line, column] = await getSpanLineColumn(this.ctx, chunkId, span.start, span.end)

            let cmd: vscode.Command
            if ('base:test-suite-expr' in stmt) {
                cmd = {
                    command: RUN_TESTSUITE_IN_FILE_CMD_NAME,
                    title: 'Run Suite',
                    arguments: [{ document, span }]
                }
            } else {
                cmd = {
                    command: RUN_TESTCASE_IN_FILE_CMD_NAME,
                    title: 'Run Test',
                    arguments: [{ document, span }]
                }
            }

            let range = new vscode.Range(line - 1, column - 1, line - 1, column - 1)
            const lens = new vscode.CodeLens(range, cmd)
            lenses.push(lens)
        }))
        return lenses
    }
}

