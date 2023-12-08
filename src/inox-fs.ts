import * as vscode from 'vscode';
import { InoxExtensionContext } from './inox-extension-context';
import * as fs from 'fs'
import { extname, join } from 'path';
import { sleep, stringifyCatchedValue } from './utils';

export const INOX_FS_SCHEME = "inox"

const DEBUG_PREFIX = `[${INOX_FS_SCHEME} FS]`

//status texts
const REMOTE_FS_STATUS_TEXT = '$(explorer-view-icon) Remote filesystem'
const DISCONNECTED_REMOTE_FS_STATUS_TEXT = '$(explorer-view-icon) Remote filesystem (disconnected)'
const LOCAL_FILE_CACHE_STATUS_TEXT = '$(explorer-view-icon) Using local file cache'

//remote filesystem
const MULTIPART_UPLOAD_B64_SIZE_THRESHOLD = 95_000
const ONE_SECOND_MILLIS = 1000
const DEFAULT_MAX_UPLOAD_PART_RATE = 10 //up to 10 parts each second
const CANCELLATION_TOKEN_TIMEOUT = 5000
const UPLOAD_CANCELLATION_TOKEN_TIMEOUT = 20_000
let uploadTimestampsWindow: number[] = []

//caching
const PROGRESSIVE_FILE_CACHING_TICK_INTERVAL_MILLIS = 2000
const MAX_CACHED_CONTENT_SIZE = 1_000_000
const CACHED_CONTENT_EXTENSIONS = [
	//code
	'.ix', '.js', '.ts', '.html', '.css',

	//doc
	'.md', '.txt',

	//data & config
	'.json', '.yaml', '.yml'
]
const MSG_TYPE_OF_FILE_NOT_CACHED = "[This type of file is never cached by default]"

//extensions of files to convert into UTF8.
const UTF8_ENCODED_EXTENSIONS  = [
	//code
	'.ix', '.js', '.ts', '.html', '.css',

	//doc
	'.md', '.txt',

	//data & config
	'.json', '.yaml', '.yml'
]

