import * as vscode from 'vscode';
import { InoxExtensionContext } from '../inox-extension-context';
import { stringifyCatchedValue } from '../utils';
import { CommitInfo, ChangeInfo as SourceControlChange } from './data_types';


const CANCELLATION_TOKEN_TIMEOUT = 5_000

const METHOD_NAMESPACE = 'sourceControl/'

const GET_UNSTAGED_CHANGES_METHOD = METHOD_NAMESPACE + 'getUnstagedChanges'
const GET_STAGED_CHANGES_METHOD = METHOD_NAMESPACE + 'getStagedChanges'
const STAGE_METHOD = METHOD_NAMESPACE + 'stage'
const UNSTAGE_METHOD = METHOD_NAMESPACE + 'unstage'
const COMMIT_METHOD = METHOD_NAMESPACE + 'commit'
const GET_LAST_DEV_COMMIT_METHOD = METHOD_NAMESPACE + 'getLastDevCommit'
const GET_DEV_LOG_COMMIT = METHOD_NAMESPACE + 'getDevLog'

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

    async stage(absolutePaths: string[]){
		const tokenSource = this.createTokenSource()

        this.lastStagedChangesUpdateTime = 0
        this.lastUnstagedChangesUpdateTime = 0
        

        try {
            await this.ctx.lspClient!.sendRequest(STAGE_METHOD, {
                absolutePaths: absolutePaths,
            }, tokenSource.token)

        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }


    async unstage(absolutePaths: string[]){
		const tokenSource = this.createTokenSource()

        this.lastStagedChangesUpdateTime = 0
        this.lastUnstagedChangesUpdateTime = 0
        

        try {
            await this.ctx.lspClient!.sendRequest(UNSTAGE_METHOD, {
                absolutePaths: absolutePaths,
            }, tokenSource.token)

        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }

    async commit(message: string) {
        const tokenSource = this.createTokenSource()

        this.lastStagedChangesUpdateTime = 0
        this.lastUnstagedChangesUpdateTime = 0

        try {
            await this.ctx.lspClient!.sendRequest(COMMIT_METHOD, {
                message: message,
            }, tokenSource.token)

        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }

    async getLastDevCommitHash(): Promise<CommitInfo|null|Error> {
        const tokenSource = this.createTokenSource()

        this.lastStagedChangesUpdateTime = 0
        this.lastUnstagedChangesUpdateTime = 0

        try {
            const resp = await this.ctx.lspClient!.sendRequest(GET_LAST_DEV_COMMIT_METHOD, {}, tokenSource.token)

            if(resp === null || typeof resp != 'object'){
                return new Error('LSP server returned an unexpected representation for the last dev commit.')
            }

            const record = resp as Record<string, any>

            if(record.commit === undefined || record.commit === null){
                //No last commit.
                return null
            }

            if(typeof record.commit != 'object'){
                return new Error('LSP returned an unexpected representation for the last dev commit.')
            }

            return this.makeCommitInfo(record.commit)
        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }

    async getDevLog(fromHashHex: string): Promise<CommitInfo[]|Error> {
        const tokenSource = this.createTokenSource()

        this.lastStagedChangesUpdateTime = 0
        this.lastUnstagedChangesUpdateTime = 0

        try {
            const resp = await this.ctx.lspClient!.sendRequest(GET_DEV_LOG_COMMIT, {
                fromHashHex: fromHashHex,
            }, tokenSource.token)

            if(resp === null || typeof resp != 'object'){
                return new Error('LSP server returned an unexpected representation for the commit log.')
            }

            const record = resp as Record<string, any>

            if(!Array.isArray(record.commits)){
                return new Error('LSP server returned an unexpected representation for the commit log.')
            }

            return record.commits.map(this.makeCommitInfo)
        } catch(reason){
            return new Error(stringifyCatchedValue(reason))
        }
    }


    async push(): Promise<void> {
        
    }

    async pull(): Promise<void> {
        
    }

    private makeCommitInfo(commit: Record<string, any>): CommitInfo {
        const author = commit.author
        const committer = commit.committer

        return {
            author: {
                name: author.name,
                email: author.email,
                when: Date.parse(author.when),
            },
            committer: {
                name: committer.name,
                email: committer.email,
                when: Date.parse(committer.when),
            },
            hashHex: commit.hashHex,
            message: commit.message
        }
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