import * as vscode from 'vscode';
import { InoxExtensionContext } from './inox-extension-context';
import * as fs from 'fs'
import { extname, join } from 'path';

export const INOX_FS_SCHEME = "inox"
const CANCELLATION_TOKEN_TIMEOUT = 5000
const CACHED_CONTENT_EXTENSIONS = [
	//code
	'.ix', '.js', '.ts', '.html', '.css',

	//doc
	'.md', '.txt',

	//data & config
	'.json', '.yaml', '.yml'
]
const MAX_CACHED_CONTENT_SIZE = 1_000_000

const LOCAL_FILE_CACHE_STATUS_TEXT = '$(explorer-view-icon) Using local file cache'
const REMOTE_FS_STATUS_TEXT = '$(explorer-view-icon) Remote filesystem'
const DISCONNECTED_REMOTE_FS_STATUS_TEXT = '$(explorer-view-icon) Remote filesystem (disconnected)'

const DEBUG_PREFIX = `[${INOX_FS_SCHEME} FS]`

export function createAndRegisterInoxFs(ctx: InoxExtensionContext) {
	ctx.outputChannel.appendLine('create project filesystem')
	const fs = new InoxFS(ctx.debugChannel);
	ctx.base.subscriptions.push(vscode.workspace.registerFileSystemProvider(INOX_FS_SCHEME, fs, { isCaseSensitive: true }));

	ctx.debugChannel.appendLine('update workspace folders')
	vscode.workspace.updateWorkspaceFolders(1, 0, { uri: vscode.Uri.parse(`${INOX_FS_SCHEME}:/`), name: "Project FS" });
	return fs
}