type RemoteDirEntry = {
	name: string,
	type: vscode.FileType,
	mtime: number
}

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
	private _localFileCacheDir: string | undefined //project specific cache dir
	private _useLocalFileCache = false
	private _statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)

	private fileContents = new Map<string, Uint8Array>()

	private filesToCacheProgressively = new Set<string>() //remote file paths
	private dirsToCacheProgressively = new Set<string>() //remote dir paths
	private progressiveFileCachingHandle?: NodeJS.Timer

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
		if (this._ctx.config.project?.id) {
			this._localFileCacheDir = getProjectFileCacheDir(ctx, this._ctx.config.project.id)
		}

		this._projectOpenDisposable?.dispose()

		//add disposables
		this.ctx.base.subscriptions.push(this._statusBarItem, this._emitter)

		const projectId = this.ctx.config.project?.id
		if (projectId !== undefined) {
			const dir = getProjectFileCacheDir(this.ctx, projectId)
			fs.mkdirSync(dir, { recursive: true })
		}

		this._projectOpenDisposable = ctx.onProjectOpen(() => {
			this.updateStatusBarItem()
			this.reOpenDocs()
			this.filesToCacheProgressively.clear()
			this.dirsToCacheProgressively.clear()

			if (this.progressiveFileCachingHandle !== undefined) {
				clearInterval(this.progressiveFileCachingHandle)
				this.progressiveFileCachingHandle = undefined
			}

			let lspClient = ctx.lspClient;
			if(lspClient){
				const event = lspClient.onDidChangeState(() => {
					this.updateStatusBarItem()
					//dispose the event if the LSP client has changed.
					if(this.ctx.lspClient != lspClient){
						event.dispose()
					}
				})
			}

			vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
		})
	}

	// starts periodic file caching. The interval is PROGRESSIVE_FILE_CACHING_TICK_INTERVAL_MILLIS;
	// during one tick at most one file's content is fetched.
	private startProgressiveFileCaching() {
		this.progressiveFileCachingHandle = setInterval(async () => {
			if (this.progressiveFileCachingHandle === undefined) {
				return
			}

			//stop progressive caching if the client is not running
			if (!this.clientRunningAndProjectOpen) {
				clearInterval(this.progressiveFileCachingHandle)
				this.progressiveFileCachingHandle = undefined
				return
			}

			if (this._localFileCacheDir === undefined) {
				return
			}

			const localFileCacheDir = this._localFileCacheDir

			//ignore the current tick if a upload is happening
			//TODO: only fetch content when the websocket client is idle in order to 
			//not slow down other operations.
			const now = Date.now()
			if (uploadTimestampsWindow.length > 0 && (now - uploadTimestampsWindow[uploadTimestampsWindow.length - 1]) < ONE_SECOND_MILLIS) {
				return
			}

			//fetch a single file & write the content in the cache
			for (const remotePath of this.filesToCacheProgressively) {
				this.filesToCacheProgressively.delete(remotePath)
				const localPath = join(localFileCacheDir, remotePath)

				const uri = vscode.Uri.from({
					scheme: INOX_FS_SCHEME,
					path: remotePath
				})

				try {
					//get stats of remote file & local file (cache)
					const [stats, cacheEntryStats] = await Promise.all([
						this.fetchStat(uri),
						fs.promises.stat(localPath).catch(() => null)
					])

					if (stats instanceof vscode.FileSystemError) {
						continue
					}

					//if the cache entry has been written after the last modification of the remote file
					//we do not need to cache it again & we move to the next file to cache.
					if (cacheEntryStats && cacheEntryStats.mtime.getTime() > stats.mtime) {
						this.writeToDebugChannel(`${remotePath} already cached`)
						continue
					}

					const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extname(remotePath))
					if(cacheContent){
						const contentB64 = await this.fetchBase64Content(uri)
						if (contentB64 == 'not-found') {
							break
						}
	
						const content = Buffer.from((contentB64 as any).content, 'base64')
						await this.writeFileInCache(uri, content)
					} else {
						await this.writeFileInCache(uri, Buffer.from(''))
					}
				} finally {
					break
				}
			}

			//fetch the entries of a single dir to cache
			for (const remotePath of this.dirsToCacheProgressively) {
				this.dirsToCacheProgressively.delete(remotePath)

				const uri = vscode.Uri.from({
					scheme: INOX_FS_SCHEME,
					path: remotePath
				})

				let entries: RemoteDirEntry[]
				try {
					const localPath = join(localFileCacheDir, remotePath)
					await fs.promises.mkdir(localPath, { recursive: true })

					const entriesOrError = await this.fetchDirEntries(uri)
					if (!Array.isArray(entriesOrError)) { //error
						break
					}
					entries = entriesOrError
				} catch {
					break
				}

				for (const e of entries) {
					const remoteEntryPath = join(remotePath, e.name)
					const localPath = join(localFileCacheDir, remoteEntryPath)
					const cacheEntryStats = await fs.promises.stat(localPath).catch(() => null)

					if (e.type == vscode.FileType.Directory) {
						this.dirsToCacheProgressively.add(remoteEntryPath)
					} else if (e.type == vscode.FileType.File) {
						//if the cache entry has been written after the last modification of the remote file
						//we do not need to cache it again.
						if (cacheEntryStats && cacheEntryStats?.mtime.getTime() > e.mtime) {
							this.writeToDebugChannel(`${remoteEntryPath} already cached`)
							continue
						}

						//even if the content will not be cached we add the file
						this.filesToCacheProgressively.add(remoteEntryPath)

						const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extname(remoteEntryPath))
						if(cacheContent){
							if(cacheEntryStats){
								this.writeToDebugChannel(`schedule caching of file ${remoteEntryPath} because the remote file is newer`)
							} else {
								this.writeToDebugChannel(`schedule caching of file ${remoteEntryPath}`)
							}
						} 
					}
				}
				break
			}

		}, PROGRESSIVE_FILE_CACHING_TICK_INTERVAL_MILLIS)
	}


	// This method is called by readDir. Since we want readDir to return as quickly as possible
	// the only 'awaited' IO operations performed in this function are a single fs.promises.mkdir call  
	// and a single fs.promises.readdir call. Other non-awaited IO operations are also performed.
	private async scheduleCachingOfDirEntries(uri: vscode.Uri, entries: RemoteDirEntry[]) {
		try {
			//asynchronously create the entries of type dir in the file cache
			const dirPath = join(this._localFileCacheDir!, uri.path)
			await fs.promises.mkdir(dirPath, { recursive: true })

			entries.map(e => {
				const localPath = join(dirPath, e.name)
				const remotePath = join(uri.path, e.name)

				switch (e.type as vscode.FileType) {
					case vscode.FileType.Directory:
						this.writeToDebugChannel(`schedule caching of directory ${remotePath}`)
						this.dirsToCacheProgressively.add(remotePath)

						fs.promises.mkdir(localPath, { recursive: true })
							.catch(reason => {
								this.writeToDebugChannel(+ `failed to create cache dir ${e.name}` + stringifyCatchedValue(reason))
							})
						break
					case vscode.FileType.File:
						const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extname(remotePath))
						if(cacheContent){
							this.writeToDebugChannel(`schedule caching of file ${remotePath}`)
						}
						//even if the content will not be cached we add the file
						this.filesToCacheProgressively.add(remotePath)
						break
				}
			})

			//asynchronously remove the cached files & dirs that are not in the entries returned by the server
			const entriesInCache = await fs.promises.readdir(dirPath)
			entriesInCache.map(cachedEntry => {
				if (entries.find(e => e.name == cachedEntry)) {
					return
				}
				fs.promises.rm(join(dirPath, cachedEntry), { recursive: true })
					.catch(reason => {
						this.ctx.debugChannel.appendLine(`failed to remove file cache entry for ${cachedEntry}` + stringifyCatchedValue(reason))
					})
			})
		} catch (err) {
			this.ctx.debugChannel.appendLine(stringifyCatchedValue(err))
		}
	}

	clearFileCache() {
		if (this._localFileCacheDir) {
			return fs.promises.rm(this._localFileCacheDir, { recursive: true })
		}
	}

	get fileCacheDir() {
		return this._localFileCacheDir
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

		return this.fetchStat(uri).then(stat => {
			if (stat instanceof vscode.FileSystemError) {
				throw stat
			}
			return stat
		})
	}


	private async fetchStat(uri: vscode.Uri) {
		const tokenSource = this.createTokenSource()

		return this.lspClient.sendRequest('fs/fileStat', {
			uri: uri.toString(),
		}, tokenSource.token).then((stats): vscode.FileStat | vscode.FileSystemError => {
			if (stats == 'not-found') {
				return vscode.FileSystemError.FileNotFound(uri)
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

		return this.fetchDirEntries(uri).then(async entries => {
			if (!Array.isArray(entries)) {
				//error
				throw entries
			}

			if (this._localFileCacheDir) {
				await this.scheduleCachingOfDirEntries(uri, entries)
			}

			return entries.map(e => {
				const { name, type } = e
				return [name, type]
			})
		})
	}

	private fetchDirEntries(uri: vscode.Uri) {
		const tokenSource = this.createTokenSource()

		return this.lspClient.sendRequest('fs/readDir', {
			uri: uri.toString(),
		}, tokenSource.token).then(async entries => {
			if (entries == 'not-found') {
				return vscode.FileSystemError.FileNotFound(uri)
			}

			if (!Array.isArray(entries) || entries.some(e => typeof e != 'object')) {
				this.outputChannel.appendLine('invalid dir entries received: ' + JSON.stringify(entries))
				return []
			}

			return entries as RemoteDirEntry[]
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

		return this.fetchBase64Content(uri).then(async (contentB64): Promise<Uint8Array> => {
			if (contentB64 == 'not-found') {
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			const buffer = Buffer.from((contentB64 as any).content, 'base64')
			this.fileContents.set(uri.path, buffer)

			if (this._localFileCacheDir) {
				this.writeFileInCache(uri, buffer)
			}

			return buffer
		})
	}

	private fetchBase64Content(uri: vscode.Uri): Promise<string> {
		const tokenSource = this.createTokenSource()

		return this.lspClient.sendRequest('fs/readFile', {
			uri: uri.toString(),
		}, tokenSource.token)
	}

	async writeFileInCache(uri: vscode.Uri, buffer: Uint8Array) {
		if (this._localFileCacheDir === undefined) {
			return
		}

		const localFilePath = join(this._localFileCacheDir, uri.path)
		const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extname(uri.path))

		try {
			if (cacheContent) {
				if (buffer.byteLength > MAX_CACHED_CONTENT_SIZE) {
					await fs.promises.writeFile(localFilePath, Buffer.from("[This file has not been cached because it is too large]"))
				} else {
					await fs.promises.writeFile(localFilePath, buffer)
				}
			} else {
				await fs.promises.writeFile(localFilePath, Buffer.from(MSG_TYPE_OF_FILE_NOT_CACHED))
			}
		} catch (reason) {
			this.ctx.debugChannel.appendLine(`failed to write file cache entry for ${uri.path}` + stringifyCatchedValue(reason))
		}
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		this.outputChannel.appendLine(`${DEBUG_PREFIX} write file ${uri.toString()} ${this.lspClientPresenceSuffix}`)
		this.updateStatusBarItem()

		if (this._useLocalFileCache) {
			throw vscode.FileSystemError.Unavailable(uri.path)
		}

		if (this._localFileCacheDir) {
			this.writeFileInCache(uri, content)
		}

		var sentContent: Buffer
		const convertToUTF8 = UTF8_ENCODED_EXTENSIONS.includes(extname(uri.path))

		if(convertToUTF8){
			//UTF16(BE) BOM
			if(content.at(0) == 254 && content.at(1) == 255){
				const utf16 = Buffer.from(content) //big endian
				utf16.swap16() //convert to little endian
	
				const s = Buffer.from(utf16).toString('utf16le')
				sentContent = Buffer.from(new TextEncoder().encode(s))
			//UTF16(LE) BOM
			} else if(content.at(0) == 255 && content.at(1) == 254) {
				const s = Buffer.from(content).toString('utf16le')
				sentContent = Buffer.from(new TextEncoder().encode(s))
			} else {
				sentContent = Buffer.from(content)
			}

			//remove UTF8 BOM
			if(sentContent.at(0) == 239 && sentContent.at(1) == 187 && sentContent.at(2) == 191){ 
				sentContent = sentContent.slice(3)
			}
		} else {
			sentContent = Buffer.from(content)
		}


		const base64Content = sentContent.toString('base64')
		const lspClient = this.lspClient

		if (base64Content.length < MULTIPART_UPLOAD_B64_SIZE_THRESHOLD) {
			const tokenSource = this.createTokenSource()

			await lspClient.sendRequest('fs/writeFile', {
				uri: uri.toString(),
				content: base64Content,
				create: options.create,
				overwrite: options.overwrite,
			}, tokenSource.token)
		} else {
			//start upload

			const tokenSource = new vscode.CancellationTokenSource()
			setTimeout(() => {
				tokenSource.cancel()
				//tokenSource.dispose()
			}, UPLOAD_CANCELLATION_TOKEN_TIMEOUT)

			const firstPart = base64Content.slice(0, MULTIPART_UPLOAD_B64_SIZE_THRESHOLD)
			const resp = await lspClient.sendRequest('fs/startUpload', {
				uri: uri.toString(),
				content: firstPart,
				create: options.create,
				overwrite: options.overwrite,
				last: false
			}, tokenSource.token)


			if (tokenSource.token.isCancellationRequested) {
				throw vscode.FileSystemError.Unavailable('upload timeout')
			}

			const { done, uploadId } = resp as any

			if (done) {
				this.writeToDebugChannel(`unique part of ${uri.path} was uploaded (${firstPart.length / 1000}kB of Base64)`)
				return
			}

			this.writeToDebugChannel(`first part of ${uri.path} was uploaded (${firstPart.length / 1000}kB of Base64)`)

			//upload subsequent parts
			let startIndex = MULTIPART_UPLOAD_B64_SIZE_THRESHOLD
			uploadTimestampsWindow.push(Date.now())

			for (
				let endIndex = 2 * MULTIPART_UPLOAD_B64_SIZE_THRESHOLD;
				endIndex <= base64Content.length;
				endIndex = Math.min(endIndex + MULTIPART_UPLOAD_B64_SIZE_THRESHOLD, base64Content.length)) {

				const part = base64Content.slice(startIndex, endIndex)
				startIndex = endIndex


				if (tokenSource.token.isCancellationRequested) {
					throw vscode.FileSystemError.Unavailable('upload timeout')
				}

				if (!this.clientRunningAndProjectOpen) {
					throw vscode.FileSystemError.Unavailable(uri.path)
				}

				const isLast = endIndex >= base64Content.length

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
					uri: uri.toString(),
					uploadId: uploadId,
					content: part,
					last: isLast
				}, tokenSource.token)

				this.writeToDebugChannel(`one part of ${uri.path} was uploaded (${part.length / 1000}kB of Base64)`)

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


	writeToDebugChannel(msg: string) {
		this.ctx.debugChannel.appendLine(DEBUG_PREFIX + ' ' + msg)
	}

}

function getProjectFileCacheDir(ctx: InoxExtensionContext, id: string) {
	return join(ctx.base.globalStorageUri.path, id)
}


