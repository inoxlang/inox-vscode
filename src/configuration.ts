import { inspect } from 'util';
import * as vscode from 'vscode';
import { OutputChannel } from "vscode"

const USE_INOX_BINARY_CONFIG_ENTRY = 'useInoxBinary'
const WS_ENDPOINT_CONFIG_ENTRY = 'websocketEndpoint'

export function getConfiguration(outputChannel: OutputChannel) {
  // read & check user settings
  const config = vscode.workspace.getConfiguration('inox')
  const useInoxBinary = config.get(USE_INOX_BINARY_CONFIG_ENTRY) === true
  const websocketEndpoint = config.get(WS_ENDPOINT_CONFIG_ENTRY)

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

  return { useInoxBinary, websocketEndpoint: new URL(websocketEndpoint) }
}
