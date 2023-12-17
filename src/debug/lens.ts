import * as vscode from 'vscode';
import { InoxExtensionContext } from '../inox-extension-context';
import { getSpanEndLineColumn, getSpanLineColumn, loadWASMParsingModule, parseInoxChunk } from '../parse/mod';
import { SPEC_FILE_SUFFIX } from '../testing/mod';
import { INOX_FS_SCHEME } from '../inoxfs/consts';


export const RUN_DEBUG_CURRENT_FILE_CMD_NAME = 'inox.debug.run-debug-current'

export function registerRunDebugLensAndCommands(ctx: InoxExtensionContext) {
    const provider = new RunDebugCodeLensProvider(ctx)

    let codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(
        {
            language: 'inox',
            scheme: INOX_FS_SCHEME,
            pattern: '**/*.ix'
        },
        provider,
    )

    ctx.base.subscriptions.push(codeLensProviderDisposable)
    
    vscode.commands.registerCommand(
        RUN_DEBUG_CURRENT_FILE_CMD_NAME,
        async ({ document }: { document: vscode.TextDocument, }) => {

            const workspaceConfig = vscode.workspace.getConfiguration()
            const launch = workspaceConfig.get('launch')

            if(launch === null || (typeof launch != 'object') || !('configurations' in launch)){
                vscode.window.showErrorMessage('Failed to read launch configurations in workspace configuration')
                return
            }
            const configurations = (launch as Record<string, unknown>).configurations as Record<string, unknown>
            const lowercaseConfigName = 'launch current program'

            let usedConfig: unknown

            //find configuration for 'Launch Current Program'
            for(const [_, config] of Object.entries(configurations)){
                if(config !== null && (typeof config == 'object') && ('name' in config)){
                    const lowercase = String((config as Record<string, unknown>).name).toLowerCase()

                    if(lowercase == lowercaseConfigName) {
                        usedConfig = config
                        break
                    }
                }
            }

            if(usedConfig === undefined) {
                vscode.window.showErrorMessage(`'${lowercaseConfigName}' (case insensitive) launch configuration not found in workspace configuration`)
                return
            }

            vscode.commands.executeCommand('debug.startFromConfig', usedConfig)
        }
    )

}

export class RunDebugCodeLensProvider implements vscode.CodeLensProvider {

    constructor(readonly ctx: InoxExtensionContext) {
        loadWASMParsingModule(ctx)
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        //don't show any lenses if the LSP client is not running or the document is a test file.
        if (!this.ctx.lspClient?.isRunning() || document.fileName.endsWith(SPEC_FILE_SUFFIX)) {
            return []
        }

        //TODO: support debugging test files.

        try {
            const text = document.getText()
            const parseResult = await parseInoxChunk(this.ctx, document.uri.path, text)

            //don't show lenses if there is no manifest of if there are parsing errors.
            if (!parseResult.chunk || !parseResult.chunkId || !parseResult.chunk.manifest) {
                return []
            }

            //compute position of the lens.
            const manifestSpan = parseResult.chunk.manifest['base:manifest'].span
            const [line, column] = await getSpanLineColumn(this.ctx, parseResult.chunkId, manifestSpan.start, manifestSpan.end)
            const [endLine, _] = await getSpanEndLineColumn(this.ctx, parseResult.chunkId, manifestSpan.start, manifestSpan.end)

            const range = new vscode.Range(line - 1, column - 1, line - 1, column - 1)

            //don't show lenses if the databases are provided by another module.
            const lines = text.split('\n').slice(line-1, endLine)
            if(lines.some(line => /"?databases"?:\s*[^{\s]/.test(line))){
                return []
            }

            //create lens
            const lens = new vscode.CodeLens(range, {
                command: RUN_DEBUG_CURRENT_FILE_CMD_NAME,
                title: 'run and debug',
                arguments: [{document}]
            })

            return [lens]
        } catch(err) {
            return []
        }
    }
}