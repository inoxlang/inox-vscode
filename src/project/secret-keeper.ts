import * as vscode from 'vscode';
import { CancellationTokenSource } from 'vscode-languageclient'
import { InoxExtensionContext } from '../inox-extension-context';
import { stringifyCatchedValue } from '../utils';


const UPSERT_SECRET_METHOD = 'secrets/upsert'
const DELETE_SECRET_METHOD = 'secrets/delete'
const LIST_SECRETS_METHOD = 'secrets/list'


export class SecretKeeper implements vscode.TreeDataProvider<SecretEntry> {

	private _onDidChangeTreeData: vscode.EventEmitter<SecretEntry | undefined | void> = new vscode.EventEmitter<SecretEntry | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<SecretEntry | undefined | void> = this._onDidChangeTreeData.event;
	entries: SecretEntry[] = []

	loaded = true

	constructor(readonly ctx: InoxExtensionContext) {
		this.ctx.onProjectOpen(() => this.listSecrets())
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: SecretEntry): vscode.TreeItem {
		return element;
	}

	getChildren(element?: SecretEntry): Thenable<SecretEntry[]> {
		if (element) {
			return Promise.resolve([])
		}
		return Promise.resolve([...this.entries])
		//return Promise.resolve([new SecretEntry("x", vscode.TreeItemCollapsibleState.Collapsed)])
	}

	async listSecrets() {
		const lspClient = this.ctx.lspClient
		if (lspClient === undefined || !lspClient.isRunning) {
			vscode.window.showErrorMessage('impossible to list secrets: LSP client is not running')
			return
		}
		let resp: any;
		try {
			const tokenSource = new CancellationTokenSource()
			setTimeout(() => {
				if (!resp) {
					tokenSource.cancel()
				}
			}, 6000)
			resp = await lspClient.sendRequest(LIST_SECRETS_METHOD, {}, tokenSource.token)
		} catch (err) {
			this.ctx.debugChannel.appendLine(stringifyCatchedValue(err))
			return
		}

		if (resp && 
			typeof (resp == 'object') && 
			resp !== null && ('secrets' in resp) && 
			(resp.secrets == null || Array.isArray(resp.secrets))) {
			this.entries = (resp.secrets ?? []).map((e: { name: string, lastModificationDate: string }) => {
				const lastModificationDate = new Date(Date.parse(e.lastModificationDate))
				const description = lastModificationDate.toLocaleDateString([], {
					hour: '2-digit',
					minute: '2-digit'
				})
				return new SecretEntry(e.name, description, vscode.TreeItemCollapsibleState.None)
			})

			this._onDidChangeTreeData.fire()
		} else {
			this.ctx.outputChannel.appendLine('response of secrets/listSecrets has invalid data')
			return
		}
	}

	async addSecret() {
		const LSP_ERR_MSG = 'impossible to create a secret: LSP client is not running'
		if (this.ctx.lspClient === undefined || !this.ctx.lspClient.isRunning()) {
			vscode.window.showErrorMessage(LSP_ERR_MSG)
			return
		}

		const secretName = await vscode.window.showInputBox({
			placeHolder: 'Name',
			validateInput(val) {
				if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(val)) {
					return null
				}

				return {
					message: "invalid name, only letters, digits and the '-', '_' characters are allowed",
					severity: vscode.InputBoxValidationSeverity.Error
				}
			}
		})

		if (secretName === undefined) {
			return
		}

		const secretValue = await vscode.window.showInputBox({
			placeHolder: 'Value - not accessible after the secret is created',
		})

		if (secretValue === undefined) {
			return
		}

		if (this.ctx.lspClient === undefined || !this.ctx.lspClient.isRunning()) {
			vscode.window.showErrorMessage(LSP_ERR_MSG)
			return
		}

		const lspClient = this.ctx.lspClient
		await lspClient.sendRequest(UPSERT_SECRET_METHOD, {
			name: secretName,
			value: secretValue
		})
		return this.listSecrets()
	}

	async updateSecret(secretName: string) {
		const LSP_ERR_MSG = 'impossible to update a secret: LSP client is not running'
		if (this.ctx.lspClient === undefined || !this.ctx.lspClient.isRunning()) {
			vscode.window.showErrorMessage(LSP_ERR_MSG)
			return
		}

		const secretValue = await vscode.window.showInputBox({
			placeHolder: 'Value - not accessible after the secret is updated',
		})

		if (secretValue === undefined) {
			return
		}

		if (this.ctx.lspClient === undefined || !this.ctx.lspClient.isRunning()) {
			vscode.window.showErrorMessage(LSP_ERR_MSG)
			return
		}

		const lspClient = this.ctx.lspClient
		await lspClient.sendRequest(UPSERT_SECRET_METHOD, {
			name: secretName,
			value: secretValue
		})
		return this.listSecrets()
	}

	async deleteSecret(secretName: string) {
		if (this.ctx.lspClient === undefined || !this.ctx.lspClient.isRunning()) {
			vscode.window.showErrorMessage('impossible to delete a secret: LSP client is not running')
			return
		}

		const confirmation = await vscode.window
			.showInformationMessage(`Are you sure you want to delete the secret ${secretName} ?`, "Yes", "No")
			.then(answer => {
				return answer === "Yes"
			})

		if(!confirmation){
			return
		}

		await this.ctx.lspClient.sendRequest(DELETE_SECRET_METHOD, {
			name: secretName,
		})
		return this.listSecrets()
	}
}

export class SecretEntry extends vscode.TreeItem {

	constructor(
		public readonly label: string,
		public readonly description: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		this.tooltip = this.label
	}

	contextValue = 'secret';
}
