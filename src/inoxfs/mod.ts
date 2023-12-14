import * as vscode from 'vscode';
import { InoxExtensionContext } from '../inox-extension-context';
import { extname as extnamePosix } from 'path/posix';

import { DEBUG_PREFIX, INOX_FS_SCHEME } from './consts'
import { PersistedFileCache as OnDiskFileCache } from './cache';
import { MULTIPART_UPLOAD_B64_SIZE_THRESHOLD, Remote } from './remote';
import { truncateSync } from 'fs';
export { INOX_FS_SCHEME } from './consts'

//status texts
const REMOTE_FS_STATUS_TEXT = '$(explorer-view-icon) Remote filesystem'
const DISCONNECTED_REMOTE_FS_STATUS_TEXT = '$(explorer-view-icon) Remote filesystem (disconnected)'
const LOCAL_FILE_CACHE_STATUS_TEXT = '$(explorer-view-icon) Using local file cache'

//extensions of files to convert into UTF8.
const UTF8_ENCODED_EXTENSIONS = [
	//code
	'.ix', '.js', '.ts', '.html', '.css',

	//doc
	'.md', '.txt',

	//data & config
	'.json', '.yaml', '.yml'
]

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
	private _useLocalFileCache = false
	private _statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
	private _cache?: OnDiskFileCache
	private _remote = new Remote()
	private _recentStructureChangesCausedByUser: {uri: vscode.Uri, date: Date}[] = []
	private _lastExploreRefresh: Date | undefined


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

				if (tab === undefined || !(tab.input instanceof vscode.TabInputText)) {
					continue
				}

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

	set ctx(ctx: InoxExtensionContext) {
		if (this._ctx !== undefined) {
			throw new Error('context already set')
		}

		this._ctx = ctx
		this._remote.ctx = ctx
		const projectId = this.ctx.config.project?.id

		if (projectId) {
			this._cache = new OnDiskFileCache(ctx, this._remote, projectId)
		}

		this._projectOpenDisposable?.dispose()

		//add disposables
		this.ctx.base.subscriptions.push(this._statusBarItem, this._emitter)

		this._projectOpenDisposable = ctx.onProjectOpen(() => {
			this.updateStatusBarItem()
			this.reOpenDocs()
			this._cache?.stopCurrentProgressiveFileCaching()

			let lspClient = ctx.lspClient;
			if (lspClient) {
				const event = lspClient.onDidChangeState(() => {
					this.updateStatusBarItem()
					//dispose the event if the LSP client has changed.
					if (this.ctx.lspClient != lspClient) {
						event.dispose()
						notifDisposable.dispose()
					}
				})

				//refresh the file explorer each time there is a structure change that is not caused by the user.
				const notifDisposable = lspClient.onNotification("fs/structureEvent", event => {
					this.removeOldStructureChanges()

					//ignore event if caused by user.
					for(const change of this._recentStructureChangesCausedByUser){
						if(change.uri.path == event.path){
							return
						}
					}

					//don't refresh the explorer if it has been refreshed less than 500 milliseconds ago.
					if(this._lastExploreRefresh && (Date.now() - this._lastExploreRefresh.getTime()) < 500){
						return
					}

					this.outputChannel.appendLine(`${DEBUG_PREFIX} refresh file explorer because ${event.path} changed remotely (not caused by user)`)
					vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
				})
			}

			this._cache?.startProgressiveFileCaching()
			vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
		})
	}

	clearFileCache() {
		return this._cache?.clearOnDiskCache()
	}

	get fileCacheDir() {
		return this._cache?.fileCacheDir
	}

	get ctx() {
		if (this._ctx === undefined) {
			throw new Error('client not set')
		}
		return this._ctx
	}

	private get lspClientPresenceSuffix() {
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

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} stat ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache && this._cache) {
			const stats = await this._cache.statFromCache(uri)
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

		return this._remote.fetchStat(uri).then(stat => {
			if (stat instanceof vscode.FileSystemError) {
				throw stat
			}
			return stat
		})
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} read dir ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache && this._cache) {
			const entries = await this._cache.readDirFromCache(uri)
			return entries.map((e): [string, vscode.FileType] => [
				e.name,
				e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File
			])
		}

		if (!this.clientRunningAndProjectOpen) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		return this._remote.fetchDirEntries(uri).then(async entries => {
			if (!Array.isArray(entries)) {
				//error
				throw entries
			}

			if (this._cache) {
				await this._cache.scheduleCachingOfDirEntries(uri, entries)
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

		if (this._useLocalFileCache && this._cache) {
			return this._cache.readFileFromCache(uri)
		}

		if (!this.clientRunningAndProjectOpen) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		return this._remote.fetchBase64Content(uri).then(async (contentB64): Promise<Uint8Array> => {
			if (contentB64 == 'not-found') {
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			const buffer = Buffer.from((contentB64 as any).content, 'base64')

			if (this._cache) {
				this._cache.setFileContent(uri, buffer)
				this._cache.writeFileInCache(uri, buffer)
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

		if (this._cache) {
			this._cache.writeFileInCache(uri, content)
		}

		var sentContent: Buffer
		const convertToUTF8 = UTF8_ENCODED_EXTENSIONS.includes(extnamePosix(uri.path))

		if (convertToUTF8) {
			//UTF16(BE) BOM
			if (content.at(0) == 254 && content.at(1) == 255) {
				const utf16 = Buffer.from(content) //big endian
				utf16.swap16() //convert to little endian

				const s = Buffer.from(utf16).toString('utf16le')
				sentContent = Buffer.from(new TextEncoder().encode(s))
				//UTF16(LE) BOM
			} else if (content.at(0) == 255 && content.at(1) == 254) {
				const s = Buffer.from(content).toString('utf16le')
				sentContent = Buffer.from(new TextEncoder().encode(s))
			} else {
				sentContent = Buffer.from(content)
			}

			//remove UTF8 BOM
			if (sentContent.at(0) == 239 && sentContent.at(1) == 187 && sentContent.at(2) == 191) {
				sentContent = sentContent.slice(3)
			}
		} else {
			sentContent = Buffer.from(content)
		}

		const base64Content = sentContent.toString('base64')

		if (base64Content.length < MULTIPART_UPLOAD_B64_SIZE_THRESHOLD) {
			await this._remote.writeSinglePartFile({
				uri: uri,
				base64Content: base64Content,
				create: options.create,
				overwrite: options.overwrite,
			})
		} else {
			await this._remote.writeMultiPartFile({
				uri: uri,
				base64Content: base64Content,
				create: options.create,
				overwrite: options.overwrite,
			})
		}

		//TODO: only record the change if the file is created by the write operation,
		//otherwise if the file is deleted by some logic on the server the change will no be visible instantly.
		this.enqueueStructureChangeCausedByUser(uri)
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} rename file ${oldUri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(oldUri.path)
		}

		this.enqueueStructureChangeCausedByUser(oldUri)
		this.enqueueStructureChangeCausedByUser(newUri)

		return this._remote.renameFile({
			oldUri: oldUri,
			newUri: newUri,
			overwrite: options.overwrite,
		})
	}

	delete(uri: vscode.Uri): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} delete file ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		this.enqueueStructureChangeCausedByUser(uri)
		return this._remote.delete(uri)
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} create dir ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(uri)
		}

		this.enqueueStructureChangeCausedByUser(uri)
		return this._remote.createDir(uri)
	}

	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}


	private removeOldStructureChanges(){
		//remove old structured changes
		const now = new Date()
		while(this._recentStructureChangesCausedByUser.length > 0 && 
			(now.getTime() - this._recentStructureChangesCausedByUser[0].date.getTime() > 1000)){			
			
			this._recentStructureChangesCausedByUser.shift()
		}
	}

	private enqueueStructureChangeCausedByUser(uri: vscode.Uri){
		this.removeOldStructureChanges()
		//add new change
		const now = new Date()

		this._recentStructureChangesCausedByUser.push({
			date: now,
			uri: uri,
		})
	}

}
