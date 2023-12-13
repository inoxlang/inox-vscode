import * as fs from 'fs'
import * as vscode from 'vscode'

import { InoxExtensionContext } from "../inox-extension-context";
import { join, basename } from 'path';
import { stringifyCatchedValue, sleep } from '../utils';
import { saveTempTokens } from '../configuration';
import { fmtLspClientNotRunning } from '../errors';
import { getStateValue, setStateValue } from './extension-state';

const PROJECT_NAME_REGEX = /^[a-z][a-z0-9_-]*$/i
const DEFAULT_TEMPLATE_NAME = "web-app-min"

export async function initializeNewProject(ctx: InoxExtensionContext) {
    await ctx.updateConfiguration()

    if (ctx.config.projectFilePresent) {
        const msg = '[project/initialize] project is already initialized'
        vscode.window.showWarningMessage(msg)
        ctx.debugChannel.appendLine(msg)
        return
    }

    if (!ctx.lspClient?.isRunning()) {
        //try to restart the LSP client if it's not already connecting.
        await ctx.restartLSPClient(false)

        //wait for the LSP client if it's already connecting.
        await sleep(500)

        if (!ctx.lspClient?.isRunning()) {
            //only show error if an error message was not displayed just before.
            if(ctx.lastFailedToConnectTime == null || (Date.now() - ctx.lastFailedToConnectTime) > 3000){
                vscode.window.showErrorMessage(fmtLspClientNotRunning(ctx))
            }
            return
        }
    }

    let projectName: string
    //show an input box
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
            vscode.window.showErrorMessage(fmtLspClientNotRunning(ctx))
            return
        }

        await _initializeNewProject(ctx, projectName)

        vscode.window.showInformationMessage(
            "The project should have been created on the server. You can open it by clicking 'Open Workspace' in the `<project>.code-workspace` file.",
            {
                modal: true,
                detail: "If some extensions show an error when the workspace is loaded you can disable them in it."
            }
        )

        progress.report({ increment: 100 });
    });
}

async function _initializeNewProject(ctx: InoxExtensionContext, projectName: string) {
    const lspClient = ctx.lspClient
    if (!lspClient || !lspClient.isRunning()) {
        throw new Error(fmtLspClientNotRunning(ctx))
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


    const localProjectRoot = ctx.fileWorkspaceFolder.uri.fsPath
    const workspaceFile = join(localProjectRoot, `${ctx.fileWorkspaceFolder.name}.code-workspace`)
    const inoxProjectFile = join(localProjectRoot, 'inox-project.json')
    const readmeFile = join(localProjectRoot, 'README--open-workspace-file-to-open-project.txt')

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
                template: DEFAULT_TEMPLATE_NAME,
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