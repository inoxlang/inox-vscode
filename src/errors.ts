import * as vscode from 'vscode';
import { InoxExtensionContext } from './inox-extension-context';
import { isWebsocketServerRunning } from './websocket';

export const LSP_CLIENT_NOT_RUNNING_MSG = "LSP client is not running, are you connected to the Internet ?"
