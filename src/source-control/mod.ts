import * as vscode from 'vscode';
import { SOURCE_CONTROL_NOT_AVAILABLE_MSG } from '../errors';
import { InoxExtensionContext } from '../inox-extension-context';
import { makeInoxSchemeURL } from '../inoxfs/mod';
import { RemoteSourceControl } from './remote-git';
import { CommitInfo } from './data_types';


const COMMIT_COMMAND = 'inox.scm.commit'
const STAGE_COMMAND = 'inox.scm.stage' //Should be disabled if an operation is in progress (see operationInProgress in git extension).
const UNSTAGE_COMMAND = 'inox.scm.unstage' //Should be disabled if an operation is in progress (see operationInProgress in git extension).
const REFRESH_COMMAND = 'inox.scm.refresh'
const SHOW_LOG_COMMAND = 'inox.scm.show-log'


export function registerSourceControlCommands(ctx: InoxExtensionContext) {

    ctx.base.subscriptions.push(
        vscode.commands.registerCommand(REFRESH_COMMAND, async () => {
            checkSourceControlDefined(ctx.sourceControl)

            await ctx.sourceControl.refreshGroups()
        }),
        vscode.commands.registerCommand(STAGE_COMMAND, (...entries: vscode.SourceControlResourceState[]) => {
            checkSourceControlDefined(ctx.sourceControl)

            const paths = entries.map(e => e.resourceUri.path)
            ctx.sourceControl.stage(paths).then(() => {
                ctx.sourceControl?.refreshGroups()
            })
        }),
        vscode.commands.registerCommand(UNSTAGE_COMMAND, (...entries: vscode.SourceControlResourceState[]) => {
            checkSourceControlDefined(ctx.sourceControl)

            const paths = entries.map(e => e.resourceUri.path)

            ctx.sourceControl.unstage(paths).then(() => {
                ctx.sourceControl?.refreshGroups()
            })
        }),
        vscode.commands.registerCommand(COMMIT_COMMAND, (control: vscode.SourceControl) => {
            checkSourceControlDefined(ctx.sourceControl)

            ctx.sourceControl.commit(control.inputBox.value).then(() => {
                ctx.sourceControl?.refreshGroups()
            })
        }),
        vscode.commands.registerCommand(SHOW_LOG_COMMAND, async (e) => {
            checkSourceControlDefined(ctx.sourceControl)

            const result = await ctx.sourceControl.getLastDevCommitHash()
            if(result === null){
                vscode.window.showInformationMessage('No last dev commit')
                return
            }
            if(result instanceof Error){
                vscode.window.showErrorMessage('Failed to get last dev commit: ' + result.message)
                return
            }
            const logResult = await ctx.sourceControl.getDevLog(result)
            if(logResult instanceof Error){
                vscode.window.showErrorMessage('Failed to get dev commit log: ' + logResult.message)
                return
            }

            vscode.window.showInformationMessage(  logResult.map(commit => commit.message).join('||'))
        }),
    )
}

export class SourceControl {

    private _scm: vscode.SourceControl
    private _indexControl: vscode.SourceControlResourceGroup
    private _workingTreeControl: vscode.SourceControlResourceGroup
    private _remote: RemoteSourceControl

    constructor(readonly ctx: InoxExtensionContext) {
        this._scm = vscode.scm.createSourceControl('git-inox', 'Git (Inox)', makeInoxSchemeURL('/'));
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

    async refreshUnstagedChanges() {
        const unstagedChanges = await this._remote.getUnstagedChanges()
        if (unstagedChanges instanceof Error) {
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

    async refreshStagedChanges() {
        const stagedChanges = await this._remote.getStagedChanges()
        if (stagedChanges instanceof Error) {
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

    async stage(absolutePaths: string[]) {
        const error = await this._remote.stage(absolutePaths)
        if (error instanceof Error) {
            vscode.window.showErrorMessage('Failed to stage file or folder: ' + error.message)
            return
        }
    }

    async unstage(absolutePaths: string[]) {
        const error = await this._remote.unstage(absolutePaths)
        if (error instanceof Error) {
            vscode.window.showErrorMessage('Failed to unstage file or folder: ' + error.message)
            return
        }
    }

    async commit(message: string) {
        const error = await this._remote.commit(message)
        if (error instanceof Error) {
            vscode.window.showErrorMessage('Failed to commit: ' + error.message)
            return
        }
    }

    async getLastDevCommitHash(): Promise<string | null | Error> {
        const result = await this._remote.getLastDevCommitHash()
        if (result instanceof Error) {
            return result
        }
        if (result == null) {
            return null
        }
        return result.hashHex
    }

    async getDevLog(fromHashHex: string): Promise<CommitInfo[]|Error>{
        const result = await this._remote.getDevLog(fromHashHex)
        if (result instanceof Error) {
            return result
        }
        return result
    }
}


function checkSourceControlDefined(sourceControl: SourceControl | undefined): asserts sourceControl is SourceControl {
    if (sourceControl === undefined) {
        throw new Error(SOURCE_CONTROL_NOT_AVAILABLE_MSG)
    }
}