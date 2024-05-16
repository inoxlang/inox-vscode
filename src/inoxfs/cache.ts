import * as vscode from 'vscode';
import { join } from 'path';
import { join as joinPosix, extname as extnamePosix, basename as basenamePosix } from 'path/posix'
import * as fs from 'fs'

import { InoxExtensionContext } from '../inox-extension-context';
import { INOX_FS_SCHEME } from './consts';
import { stringifyCatchedValue } from '../utils';
import { Remote, RemoteDirEntry, assertInoxSchemeURI } from './remote';

export const FILE_CACHING_LOG_PREFIX = `[File Caching]`


//caching
const PROGRESSIVE_FILE_CACHING_TICK_INTERVAL_MILLIS = 2000
const MAX_CACHED_CONTENT_SIZE = 1_000_000
const CACHED_CONTENT_EXTENSIONS = [
    //code
    '.ix', '.js', '.ts', '._hs', '.html', '.css',

    //doc
    '.md', '.txt',

    //data & config
    '.json', '.yaml', '.yml'
]
const MSG_TYPE_OF_FILE_NOT_CACHED = "[This type of file is never cached by default]"
const IGNORED_FOLDER_NAMES = ['.git']

export class PersistedFileCache {
    private _localFileCacheDir: string //project specific cache dir
    private _fileContents = new Map<string, Uint8Array>()
    private _filesToCacheProgressively = new Set<string>() //remote file paths
    private _dirsToCacheProgressively = new Set<string>() //remote dir paths
    private _progressiveFileCachingHandle?: NodeJS.Timer


    constructor(readonly ctx: InoxExtensionContext, readonly remote: Remote, projectId: string, ) {
        this._localFileCacheDir = getProjectFileCacheDir(ctx, projectId)
        fs.mkdirSync(this._localFileCacheDir, { recursive: true })
    }

    get fileCacheDir() {
        return this._localFileCacheDir
    }