export class InoxFS implements vscode.FileSystemProvider {

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _ctx: InoxExtensionContext | undefined;
	private _projectOpenDisposable?: vscode.Disposable
	private _localFileCacheDir: string | undefined
	private _useLocalFileCache = false
	private _statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)


	//TODO
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(readonly outputChannel: vscode.OutputChannel) {
	}


	async fallbackOnLocalFileCache() {
		if (this._ctx === undefined) {
			return
		}

		const projectId = this.ctx.config.project?.id
		if (projectId === undefined) {
			return
		}

		this._useLocalFileCache = true
		this.updateStatusBarItem()
		this.reOpenDocs()
	}

	private reOpenDocs() {
		this._ctx?.debugChannel.appendLine?.(DEBUG_PREFIX + ' re-open documents')
		const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
		//re-open documents in the inox filesystem because there could be errors 
		//related to the filesystem not being directly available. 
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const viewColumn = group.viewColumn

				if (tab != undefined && (tab.input instanceof vscode.TabInputText)) {
					const input = tab.input;
					if (input.uri.scheme != INOX_FS_SCHEME) {
						continue
					}
					//note: openTextDocument fires a didOpen event
					vscode.workspace.openTextDocument(input.uri).then(() => {
						vscode.window.showTextDocument(input.uri, {
							viewColumn: viewColumn,
							preserveFocus: false,
						})

						if (activeTab == tab) {
							setTimeout(() => {
								vscode.window.showTextDocument(input.uri, {
									viewColumn: viewColumn,
									preserveFocus: false,
								})
							}, 100)
						}
					})
				}
			}
		}

		//small hack
		this._emitter.fire([
			{
				type: vscode.FileChangeType.Created, uri: vscode.Uri.parse(INOX_FS_SCHEME + ':/')
			},
			{
				type: vscode.FileChangeType.Changed, uri: vscode.Uri.parse(INOX_FS_SCHEME + ':/')
			}
		])
	}

	set ctx(context: InoxExtensionContext) {
		if(this._ctx !== undefined){
			throw new Error('context already set')
		}

		this._ctx = context
		if(this._ctx.config.project?.id){
			this._localFileCacheDir = getProjectFileCacheDir(context, this._ctx.config.project.id)
		}
		this._projectOpenDisposable?.dispose()

		const projectId = this.ctx.config.project?.id
		if (projectId !== undefined) {
			const dir = getProjectFileCacheDir(this.ctx, projectId)
			fs.mkdirSync(dir, { recursive: true })
		}

		this._projectOpenDisposable = context.onProjectOpen(() => {
			this.updateStatusBarItem()
			this.reOpenDocs()
			context.lspClient?.onDidChangeState?.(() => {
				this.updateStatusBarItem()
			})
		})
	}

	get ctx() {
		if (this._ctx === undefined) {
			throw new Error('client not set')
		}
		return this._ctx
	}

	get lspClient() {
		if (this._ctx?.lspClient === undefined) {
			throw new Error('client not set')
		}
		return this._ctx.lspClient
	}


	get lspClientPresenceSuffix() {
		if (this._ctx?.lspClient === undefined) {
			return '(no LSP client)'
		}
		return ''
	}

	get clientRunningAndProjectOpen(): boolean {
		return (this._ctx?.lspClient !== undefined) && this._ctx.lspClient.isRunning() && this._ctx.projectOpen
	}


	private updateStatusBarItem() {
		if (this._useLocalFileCache) {
			if (this._statusBarItem.text != LOCAL_FILE_CACHE_STATUS_TEXT) {
				this._statusBarItem.text = LOCAL_FILE_CACHE_STATUS_TEXT
				this._statusBarItem.show()
			}
		} else if (this.clientRunningAndProjectOpen) {
			if (this._statusBarItem.text != REMOTE_FS_STATUS_TEXT) {
				this._statusBarItem.text = REMOTE_FS_STATUS_TEXT
				this._statusBarItem.show()
			}
		} else {
			if (this._statusBarItem.text != DISCONNECTED_REMOTE_FS_STATUS_TEXT) {
				this._statusBarItem.text = DISCONNECTED_REMOTE_FS_STATUS_TEXT
				this._statusBarItem.show()
			}
		}
	}

	createTokenSource() {
		const tokenSource = new vscode.CancellationTokenSource()
		setTimeout(() => {
			tokenSource.cancel()
			tokenSource.dispose()
		}, CANCELLATION_TOKEN_TIMEOUT)
		return tokenSource
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} stat ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache && this._localFileCacheDir) {
			const path = join(this._localFileCacheDir, uri.path)
			const stats = await fs.promises.stat(path)
			return {
				type: stats.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
				ctime: stats.ctime.getTime(),
				mtime: stats.mtime.getTime(),
				size: stats.size,
				permissions: vscode.FilePermission.Readonly,
			}
		}

		if (!this.clientRunningAndProjectOpen) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		const tokenSource = this.createTokenSource()

		return this.lspClient.sendRequest('fs/fileStat', {
			uri: uri.toString(),
		}, tokenSource.token).then((stats): vscode.FileStat => {
			if (stats == 'not-found') {
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			return stats as vscode.FileStat
		})
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} read dir ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache && this._localFileCacheDir) {
			const path = join(this._localFileCacheDir, uri.path)
			const entries = await fs.promises.readdir(path, {
				withFileTypes: true
			})

			return entries.map((e): [string, vscode.FileType] => [
				e.name,
				e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
			])
		}

		if (!this.clientRunningAndProjectOpen) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		const tokenSource = this.createTokenSource()

		return this.lspClient.sendRequest('fs/readDir', {
			uri: uri.toString(),
		}, tokenSource.token).then(async entries => {
			if (entries == 'not-found') {
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			if (!Array.isArray(entries) || entries.some(e => typeof e != 'object')) {
				this.outputChannel.appendLine('invalid dir entries received: ' + JSON.stringify(entries))
				return []
			}


			if (this._localFileCacheDir) {
				//create the entries of type dir in the file cache
				const dirPath = join(this._localFileCacheDir, uri.path)
				await Promise.allSettled(entries.map(async e => {
					if((e.type as vscode.FileType) == vscode.FileType.Directory){
						await fs.promises.mkdir(join(dirPath, e.name), { recursive: true })
					}
				}))
			}

			return entries.map(e => {
				const { name, type } = e
				return [name, type]
			})
		})
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} read file ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache && this._localFileCacheDir) {
			const path = join(this._localFileCacheDir, uri.path)
			return fs.promises.readFile(path)
		}

		if (!this.clientRunningAndProjectOpen) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		const tokenSource = this.createTokenSource()

		return this.lspClient.sendRequest('fs/readFile', {
			uri: uri.toString(),
		}, tokenSource.token).then(async (contentB64): Promise<Uint8Array> => {
			if (contentB64 == 'not-found') {
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			const buffer = Buffer.from((contentB64 as any).content, 'base64')

			if (this._localFileCacheDir ) {
				//put the file in the file cache
				const filePath = join(this._localFileCacheDir, uri.path)

				const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extname(uri.path))
				if(cacheContent){
					if(buffer.byteLength > MAX_CACHED_CONTENT_SIZE){
						await fs.promises.writeFile(filePath, Buffer.from("[This file has not been cached because it is too large]"))
					} else {
						await fs.promises.writeFile(filePath, buffer)
					}
				} else {
					await fs.promises.writeFile(filePath, Buffer.from("[This type of file is never cached]"))
				}
			}

			return buffer
		})
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} write file ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(uri.path)
		}

		const base64Content = Buffer.from(content).toString('base64')
		const lspClient = this.lspClient
		const tokenSource = this.createTokenSource()

		await lspClient.sendRequest('fs/writeFile', {
			uri: uri.toString(),
			content: base64Content,
			create: options.create,
			overwrite: options.overwrite,
		}, tokenSource.token)
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} rename file ${oldUri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(oldUri.path)
		}

		const tokenSource = this.createTokenSource()
		return this.lspClient.sendRequest('fs/renameFile', {
			uri: oldUri.toString(),
			newUri: newUri.toString(),
			overwrite: options.overwrite
		}, tokenSource.token)
	}

	delete(uri: vscode.Uri): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} delete file ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		const tokenSource = this.createTokenSource()
		return this.lspClient.sendRequest('fs/deleteFile', {
			uri: uri.toString(),
			recursive: true
		}, tokenSource.token)
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} create dir ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()
		const tokenSource = this.createTokenSource()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		return this.lspClient.sendRequest('fs/createDir', {
			uri: uri.toString(),
		}, tokenSource.token)
	}


	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}

}

function getProjectFileCacheDir(ctx: InoxExtensionContext, id: string) {
	return join(ctx.base.globalStorageUri.path, id)
}