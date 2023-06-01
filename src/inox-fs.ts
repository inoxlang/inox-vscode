import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

export const REMOTE_FS_SCHEME = "remotefs"


export class RemoteFS implements vscode.FileSystemProvider {

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _client: LanguageClient|undefined;

	//TODO
	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(readonly outputChannel: vscode.OutputChannel){

	}


	set lspClient(client: LanguageClient){
		this._client = client
	}

	get lspClient(){
		if(this._client === undefined){
			throw new Error('client not set')
		}
		return this._client
	}

	stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		return this.lspClient.sendRequest('fs/fileStat', {
			uri: uri.toString(),
		}).then((stats): vscode.FileStat => {
			if(stats == 'not-found'){
				throw vscode.FileSystemError.FileNotFound(uri)
			}
			return stats as vscode.FileStat
		})
	}

	readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		return this.lspClient.sendRequest('fs/readDir', {
			uri: uri.toString(),
		}).then((entries) => {
			if(entries == 'not-found'){
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			if(! Array.isArray(entries) || entries.some(e => typeof e != 'object')){
				this.outputChannel.appendLine('invalid dir entries received: ' + JSON.stringify(entries))
				return []
			}

			return entries.map(e => {
				const {name, type} = e
				return [name, type]
			})
		})
	}

	readFile(uri: vscode.Uri): Promise<Uint8Array> {
		return this.lspClient.sendRequest('fs/readFile', {
			uri: uri.toString(),
		}).then((contentB64): Uint8Array => {
			if(contentB64 == 'not-found'){
				throw vscode.FileSystemError.FileNotFound(uri)
			}

			return Buffer.from((contentB64 as any).content, 'base64')
		})
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		return this.lspClient.sendRequest('fs/writeFile', {
			uri: uri.toString(),
			content: Buffer.from(content).toString('base64'),
			create: options.create,
			overwrite: options.overwrite
		})
	}

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		return this.lspClient.sendRequest('fs/renameFile', {
			uri: oldUri.toString(),
			newUri: newUri.toString(),
			overwrite: options.overwrite
		})
	}

	delete(uri: vscode.Uri): Promise<void> {
		return this.lspClient.sendRequest('fs/deleteFile', {
			uri: uri.toString(),
		})
	}

	createDirectory(uri: vscode.Uri): Promise<void> {
		return this.lspClient.sendRequest('fs/createDir', {
			uri: uri.toString(),
		})
	}

	
	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}

}