    // starts periodic file caching. The interval is PROGRESSIVE_FILE_CACHING_TICK_INTERVAL_MILLIS;
    // during one tick at most one file's content is fetched.
    startProgressiveFileCaching() {
        this._progressiveFileCachingHandle = setInterval(async () => {
            //tick

            if (this._progressiveFileCachingHandle === undefined) {
                return
            }

            //stop progressive caching if the client is not running
            if (!this.remote.clientRunningAndProjectOpen) {
                clearInterval(this._progressiveFileCachingHandle)
                this._progressiveFileCachingHandle = undefined
                return
            }

            if (this._localFileCacheDir === undefined) {
                return
            }

            const localFileCacheDir = this._localFileCacheDir

            //ignore the current tick if a upload is happening
            //TODO: only fetch content when the websocket client is idle in order to 
            //not slow down other operations.
            if(this.remote.isUploading){
                return
            }

            //fetch a single file & write the content in the cache
            for (const remotePath of this._filesToCacheProgressively) {
                this._filesToCacheProgressively.delete(remotePath)
                const localPath = join(localFileCacheDir, remotePath)

                const uri = vscode.Uri.from({
                    scheme: INOX_FS_SCHEME,
                    path: remotePath
                })

                try {
                    //get stats of remote file & local file (cache)
                    const [stats, cacheEntryStats] = await Promise.all([
                        this.remote.fetchStat(uri),
                        fs.promises.stat(localPath).catch(() => null)
                    ])

                    if (stats instanceof vscode.FileSystemError) {
                        continue
                    }

                    const shouldCacheContent = CACHED_CONTENT_EXTENSIONS.includes(extnamePosix(remotePath))

                    //if the cache entry has been written after the last modification of the remote file
                    //we do not need to cache it again & we move to the next file to cache.
                    if (cacheEntryStats && cacheEntryStats.mtime.getTime() > stats.mtime) {
                        this.writeToDebugChannel(`${remotePath} already cached${shouldCacheContent ? '' :' (content never cached)'}`)
                        continue
                    }

                    if (shouldCacheContent) {
                        const contentB64 = await this.remote.fetchBase64Content(uri)
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
            for (const remotePath of this._dirsToCacheProgressively) {
                this._dirsToCacheProgressively.delete(remotePath)

                const uri = vscode.Uri.from({
                    scheme: INOX_FS_SCHEME,
                    path: remotePath
                })

                let entries: RemoteDirEntry[]
                try {
                    const localPath = join(localFileCacheDir, remotePath)
                    await fs.promises.mkdir(localPath, { recursive: true })

                    const entriesOrError = await this.remote.fetchDirEntries(uri)
                    if (!Array.isArray(entriesOrError)) { //error
                        break
                    }
                    entries = entriesOrError
                } catch {
                    break
                }

                for (const e of entries) {
                    const remoteEntryPath = joinPosix(remotePath, e.name)
                    const localPath = join(localFileCacheDir, remoteEntryPath)
                    const cacheEntryStats = await fs.promises.stat(localPath).catch(() => null)

                    if (e.type == vscode.FileType.Directory) {
                        this._dirsToCacheProgressively.add(remoteEntryPath)
                    } else if (e.type == vscode.FileType.File) {
                        //if the cache entry has been written after the last modification of the remote file
                        //we do not need to cache it again.
                        if (cacheEntryStats && cacheEntryStats?.mtime.getTime() > e.mtime) {
                            this.writeToDebugChannel(`${remoteEntryPath} already cached`)
                            continue
                        }

                        //even if the content will not be cached we add the file
                        this._filesToCacheProgressively.add(remoteEntryPath)

                        const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extnamePosix(remoteEntryPath))
                        if (cacheContent) {
                            if (cacheEntryStats) {
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


    stopCurrentProgressiveFileCaching() {
        this._filesToCacheProgressively.clear()
        this._dirsToCacheProgressively.clear()

        if (this._progressiveFileCachingHandle !== undefined) {
            clearInterval(this._progressiveFileCachingHandle)
            this._progressiveFileCachingHandle = undefined
        }
    }

    // This method is called by readDir. Since we want readDir to return as quickly as possible
    // the only 'awaited' IO operations performed in this function are a single fs.promises.mkdir call  
    // and a single fs.promises.readdir call. Other non-awaited IO operations are also performed.
    async scheduleCachingOfDirEntries(uri: vscode.Uri, entries: RemoteDirEntry[]) {

        if(IGNORED_FOLDER_NAMES.includes(basenamePosix(uri.path))){
            return
        }

        //Remove ignored folders.
        entries = entries.filter(e => !(e.type == vscode.FileType.Directory && IGNORED_FOLDER_NAMES.includes(basenamePosix(e.name))))

        try {
            //asynchronously create the entries of type dir in the file cache
            const dirPath = join(this._localFileCacheDir!, uri.path)
            await fs.promises.mkdir(dirPath, { recursive: true })

            entries.map(e => {
                const localPath = join(dirPath, e.name)
                const remotePath = joinPosix(uri.path, e.name)

                switch (e.type as vscode.FileType) {
                    case vscode.FileType.Directory:
                        this.writeToDebugChannel(`schedule caching of directory ${remotePath}`)
                        this._dirsToCacheProgressively.add(remotePath)

                        fs.promises.mkdir(localPath, { recursive: true })
                            .catch(reason => {
                                this.writeToDebugChannel(+ `failed to create cache dir ${e.name}` + stringifyCatchedValue(reason))
                            })
                        break
                    case vscode.FileType.File:
                        const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extnamePosix(remotePath))
                        if (cacheContent) {
                            this.writeToDebugChannel(`schedule caching of file ${remotePath}`)
                        }
                        //even if the content will not be cached we add the file
                        this._filesToCacheProgressively.add(remotePath)
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

    setFileContent(uri: vscode.Uri, buffer: Uint8Array) {
        this._fileContents.set(uri.path, buffer)
    }

    async writeFileInCache(uri: vscode.Uri, buffer: Uint8Array) {
        assertInoxSchemeURI(uri)


        const localFilePath = join(this._localFileCacheDir, uri.path)
        const cacheContent = CACHED_CONTENT_EXTENSIONS.includes(extnamePosix(uri.path))

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

    async readFileFromCache(uri: vscode.Uri) {
        assertInoxSchemeURI(uri)
        const path = join(this._localFileCacheDir, uri.path)
        return fs.promises.readFile(path)
    }

    async statFromCache(uri: vscode.Uri) {
        assertInoxSchemeURI(uri)
        const path = join(this._localFileCacheDir, uri.path)
        return fs.promises.stat(path)
    }

    async readDirFromCache(uri: vscode.Uri) {
        assertInoxSchemeURI(uri)

        const path = join(this._localFileCacheDir, uri.path)
        return fs.promises.readdir(path, {
            withFileTypes: true
        })
    }


    clearOnDiskCache() {
        if (this._localFileCacheDir) {
            return fs.promises.rm(this._localFileCacheDir, { recursive: true })
        }
    }

    private writeToDebugChannel(msg: string) {
        this.ctx.debugChannel.appendLine(FILE_CACHING_LOG_PREFIX + ' ' + msg)
    }
}


function getProjectFileCacheDir(ctx: InoxExtensionContext, id: string) {
    return join(ctx.base.globalStorageUri.fsPath, id)
}


