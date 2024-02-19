import { URL } from 'url';
import { inspect } from 'util';
import * as vscode from 'vscode';
import * as fs from 'fs'
import {join, dirname} from 'path'
import { OutputChannel } from "vscode"
import { InoxExtensionContext } from './inox-extension-context';

export const COMMUNITY_SERVER_HOST = "community-server.inoxlang.dev"
const COMMUNITY_SERVER_ENDPOINT = "wss://"+COMMUNITY_SERVER_HOST

const ENABLE_PROJECT_MODE_CONFIG_ENTRY = 'enableProjectMode'
const TEMP_TOKENS_FILENAME = 'temp-tokens.json'
const ADDITIONAL_TOKENS_API_TOKEN_FIELD = 'additional-tokens-api-token'
const ACCOUNT_ID_FIELD = 'account-id'
const LOCAL_PROJECT_SERVER_ENV = 'localProjectServerEnv'

export const REMOTE_INOX_PROJECT_FILENAME = 'remote-inox-project.json'
export const DEFAULT_LOCALHOT_PROXY_PORT_ENTRY = 'defaultLocalhostProxyPort'
export const WS_ENDPOINT_CONFIG_ENTRY = 'websocketEndpoint'
export const LOCAL_PROJECT_SERVER_COMMAND_ENTRY = 'localProjectServerCommand'
export let forceUseCommunityServer = {value: false}

export type Configuration = {
    websocketEndpoint?: URL
    project?: ProjectConfiguration
    tempTokens?: TempTokens //not present if project is undefined
    projectFilePresent: boolean

    inVirtualWorkspace: boolean,

    localProjectRoot: vscode.Uri
    localProjectServerCommand: string[]
    localProjectServerEnv: Record<string, string>

    defaultLocalhostProxyPort: number,
}

export type ProjectConfiguration = {
    id?: string
    memberId?: string
    cloudflare?: {
        "additional-tokens-api-token": string
        "account-id": string
    }
}

export type TempTokens = {
    r2Token?: string
}


export async function getConfiguration(outputChannel: OutputChannel): Promise<Configuration | undefined> {
    // read & check user settings
    const config = vscode.workspace.getConfiguration('inox')
    const websocketEndpoint = forceUseCommunityServer.value ? COMMUNITY_SERVER_ENDPOINT : config.get(WS_ENDPOINT_CONFIG_ENTRY)
    const inProjectMode = config.get(ENABLE_PROJECT_MODE_CONFIG_ENTRY) === true
    const localProjectServerCommand = config.get(LOCAL_PROJECT_SERVER_COMMAND_ENTRY) as string[]
    const localProjectServerEnvEntries = config.get(LOCAL_PROJECT_SERVER_ENV) as Record<string, unknown>
    const defaultLocalhostProxyPort = config.get(DEFAULT_LOCALHOT_PROXY_PORT_ENTRY) as number

    const inVirtualWorkspace = vscode.workspace.workspaceFolders != undefined &&
        vscode.workspace.workspaceFolders.every(f => f.uri.scheme !== 'file');

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
    let tempTokens: TempTokens | undefined
    let localFolder: vscode.Uri | undefined
    let projectFilePresent = false


    for (const folder of vscode.workspace.workspaceFolders || []) {
        if (folder.uri.scheme != 'file') {
            continue
        }

        localFolder = folder.uri
    }

    if (!localFolder) {
        if(inVirtualWorkspace && vscode.workspace.workspaceFile != undefined){
            const dir = dirname(vscode.workspace.workspaceFile.fsPath)

            localFolder = vscode.workspace.workspaceFile.with({ path: dir })
        } else {
            vscode.window.showErrorMessage("no file:// folder")
            return
        }
    }

    //check project config file even if not in project mode
    const inoxProjectConfigURI = localFolder.with({ path: localFolder.fsPath + '/' + REMOTE_INOX_PROJECT_FILENAME })
    const tempTokensURI = getTempTokensURI(localFolder)

    //try to read the project configuration file.
    let configDocument: vscode.TextDocument | undefined;
    let tempTokensFileContent: string = '';

    try {
        configDocument = await vscode.workspace.openTextDocument(inoxProjectConfigURI)
        projectFilePresent = true
        tempTokensFileContent = new TextDecoder().decode(await fs.promises.readFile(tempTokensURI.fsPath))
    } catch {

    }

    if (inProjectMode) {
        projectConfig = {}

        if (configDocument) {
            //try to parse the project configuration file
            try {
                const text = configDocument.getText()
                if (text.trim() == '') {
                    projectConfig = {}
                } else {
                    const parsed = JSON.parse(text)
                    if ((typeof parsed != 'object') || parsed == null) {
                        vscode.window.showErrorMessage('invalid ' + REMOTE_INOX_PROJECT_FILENAME)
                        return
                    }
                    projectConfig = parsed
                }
            } catch (err) {
                vscode.window.showErrorMessage(`failed to parse ${REMOTE_INOX_PROJECT_FILENAME}: ` + String(err))
                return
            }

            if (tempTokensFileContent != '') {
                //try to parse the temporary tokens file
                try {
                    if (tempTokensFileContent.trim() != '') {
                        const parsed = JSON.parse(tempTokensFileContent)
                        const e = typeof parsed
                        if ((typeof parsed != 'object') || parsed == null) {
                            vscode.window.showErrorMessage('invalid ' + TEMP_TOKENS_FILENAME)
                            return
                        }
                        tempTokens = parsed
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`failed to parse ${TEMP_TOKENS_FILENAME}: ` + String(err))
                    return
                }
            }
        }
    }

    const localProjectServerEnv: Record<string, string> = {}

    for (let [entryName, entryValue] of Object.entries(localProjectServerEnvEntries)) {
        if(typeof entryValue != 'string'){
            entryValue = JSON.stringify(entryValue)
        }
     
        localProjectServerEnv[entryName] = String(entryValue)
    }

    const result: Configuration = {
        project: projectConfig,
        tempTokens: tempTokens,
        projectFilePresent: projectFilePresent,

        inVirtualWorkspace: inVirtualWorkspace,

        localProjectRoot: localFolder,
        localProjectServerCommand: localProjectServerCommand,
        localProjectServerEnv: localProjectServerEnv,

        defaultLocalhostProxyPort: defaultLocalhostProxyPort,
    }

    if (websocketEndpoint !== "") {
        result.websocketEndpoint = new URL(websocketEndpoint)
    }

    if (result.project !== undefined && !checkProjectConfig(result.project)) {
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


function getTempTokensURI(fileFsFolder: vscode.Uri) {
    return fileFsFolder.with({ path: join(fileFsFolder.fsPath, TEMP_TOKENS_FILENAME) })
}

export async function saveTempTokens(ctx: InoxExtensionContext, arg: unknown) {
    const uri = getTempTokensURI(ctx.config.localProjectRoot)
    const json = JSON.stringify(arg)
    const data = new TextEncoder().encode(json)
    return fs.promises.writeFile(uri.fsPath, data)
}