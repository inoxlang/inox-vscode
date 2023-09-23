import { hasUncaughtExceptionCaptureCallback } from 'process';
import * as vscode from 'vscode';
import { INOX_FS_SCHEME } from '../inox-fs';
import { InoxExtensionContext } from '../inox-extension-context';


export const CHOOSE_TUT_CMD_NAME = 'inox.learn.choose-tutorial'

export class TutorialCodeLensProvider implements vscode.CodeLensProvider {
    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        let topOfDocument = new vscode.Range(0, 0, 0, 0)

        let c: vscode.Command = {
            command: CHOOSE_TUT_CMD_NAME,
            title: 'Choose/Change Tutorial',
            arguments: [document]
        }

        let codeLens = new vscode.CodeLens(topOfDocument, c)

        return [codeLens]
    }
}


export function registerLearningCodeLensAndCommands(ctx: InoxExtensionContext){
    const provider = new TutorialCodeLensProvider()

    let codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(
        {
            language: 'inox',
            scheme: INOX_FS_SCHEME,
            pattern: '**/*.tut.ix'
        },
        provider,
      )
      
    ctx.base.subscriptions.push(codeLensProviderDisposable)
    
    vscode.commands.registerCommand(CHOOSE_TUT_CMD_NAME, async (doc: vscode.TextDocument) => {
        if(! ctx.lspClient?.isRunning()){
            vscode.window.showWarningMessage('LSP client is not running')
            return
        }
    })
}