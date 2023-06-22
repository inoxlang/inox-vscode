import { join } from 'path';
import { URL } from 'url';
import { inspect } from 'util';
import * as vscode from 'vscode';
import { OutputChannel } from "vscode"

const WS_ENDPOINT_CONFIG_ENTRY = 'websocketEndpoint'
const ENABLE_PROJECT_MODE_CONFIG_ENTRY = 'enableProjectMode'
const INOX_PROJECT_FILENAME = 'inox-project.json'

export async function getConfiguration(outputChannel: OutputChannel): Promise<Configuration | undefined> {
  // read & check user settings
  const config = vscode.workspace.getConfiguration('inox')
  const websocketEndpoint = config.get(WS_ENDPOINT_CONFIG_ENTRY)
  const inProjectMode = config.get(ENABLE_PROJECT_MODE_CONFIG_ENTRY) === true

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

  if (inProjectMode) {
    projectConfig = {}

    //create a watcher for the project file.
    const inoxProjectConfigURI = fileFsFolder.uri.with({ path: fileFsFolder.uri.path + '/' + INOX_PROJECT_FILENAME })

    //try to read the project configuration file.
    let configDocument: vscode.TextDocument | undefined;
    try {
      configDocument = await vscode.workspace.openTextDocument(inoxProjectConfigURI)
    } catch {

    }

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
    localFilesystemDir: join(fileFsFolder.uri.path, '.filesystem'),
    localProjectRoot: fileFsFolder.uri.toString(),
  }

  if (websocketEndpoint !== "") {
    result.websocketEndpoint = new URL(websocketEndpoint)
  }

  return result
}

export type Configuration = {
  websocketEndpoint?: URL
  project?: ProjectConfiguration
  localFilesystemDir: string
  localProjectRoot: string
}

export type ProjectConfiguration = {
  id?: string
}