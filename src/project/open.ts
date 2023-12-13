import * as vscode from 'vscode'

import { InoxExtensionContext } from "../inox-extension-context";
import { stringifyCatchedValue, sleep } from '../utils';
import { saveTempTokens } from '../configuration';
import { fmtLspClientNotRunning } from '../errors';


export async function openProject(ctx: InoxExtensionContext) {
    if (!ctx.lspClient || !ctx.lspClient.isRunning()) {
        //try to restart the LSP client if it's not already connecting.
        await ctx.restartLSPClient(false)

        //wait for the LSP client if it's already connecting.
        await sleep(500)

        if (!ctx.lspClient || !ctx.lspClient.isRunning()) {
            throw new Error(fmtLspClientNotRunning(ctx))
        }
    }

    const lspClient = ctx.lspClient
    const projectId = ctx.config.project?.id

    if (!projectId) {
        vscode.window.showWarningMessage('failed to open project: missing .id in project configuration')
        return
    }

    try {
        ctx.debugChannel.appendLine("Send 'project/open' request")
        const resp = await lspClient.sendRequest('project/open', {
            projectId: projectId,
            config: ctx.config.project ?? {},
            tempTokens: ctx.config.tempTokens
        })

        if ((typeof resp != 'object') || resp === null) {
            vscode.window.showErrorMessage('invalid response from project server (method: project/open)')
            return
        }

        const {canBeDeployedInProd, tempTokens} = (resp as Record<string, unknown>)
        await saveTempTokens(ctx, tempTokens)

        ctx.markProjectAsOpen({canProjectBeDeployedInProd: Boolean(canBeDeployedInProd)})
    } catch (err) {
        vscode.window.showErrorMessage(stringifyCatchedValue(err))
    }
}