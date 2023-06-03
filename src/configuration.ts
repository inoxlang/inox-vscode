import { URL } from 'url';
import { inspect } from 'util';
import * as vscode from 'vscode';
import { OutputChannel } from "vscode"

const WS_ENDPOINT_CONFIG_ENTRY = 'websocketEndpoint'
const PROJECT_MODE_CONFIG_ENTRY = 'enableProjectMode'
const INOX_PROJECT_FILENAME = 'inox-project.json'

export async function getConfiguration(outputChannel: OutputChannel): Promise<Configuration | undefined> {
  // read & check user settings
  const config = vscode.workspace.getConfiguration('inox')
  const websocketEndpoint = config.get(WS_ENDPOINT_CONFIG_ENTRY)
  const inProjectMode = config.get(PROJECT_MODE_CONFIG_ENTRY) === true

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
  } else {
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

  let projectConfig: {} | undefined;
  let fileFsFolder: vscode.WorkspaceFolder | undefined

  project_mode: if (inProjectMode) {
    projectConfig = {}

    for (const folder of vscode.workspace.workspaceFolders || []) {
      if (folder.uri.scheme != 'file') {
        continue
      }

      fileFsFolder = folder
    }

    if (!fileFsFolder) {
      break project_mode
    }

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

  return {
    project: projectConfig,
    websocketEndpoint: new URL(websocketEndpoint)
  }
}

export type Configuration = {
  websocketEndpoint: URL
  project?: {},
}