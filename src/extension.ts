import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, StreamInfo, TransportKind, Executable } from 'vscode-languageclient/node';

let client: LanguageClient;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Inox Extension');

  const serverOptions: ServerOptions = {
    command: 'inox',
    args: ['lsp'],

  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'inox' }],
    synchronize: {
      configurationSection: 'Inox',
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ix')
    },
    outputChannel: outputChannel,
  };

  client = new LanguageClient('Inox language server', 'Inox Language Server', serverOptions, clientOptions);
  outputChannel.appendLine('start LSP client')
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}