import { LOCAL_PROJECT_SERVER_COMMAND_ENTRY } from "./configuration";
import { InoxExtensionContext } from "./inox-extension-context";

export const LSP_CLIENT_NOT_RUNNING_MSG = "LSP client is not running, are you connected to the Internet ?"



export function fmtFailedToConnectToLSPServer(ctx: InoxExtensionContext){
    let msg = `Failed to connect to LSP server at ${ctx.config.websocketEndpoint}. The server may not be running or there may be certificate issues.` +
    ` If there are too many connections from your IP the server may prevent you to create a new one.`;

  if(process.platform == 'linux') {
    msg += ` If you have installed Inox locally, either set the command to start a local Inox LSP server `+
    `(extension setting '${LOCAL_PROJECT_SERVER_COMMAND_ENTRY}') or manually start a server on ${ctx.config.websocketEndpoint}.`
  }

  return msg
}