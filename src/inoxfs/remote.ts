import * as vscode from 'vscode';
import { InoxExtensionContext } from '../inox-extension-context';
import { DEBUG_PREFIX, INOX_FS_SCHEME } from './consts';
import { sleep } from '../utils';

const CANCELLATION_TOKEN_TIMEOUT = 5000
const ONE_SECOND_MILLIS = 1000
const DEFAULT_MAX_UPLOAD_PART_RATE = 10 //up to 10 parts each second
const UPLOAD_CANCELLATION_TOKEN_TIMEOUT = 20_000

export const MULTIPART_UPLOAD_B64_SIZE_THRESHOLD = 95_000

const uploadTimestampsWindow: number[] = []

export class Remote {

	private _ctx: InoxExtensionContext | undefined

	constructor() {
	}

	get clientRunningAndProjectOpen(): boolean {
		return (this._ctx?.lspClient !== undefined) && this._ctx.lspClient.isRunning() && this.ctx.projectOpen
	}

	get ctx() {
		if (this._ctx == undefined) {
			throw new Error('context is not set')
		}
		return this._ctx
	}

	set ctx(value: InoxExtensionContext) {
		this._ctx = value
	}

	get isUploading() {
		const now = Date.now()
		return uploadTimestampsWindow.length > 0 && (now - uploadTimestampsWindow[uploadTimestampsWindow.length - 1]) < ONE_SECOND_MILLIS
	}

	fetchDirEntries(uri: vscode.Uri) {
		const tokenSource = this.createTokenSource()

		return this.ctx.lspClient!.sendRequest('fs/readDir', {
			uri: uri.toString(),
		}, tokenSource.token).then(async entries => {
			if (entries == 'not-found') {
				return vscode.FileSystemError.FileNotFound(uri)
			}

			if (!Array.isArray(entries) || entries.some(e => typeof e != 'object')) {
				this.ctx!.outputChannel.appendLine('invalid dir entries received: ' + JSON.stringify(entries))
				return []
			}

			return entries as RemoteDirEntry[]
		})
	}

	async fetchStat(uri: vscode.Uri) {
		const tokenSource = this.createTokenSource()

		return this.ctx.lspClient!.sendRequest('fs/fileStat', {
			uri: uri.toString(),
		}, tokenSource.token).then((stats): vscode.FileStat | vscode.FileSystemError => {
			if (stats == 'not-found') {
				return vscode.FileSystemError.FileNotFound(uri)
			}

			return stats as vscode.FileStat
		})
	}

	fetchBase64Content(uri: vscode.Uri): Promise<string> {
		const tokenSource = this.createTokenSource()

		return this.ctx.lspClient!.sendRequest('fs/readFile', {
			uri: uri.toString(),
		}, tokenSource.token)
	}

	writeSinglePartFile(args: { uri: vscode.Uri, base64Content: string, create: boolean, overwrite: boolean }) {
		const tokenSource = this.createTokenSource()

		return this.ctx.lspClient!.sendRequest('fs/writeFile', {
			uri: args.uri.toString(),
			content: args.base64Content,
			create: args.create,
			overwrite: args.overwrite,
		}, tokenSource.token)
	}

