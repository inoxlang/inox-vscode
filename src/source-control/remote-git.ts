import * as vscode from 'vscode';
import { InoxExtensionContext } from '../inox-extension-context';
import { stringifyCatchedValue } from '../utils';
import { Change as SourceControlChange } from './data_types';


const CANCELLATION_TOKEN_TIMEOUT = 5_000

const METHOD_NAMESPACE = 'sourceControl/'

const GET_UNSTAGED_CHANGES_METHOD = METHOD_NAMESPACE + 'getUnstagedChanges'
const GET_STAGED_CHANGES_METHOD = METHOD_NAMESPACE + 'getStagedChanges'
const STAGE_METHOD = METHOD_NAMESPACE + 'stage'
const COMMIT_METHOD = METHOD_NAMESPACE + 'commit'
const PULL_METHOD = METHOD_NAMESPACE + 'pull'
const PUSH_METHOD = METHOD_NAMESPACE + 'push'

const MAX_CACHE_VALIDITY_PERIOD_MILLIS = 3000

export class RemoteSourceControl {

    unstagedChangesCache: SourceControlChange[] = []
    stagedChangesCache: SourceControlChange[] = []
    lastUnstagedChangesUpdateTime: number = 0 //unix time millis
    lastStagedChangesUpdateTime: number = 0 //unix time millis

    constructor(readonly ctx: InoxExtensionContext){

    }

    async getUnstagedChanges(): Promise<SourceControlChange[] | Error>{
        const timeSinceLastUpdate = Date.now() - this.lastUnstagedChangesUpdateTime
        if (timeSinceLastUpdate < MAX_CACHE_VALIDITY_PERIOD_MILLIS) {
            return this.unstagedChangesCache
        }

		const tokenSource = this.createTokenSource()

        try {
            const resp = await this.ctx.lspClient!.sendRequest(GET_UNSTAGED_CHANGES_METHOD, {}, tokenSource.token)
            const response = resp as {changes: SourceControlChange[]|null}

            this.lastUnstagedChangesUpdateTime = Date.now()
            this.unstagedChangesCache = response.changes ?? []
            
            return this.unstagedChangesCache
        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }

    async getStagedChanges(): Promise<SourceControlChange[] | Error>{
        const timeSinceLastUpdate = Date.now() - this.lastStagedChangesUpdateTime
        if (timeSinceLastUpdate < MAX_CACHE_VALIDITY_PERIOD_MILLIS) {
            return this.stagedChangesCache
        }

		const tokenSource = this.createTokenSource()

        try {
            const resp = await this.ctx.lspClient!.sendRequest(GET_STAGED_CHANGES_METHOD, {}, tokenSource.token)
            const response = resp as {changes: SourceControlChange[] | null}

            this.lastStagedChangesUpdateTime = Date.now()
            this.stagedChangesCache = response.changes ?? []
            
            return this.stagedChangesCache
        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }

    async stage(absolutePath: string){
		const tokenSource = this.createTokenSource()

        this.lastStagedChangesUpdateTime = 0
        this.lastUnstagedChangesUpdateTime = 0
        

        try {
            await this.ctx.lspClient!.sendRequest(STAGE_METHOD, {
                absolutePath: absolutePath,
            }, tokenSource.token)

        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }

    async commit(message: string): Promise<void> {
        
    }

    async push(): Promise<void> {
        
    }

    async pull(): Promise<void> {
        
    }

    private createTokenSource() {
		const tokenSource = new vscode.CancellationTokenSource()

		setTimeout(() => {
			tokenSource.cancel()
			tokenSource.dispose()
		}, CANCELLATION_TOKEN_TIMEOUT)
		return tokenSource
	}
}