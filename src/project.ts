import * as fs from 'fs'
import * as vscode from 'vscode'

import { InoxExtensionContext } from "./inox-extension-context";
import { join, basename } from 'path';
import { stringifyCatchedValue, sleep } from './utils';
import { saveTempTokens } from './configuration';
import { LSP_CLIENT_NOT_RUNNING_MSG } from './errors';

const PROJECT_KEY_PREFIX = 'project/'
const PROJECT_NAME_REGEX = /^[a-z][a-z0-9_-]+$/i

function getStateValue(ctx: InoxExtensionContext, key: string) {
    return ctx.getStateValue(PROJECT_KEY_PREFIX + key)
}

function setStateValue(ctx: InoxExtensionContext, key: string, value: unknown) {
    return ctx.setStateValue(PROJECT_KEY_PREFIX + key, value)
}


export async function initializeNewProject(ctx: InoxExtensionContext) {
    await ctx.updateConfiguration()

    if (ctx.config.projectFilePresent) {
        const msg = '[project/initialize] project is already initialized'
        vscode.window.showWarningMessage(msg)
        ctx.debugChannel.appendLine(msg)
        return
    }


    let projectName: string
    {

        let input: string | undefined
        let tries = 2

        while (tries > 0 && input === undefined) {
            tries--
            input = await vscode.window.showInputBox({
                placeHolder: 'Examples: learn-inox, my-web-app',
                prompt: `Name of the project`,
                async validateInput(value) {
                    if (PROJECT_NAME_REGEX.test(value)) {
                        return null
                    } else {
                        return {
                            message: "The project's name should starts with a letter and should only contains letters, digits, '-' and '_'",
                            severity: vscode.InputBoxValidationSeverity.Error
                        }
                    }
                },
            })
        }

        if (input === undefined) {
            return
        }
        projectName = input
    }


    ctx.debugChannel.appendLine('[project/initialize] restart LSP client in project mode')
    await ctx.restartLSPClient(true)

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        cancellable: false,
        title: 'Creating Inox project in current folder'
    }, async (progress) => {
        progress.report({ increment: 0 });

        //wait for LSP client
        for (let i = 0; i < 3; i++) {
            if (!ctx.lspClient?.isRunning()) {
                await sleep(1000)
            }
        }

        if (!ctx.lspClient?.isRunning()) {
            progress.report({ increment: 100 });
            vscode.window.showErrorMessage(LSP_CLIENT_NOT_RUNNING_MSG)
        }

        await _initializeNewProject(ctx, projectName)

        vscode.window.showInformationMessage(
            "The project should have been created on the server. You can open it by clicking 'Open Workspace' in the `.code-workspace` file.",
            {
                modal: true
            }
        )

        progress.report({ increment: 100 });
    });
}

async function _initializeNewProject(ctx: InoxExtensionContext, projectName: string) {
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
                "name": ctx.fileWorkspaceFolder.name + " Project FS",
                "uri": "inox:/"
            },
            // {
            //     "path": ".",
            //     "name": ctx.fileWorkspaceFolder.name
            // }
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
        await fs.promises.writeFile(workspaceFile, JSON.stringify(workspaceFileContent, null, '  '))
    }

    if (!fs.existsSync(readmeFile)) {
        await fs.promises.writeFile(readmeFile, readmeFileContent)
    }

    if (!fs.existsSync(inoxProjectFile)) {
        const isFirstProject = getStateValue(ctx, 'first-created') !== true

        try {
            const projectId = await lspClient.sendRequest('project/create', {
                name: projectName,
                addTutFile: isFirstProject,
                addMainFile: true,
            })
            if (typeof projectId != 'string') {
                throw new Error('project ID returned by LSP server should be a string but is a(n) ' + (typeof projectId))
            }
            inoxProjectFileContent.id = projectId
            await fs.promises.writeFile(inoxProjectFile, JSON.stringify(inoxProjectFileContent, null, ' '))

            await setStateValue(ctx, 'first-created', true)
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