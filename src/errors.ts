import { LOCAL_PROJECT_SERVER_COMMAND_ENTRY } from "./configuration";
import { InoxExtensionContext } from "./inox-extension-context";

export const EXTENSION_DOC_RECOMMENDENTATION_MSG = "Make sure to read the 'Requirements' and 'Usage' sections in the extension's details."


export function fmtLspClientNotRunning(ctx: InoxExtensionContext){
    return `LSP client is not running. The project server at ${ctx.config.websocketEndpoint} may not be running or there may be certificate issues. ` +
      EXTENSION_DOC_RECOMMENDENTATION_MSG
}

export function fmtFailedToConnectToLSPServer(ctx: InoxExtensionContext){
    let msg = `Failed to connect to LSP server at ${ctx.config.websocketEndpoint}. The server may not be running or there may be certificate issues.` +
    EXTENSION_DOC_RECOMMENDENTATION_MSG + " Also if there are too many connections from your IP the server may prevent you to create a new one. ";

  return msg
}