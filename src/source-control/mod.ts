import * as vscode from 'vscode';
import * as path from 'path';
import { makeInoxSchemeURL } from '../inoxfs/mod';
import { InoxExtensionContext } from '../inox-extension-context';
import { SOURCE_CONTROL_NOT_AVAILABLE_MSG } from '../errors';


const COMMIT_COMMAND = 'inox.scm.commit'


export function registerSourceControlCommands(ctx: InoxExtensionContext){

    ctx.base.subscriptions.push(
        vscode.commands.registerCommand(COMMIT_COMMAND, (e) => {
            checkSourceControlDefined(ctx.sourceControl)

            ctx.sourceControl
        })
    )
}

export class SourceControl {

    private _scm: vscode.SourceControl
    private _index: vscode.SourceControlResourceGroup

    constructor(readonly ctx: InoxExtensionContext){
        this._scm =  vscode.scm.createSourceControl('git-inox', 'Git (Inox)',  makeInoxSchemeURL('/'));
        this._index = this._scm.createResourceGroup('index', 'Staged Changes');

        this._scm.acceptInputCommand = {
            command: COMMIT_COMMAND,
            title: "Commit"
        }
    }

}


function checkSourceControlDefined(sourceControl: SourceControl|undefined): asserts sourceControl is SourceControl {
    if(sourceControl === undefined){
        throw new Error(SOURCE_CONTROL_NOT_AVAILABLE_MSG)
    }
}