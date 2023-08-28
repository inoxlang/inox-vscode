import { join } from 'path';
import { URL } from 'url';
import { inspect } from 'util';
import * as vscode from 'vscode';
import { OutputChannel } from "vscode"

const WS_ENDPOINT_CONFIG_ENTRY = 'websocketEndpoint'
const ENABLE_PROJECT_MODE_CONFIG_ENTRY = 'enableProjectMode'
const INOX_PROJECT_FILENAME = 'inox-project.json'
const ADDITIONAL_TOKENS_API_TOKEN_FIELD = 'additional-tokens-api-token'
const ACCOUNT_ID_FIELD = 'account-id'


export const LOCAL_PROJECT_SERVER_COMMAND_ENTRY = 'localProjectServerCommand'


export type Configuration = {
    websocketEndpoint?: URL
    project?: ProjectConfiguration
    projectFilePresent: boolean
    localProjectRoot: string
    localProjectServerCommand: string[]
}

export type ProjectConfiguration = {
    id?: string
    cloudflare?: {
        "additional-tokens-api-token": string
        "account-id": string
    }
}


export async function getConfiguration(outputChannel: OutputChannel): Promise<Configuration | undefined> {
    // read & check user settings
    const config = vscode.workspace.getConfiguration('inox')
    const websocketEndpoint = config.get(WS_ENDPOINT_CONFIG_ENTRY)
    const inProjectMode = config.get(ENABLE_PROJECT_MODE_CONFIG_ENTRY) === true
    const localProjectServerCommand = config.get(LOCAL_PROJECT_SERVER_COMMAND_ENTRY) as string[]

    if (typeof websocketEndpoint != 'string') {
        let msg: string
        if (!config.has(WS_ENDPOINT_CONFIG_ENTRY)) {
            msg = WS_ENDPOINT_CONFIG_ENTRY + ' not found in the extension\'s configuration'
        } else {
            msg = WS_ENDPOINT_CONFIG_ENTRY + '  provided in the extension\'s configuration is not a string, value is: ' +
                inspect(websocketEndpoint)
        }

        outputChannel.appendLine(msg)
        vscode.window.showErrorMessage(msg)
        return
    } else if (websocketEndpoint != '') {
        let errorMessage: string | undefined

        try {
            const url = new URL(websocketEndpoint)
            if (url.protocol != 'wss:') {
                errorMessage = WS_ENDPOINT_CONFIG_ENTRY + ' provided in the extension\'s configuration should have a [wss://] scheme, value is: ' + websocketEndpoint
            }
        } catch (err) {
            errorMessage = WS_ENDPOINT_CONFIG_ENTRY + ' provided in the extension\'s configuration is not a valid URL, value is: ' + websocketEndpoint
        }

        if (errorMessage) {
            outputChannel.appendLine(errorMessage)
            vscode.window.showErrorMessage(errorMessage)
            return
        }
    }

    let projectConfig: ProjectConfiguration | undefined;
    let fileFsFolder: vscode.WorkspaceFolder | undefined
    let projectFilePresent = false

    for (const folder of vscode.workspace.workspaceFolders || []) {
        if (folder.uri.scheme != 'file') {
            continue
        }

        fileFsFolder = folder
    }

    if (!fileFsFolder) {
        vscode.window.showErrorMessage("no file:// folder")
        return
    }

    //check project config file even if not in project mode
    const inoxProjectConfigURI = fileFsFolder.uri.with({ path: fileFsFolder.uri.path + '/' + INOX_PROJECT_FILENAME })

    //try to read the project configuration file.
    let configDocument: vscode.TextDocument | undefined;
    try {
        configDocument = await vscode.workspace.openTextDocument(inoxProjectConfigURI)
        projectFilePresent = true
    } catch {

    }

    if (inProjectMode) {
        projectConfig = {}

        //try to parse the project configuration file.
        if (configDocument) {
            try {
                const text = configDocument.getText()
                if (text.trim() == '') {
                    projectConfig = {}
                } else {
                    const parsed = JSON.parse(text)
                    if ((typeof parsed != 'object') || parsed == null) {
                        vscode.window.showErrorMessage('invalid inox-project.json')
                        return
                    }
                    projectConfig = parsed
                }
            } catch (err) {
                vscode.window.showErrorMessage('failed to parse inox-project.json: ' + String(err))
                return
            }
        }

    }

    const result: Configuration = {
        project: projectConfig,
        projectFilePresent: projectFilePresent,
        localProjectRoot: fileFsFolder.uri.toString(),
        localProjectServerCommand: localProjectServerCommand,
    }

    if (websocketEndpoint !== "") {
        result.websocketEndpoint = new URL(websocketEndpoint)
    }

    if(result.project !== undefined && !checkProjectConfig(result.project)){
        return
    }

    return result
}

function checkProjectConfig(config: ProjectConfiguration): boolean {
    const ERR_PREFIX = 'invalid project configuration: '

    if (config.cloudflare !== undefined) {
       if (config.cloudflare === null || typeof config.cloudflare != 'object') {
            vscode.window.showErrorMessage(ERR_PREFIX + 'top-level cloudflare property should be an object')
            return false
        }

        const additionalTokensApiToken = config.cloudflare[ADDITIONAL_TOKENS_API_TOKEN_FIELD]
        if ((typeof additionalTokensApiToken != 'string') || additionalTokensApiToken == '') {
            vscode.window.showErrorMessage(ERR_PREFIX + `cloudflare.${ADDITIONAL_TOKENS_API_TOKEN_FIELD} property should be a non-empty string`)
            return false
        }

        const accountId = config.cloudflare[ACCOUNT_ID_FIELD]
        if ((typeof accountId != 'string') || accountId == '') {
            vscode.window.showErrorMessage(ERR_PREFIX + `cloudflare.${ACCOUNT_ID_FIELD} property should be a non-empty string`)
            return false
        }
    }

    return true
}