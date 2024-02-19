import * as fs from 'fs';
import * as vscode from 'vscode';

import { basename, join } from 'path';
import { DEFAULT_LOCALHOT_PROXY_PORT_ENTRY, ProjectConfiguration, REMOTE_INOX_PROJECT_FILENAME, WS_ENDPOINT_CONFIG_ENTRY } from '../configuration';
import { fmtLspClientNotRunning } from '../errors';
import { InoxExtensionContext } from "../inox-extension-context";
import { assertNotNil, sleep, stringifyCatchedValue } from '../utils';
import { getStateValue, setStateValue } from './extension-state';

const PROJECT_NAME_REGEX = /^[a-z][a-z0-9_-]*$/i
const DEFAULT_TEMPLATE_NAME = "web-app-min"
const WAIT_LSP_STEP_MILLIS = 250
const MAX_WAIT_LSP_DURATION_MILLIS = WAIT_LSP_STEP_MILLIS * 20


export async function initializeNewProject(ctx: InoxExtensionContext, onCommunitServer: boolean) {
    await ctx.updateConfiguration()

    if (ctx.config.projectFilePresent) {
        const msg = '[project/initialize] project is already initialized'
        vscode.window.showWarningMessage(msg)
        ctx.debugChannel.appendLine(msg)
        return
    }

    if (!ctx.lspClient?.isRunning()) {
        //Try to restart the LSP client if it's not already (re)starting.
        await ctx.restartLSPClient(false)

        //Wait for the LSP client to (re)start, and (potentially) for the local server to start.
        for (let i = 0; i < MAX_WAIT_LSP_DURATION_MILLIS; i += WAIT_LSP_STEP_MILLIS) {
            await sleep(WAIT_LSP_STEP_MILLIS)

            if (ctx.lspClient?.isRunning()) {
                break
            }
        }

        if (!ctx.lspClient?.isRunning()) {
            //only show error if an error message was not displayed just before.
            if (ctx.lastFailedToConnectTime == null || (Date.now() - ctx.lastFailedToConnectTime) > 3000) {
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
            "The project should have been created on the server. " +
            `You can open it by clicking 'Open Workspace' in the '${ctx.fileWorkspaceFolder.name}.code-workspace' file.`,
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

    assertNotNil(ctx.config.websocketEndpoint)

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
    const inoxProjectFile = join(localProjectRoot, REMOTE_INOX_PROJECT_FILENAME)
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
            ["inox." + WS_ENDPOINT_CONFIG_ENTRY]: ctx.config.websocketEndpoint.toString(),

            //Enable the localhost proxy if the server is remote.
            ["inox." + DEFAULT_LOCALHOT_PROXY_PORT_ENTRY]: (ctx.config.websocketEndpoint.hostname == 'localhost') ? 0 : 8080,

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

    const inoxProjectFileContent: Partial<ProjectConfiguration> = {}

    if (!fs.existsSync(workspaceFile)) {
        await fs.promises.writeFile(workspaceFile, JSON.stringify(workspaceFileContent, null, '  '))
    }

    if (!fs.existsSync(readmeFile)) {
        await fs.promises.writeFile(readmeFile, readmeFileContent)
    }

    if (!fs.existsSync(inoxProjectFile)) {
        const isFirstProject = getStateValue(ctx, 'first-created') !== true

        try {
            const response = await lspClient.sendRequest('project/create', {
                name: projectName,
                addTutFile: isFirstProject,
                template: DEFAULT_TEMPLATE_NAME,
            })

            if (typeof response != 'object') {
                throw new Error('project server answered with a malformed response')
            }

            const { projectId, ownerId } = response as Record<string, unknown>

            if (typeof projectId != 'string') {
                throw new Error('project ID returned by the project server should be a string but is a(n) ' + (typeof projectId))
            }

            if (typeof ownerId != 'string') {
                throw new Error('owner ID returned by the project server should be a string but is a(n) ' + (typeof ownerId))
            }

            inoxProjectFileContent.id = projectId
            inoxProjectFileContent.memberId = ownerId

            await fs.promises.writeFile(inoxProjectFile, JSON.stringify(inoxProjectFileContent, null, ' '))

            await setStateValue(ctx, 'first-created', true)
        } catch (err) {
            const msg = stringifyCatchedValue(err)
            ctx.outputChannel.appendLine(msg)
            vscode.window.showErrorMessage(msg)
        }
    } else {
        vscode.window.showWarningMessage(`${basename(inoxProjectFile)} is already present`)
    }

}