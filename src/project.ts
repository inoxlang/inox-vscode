import * as fs from 'fs'
import * as vscode from 'vscode'

import { InoxExtensionContext } from "./inox-extension-context";
import { join } from 'path';
import { stringifyCatchedValue } from './utils';
import { saveTempTokens } from './configuration';


export async function initializeNewProject(ctx: InoxExtensionContext, projectName: string){
    const lspClient = ctx.lspClient
    if(!lspClient || !lspClient.isRunning()){
        throw new Error("LSP client not running")
    }

    if(ctx.config.project?.id){
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

    const workspaceFileContent = {
        "folders": [
            {
                "path": "."
            },
            {
                "name": "Project FS",
                "uri": "inox:/"
            }
        ],
        "settings": {
            "inox.enableProjectMode": true
        },
        "launch": {
            "version": "0.2.0",
            "configurations": initialLaunchConfigurations
        }
    }


    const inoxProjectFileContent: Record<string, unknown> = {}

    const localProjectRoot = ctx.fileWorkspaceFolder.uri.path
    const workspaceFile = join(localProjectRoot, `${ctx.fileWorkspaceFolder.name}.code-workspace`)
    const inoxProjectFile = join(localProjectRoot, 'inox-project.json')


    if(! fs.existsSync(workspaceFile)){
        fs.writeFileSync(workspaceFile, JSON.stringify(workspaceFileContent, null, '  '))
    }
    
    if(! fs.existsSync(inoxProjectFile)){
        try {
            const projectId = await lspClient.sendRequest('project/create', {name: projectName})
            if(typeof projectId != 'string'){
                throw new Error('project ID returned by LSP server should be a string but is a(n) ' + (typeof projectId))
            }
            inoxProjectFileContent.id = projectId
            fs.writeFileSync(inoxProjectFile, JSON.stringify(inoxProjectFileContent, null, ' '))
    
        } catch(err) {
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
    if(!lspClient || !lspClient.isRunning()){
        throw new Error("LSP client not running")
    }

    const projectId = ctx.config.project?.id

    if(!projectId){
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

        if((typeof resp != 'object') || resp === null){
            vscode.window.showErrorMessage('invalid response from project server (method: project/open)')
            return
        }
        await saveTempTokens(ctx, (resp as Record<string,unknown>).tempTokens)

        ctx.projectOpen = true
    } catch(err){
        vscode.window.showErrorMessage(stringifyCatchedValue(err))
    }
}