	async writeMultiPartFile(args: { uri: vscode.Uri, base64Content: string, create: boolean, overwrite: boolean }) {

		if (this.clientRunningAndProjectOpen) {
			throw new Error('LSP client not running')
		}

		const lspClient = this.ctx.lspClient!

		//start upload

		const tokenSource = new vscode.CancellationTokenSource()
		setTimeout(() => {
			tokenSource.cancel()
			//tokenSource.dispose()
		}, UPLOAD_CANCELLATION_TOKEN_TIMEOUT)

		const firstPart = args.base64Content.slice(0, MULTIPART_UPLOAD_B64_SIZE_THRESHOLD)
		const resp = await lspClient.sendRequest('fs/startUpload', {
			uri: args.uri.toString(),
			content: firstPart,
			create: args.create,
			overwrite: args.overwrite,
			last: false
		}, tokenSource.token)


		if (tokenSource.token.isCancellationRequested) {
			throw vscode.FileSystemError.Unavailable('upload timeout')
		}

		const { done, uploadId } = resp as any

		if (done) {
			this.writeToDebugChannel(`unique part of ${args.uri.path} was uploaded (${firstPart.length / 1000}kB of Base64)`)
			return
		}

		this.writeToDebugChannel(`first part of ${args.uri.path} was uploaded (${firstPart.length / 1000}kB of Base64)`)

		//upload subsequent parts
		let startIndex = MULTIPART_UPLOAD_B64_SIZE_THRESHOLD
		uploadTimestampsWindow.push(Date.now())

		for (
			let endIndex = 2 * MULTIPART_UPLOAD_B64_SIZE_THRESHOLD;
			endIndex <= args.base64Content.length;
			endIndex = Math.min(endIndex + MULTIPART_UPLOAD_B64_SIZE_THRESHOLD, args.base64Content.length)) {

			const part = args.base64Content.slice(startIndex, endIndex)
			startIndex = endIndex


			if (tokenSource.token.isCancellationRequested) {
				throw vscode.FileSystemError.Unavailable('upload timeout')
			}

			if (!this.clientRunningAndProjectOpen) {
				throw vscode.FileSystemError.Unavailable(args.uri.path)
			}

			const isLast = endIndex >= args.base64Content.length

			//update uploadTimestampsWindow & pause while necessary
			while (true) {
				//remove timestamps older than one second
				while (uploadTimestampsWindow.length > 0 && (Date.now() - uploadTimestampsWindow[0]) > ONE_SECOND_MILLIS) {
					uploadTimestampsWindow.shift()
				}

				if (uploadTimestampsWindow.length >= DEFAULT_MAX_UPLOAD_PART_RATE - 1) {
					this.writeToDebugChannel(`pause upload a short time to avoid being rate limited`)
					await sleep(250)
				} else {
					break
				}
			}

			await lspClient.sendRequest('fs/writeUploadPart', {
				uri: args.uri.toString(),
				uploadId: uploadId,
				content: part,
				last: isLast
			}, tokenSource.token)

			this.writeToDebugChannel(`one part of ${args.uri.path} was uploaded (${part.length / 1000}kB of Base64)`)

			if (isLast) {
				break
			}

			//remove timestamps older than one second
			{
				const now = Date.now()
				uploadTimestampsWindow.push(Date.now())
				while (uploadTimestampsWindow.length > 0 && (now - uploadTimestampsWindow[0]) > ONE_SECOND_MILLIS) {
					uploadTimestampsWindow.shift()
				}
			}
		}
	}

	async renameFile(args: { oldUri: vscode.Uri, newUri: vscode.Uri, overwrite: boolean }): Promise<void> {
		const tokenSource = this.createTokenSource()
		return this.ctx.lspClient!.sendRequest('fs/renameFile', {
			uri: args.oldUri.toString(),
			newUri: args.newUri.toString(),
			overwrite: args.overwrite
		}, tokenSource.token)
	}

	async delete(uri: vscode.Uri): Promise<void> {
		const tokenSource = this.createTokenSource()
		return this.ctx.lspClient!.sendRequest('fs/deleteFile', {
			uri: uri.toString(),
			recursive: true
		}, tokenSource.token)
	}

	async createDir(uri: vscode.Uri): Promise<void> {
		const tokenSource = this.createTokenSource()

		return this.ctx.lspClient!.sendRequest('fs/createDir', {
			uri: uri.toString(),
		}, tokenSource.token)
	}

	private createTokenSource() {
		const tokenSource = new vscode.CancellationTokenSource()
		setTimeout(() => {
			tokenSource.cancel()
			tokenSource.dispose()
		}, CANCELLATION_TOKEN_TIMEOUT)
		return tokenSource
	}

	private writeToDebugChannel(msg: string) {
		this.ctx.debugChannel.appendLine(DEBUG_PREFIX + ' ' + msg)
	}

}

export type RemoteDirEntry = {
	name: string,
	type: vscode.FileType,
	mtime: number
}

export function assertInoxSchemeURI(uri: vscode.Uri) {
	if (uri.scheme != INOX_FS_SCHEME) {
		throw new Error(`unexpected uri ${uri.toString()}: an ${INOX_FS_SCHEME}:// scheme is expected`)
	}
}

