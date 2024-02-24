import * as vscode from 'vscode';
import { SOURCE_CONTROL_NOT_AVAILABLE_MSG } from '../errors';
import { InoxExtensionContext } from '../inox-extension-context';
import { makeInoxSchemeURL } from '../inoxfs/mod';
import { RemoteSourceControl } from './remote-git';


const COMMIT_COMMAND = 'inox.git.commit'
const STAGE_COMMAND = 'inox.git.stage' //Should be disabled if an operation is in progress (see operationInProgress in git extension).
const REFRESH_COMMAND = 'inox.git.refresh' 

export function registerSourceControlCommands(ctx: InoxExtensionContext){

    ctx.base.subscriptions.push(
        vscode.commands.registerCommand(REFRESH_COMMAND, async () => {
            checkSourceControlDefined(ctx.sourceControl)

            await ctx.sourceControl.refreshGroups()
        }),
        vscode.commands.registerCommand(STAGE_COMMAND, (e: vscode.SourceControlResourceState) => {
            checkSourceControlDefined(ctx.sourceControl)

            ctx.sourceControl.stage(e.resourceUri.path).then(() => {
                ctx.sourceControl?.refreshGroups()
            })
        }),
        vscode.commands.registerCommand(COMMIT_COMMAND, (e) => {
            checkSourceControlDefined(ctx.sourceControl)
        }),
    )
}

export class SourceControl {

    private _scm: vscode.SourceControl
    private _indexControl: vscode.SourceControlResourceGroup
    private _workingTreeControl: vscode.SourceControlResourceGroup
    private _remote: RemoteSourceControl

    constructor(readonly ctx: InoxExtensionContext){
        this._scm =  vscode.scm.createSourceControl('git-inox', 'Git (Inox)',  makeInoxSchemeURL('/'));
        this._indexControl = this._scm.createResourceGroup('index', 'Staged Changes');
        this._workingTreeControl = this._scm.createResourceGroup('workingTree', 'Changes');

        this._scm.acceptInputCommand = {
            command: COMMIT_COMMAND,
            title: "Commit"
        }

        this._remote = new RemoteSourceControl(ctx)
        this.ctx.onProjectOpen(() => {
            this.refreshGroups()
        })
    }

    async refreshGroups() {
        this.refreshStagedChanges()
        this.refreshUnstagedChanges()
    }

    async refreshUnstagedChanges(){
        const unstagedChanges = await this._remote.getUnstagedChanges()
        if(unstagedChanges instanceof Error){
            this.ctx.debugChannel.appendLine(unstagedChanges.message)
            return
        }

        const resourceStates: vscode.SourceControlResourceState[] = []

        unstagedChanges.forEach(change => {
            resourceStates.push({
                resourceUri: makeInoxSchemeURL(change.absoluteFilepath)
            })
        })

        this._workingTreeControl.resourceStates = resourceStates //Pusing to _indexControl.resourceStated do not work.
    }

    async refreshStagedChanges(){
        const stagedChanges = await this._remote.getStagedChanges()
        if(stagedChanges instanceof Error){
            this.ctx.debugChannel.appendLine(stagedChanges.message)
            return
        }

        const resourceStates: vscode.SourceControlResourceState[] = []

        stagedChanges.forEach(change => {
            resourceStates.push({
                resourceUri: makeInoxSchemeURL(change.absoluteFilepath)
            })
        })

        this._indexControl.resourceStates = resourceStates //Pusing to _indexControl.resourceStated do not work.
    }

    async stage(absolutePath: string) {
        const error = await this._remote.stage(absolutePath)
        if(error instanceof Error){
            vscode.window.showErrorMessage('Failed to stage file: ' + error.message)
            return
        }
    }
}


function checkSourceControlDefined(sourceControl: SourceControl|undefined): asserts sourceControl is SourceControl {
    if(sourceControl === undefined){
        throw new Error(SOURCE_CONTROL_NOT_AVAILABLE_MSG)
    }
}