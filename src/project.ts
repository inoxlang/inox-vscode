import * as fs from 'fs'
import * as vscode from 'vscode'

import { InoxExtensionContext } from "./inox-extension-context";
import { join, basename } from 'path';
import { stringifyCatchedValue } from './utils';
import { saveTempTokens } from './configuration';
import { LSP_CLIENT_NOT_RUNNING_MSG } from './errors';


export async function initializeNewProject(ctx: InoxExtensionContext, projectName: string) {
    const lspClient = ctx.lspClient
    if (!lspClient || !lspClient.isRunning()) {
        throw new Error(LSP_CLIENT_NOT_RUNNING_MSG)
    }

    if (ctx.config.project?.id) {
        vscode.window.showWarningMessage('project is already initialized')
        return
    }

    let initialLaunchConfigurations: any[]
    try {
        initialLaunchConfigurations =
            ctx.base.extension.packageJSON.contributes.debuggers[0].initialConfigurations
    } catch {
        vscode.window.showWarningMessage('failed to get initial launch configurations')
        return
    }


    const localProjectRoot = ctx.fileWorkspaceFolder.uri.path
    const workspaceFile = join(localProjectRoot, `${ctx.fileWorkspaceFolder.name}.code-workspace`)
    const inoxProjectFile = join(localProjectRoot, 'inox-project.json')
    const readmeFile = join(localProjectRoot, 'README.txt')

    const workspaceFileContent = {
        "folders": [
            {
                "name": "Project Filesystem",
                "uri": "inox:/"
            },
            {
                "path": ".",
                "name": ctx.fileWorkspaceFolder.name
            }
        ],
        "settings": {
            "inox.enableProjectMode": true,
            "files.autoSave": "afterDelay"
        },
        "launch": {
            "version": "0.2.0",
            "configurations": initialLaunchConfigurations
        }
    }

    const readmeFileContent = [
        'Please do not edit or add files here. This folder should only contain local configuration.',
        `You can open the Inox project by opening '${basename(workspaceFile)}' and clicking the [Open Workspace] button in the bottom right corner.`,
        '',
        'Alternatively you can open the workspace file by going in the VSCode menu / File / Open Workspace from File.',
        'The next time you can directly click on File / Open Recent / ... (Workspace).'
    ].join('\n')

    const inoxProjectFileContent: Record<string, unknown> = {}

    if (!fs.existsSync(workspaceFile)) {
        fs.writeFileSync(workspaceFile, JSON.stringify(workspaceFileContent, null, '  '))
    }

    if (!fs.existsSync(readmeFile)) {
        fs.writeFileSync(readmeFile, readmeFileContent)
    }

    if (!fs.existsSync(inoxProjectFile)) {
        try {
            const projectId = await lspClient.sendRequest('project/create', { name: projectName })
            if (typeof projectId != 'string') {
                throw new Error('project ID returned by LSP server should be a string but is a(n) ' + (typeof projectId))
            }
            inoxProjectFileContent.id = projectId
            fs.writeFileSync(inoxProjectFile, JSON.stringify(inoxProjectFileContent, null, ' '))

        } catch (err) {
            const msg = stringifyCatchedValue(err)
            ctx.outputChannel.appendLine(msg)
            vscode.window.showErrorMessage(msg)
        }
    } else {
        vscode.window.showWarningMessage('an inox-project.json file is already present')
    }

}

export async function openProject(ctx: InoxExtensionContext) {
    const lspClient = ctx.lspClient
    if (!lspClient || !lspClient.isRunning()) {
        throw new Error(LSP_CLIENT_NOT_RUNNING_MSG)
    }

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
        await saveTempTokens(ctx, (resp as Record<string, unknown>).tempTokens)

        ctx.projectOpen = true
    } catch (err) {
        vscode.window.showErrorMessage(stringifyCatchedValue(err))
    }
}