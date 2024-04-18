import * as vscode from 'vscode'
import { NodeSpan } from '../parse/mod'
import { Filter } from '../testing/mod'


export const RUN_DEBUG_CURRENT_FILE_CMD_NAME = 'inox.debug.run-debug-current'
export const DEBUG_TESTS_IN_FILE_CMD_NAME = "inox.testing.debug-tests-in-file"



const RUN_DEBUG_CURRENT_CONFIG_ID = 'run-debug-current'
const DEBUG_TESTS_IN_CURRENT_MODULE_CONFIG_ID = 'debug-tests-current'

export function registerCommands() {
    vscode.commands.registerCommand(
        RUN_DEBUG_CURRENT_FILE_CMD_NAME,
        async ({ document }: { document: vscode.TextDocument, }) => {


            const configurations = getLaunchConfigurations()
            if (configurations === undefined) {
                return
            }

            const configId = RUN_DEBUG_CURRENT_CONFIG_ID
            let usedConfig: unknown

            //Find configuration for 'Launch Current Module'.
            for (const [_, config] of Object.entries(configurations)) {
                if (config !== null && (typeof config == 'object') && ('id' in config)) {
                    const id = String((config as Record<string, unknown>).id)

                    if (id == configId) {
                        usedConfig = config
                        break
                    }
                }
            }

            if (usedConfig === undefined) {
                vscode.window.showErrorMessage(`'${configId}' (case insensitive) launch configuration not found in workspace configuration`)
                return
            }

            vscode.commands.executeCommand('debug.startFromConfig', usedConfig)
        }
    )

    vscode.commands.registerCommand(
        DEBUG_TESTS_IN_FILE_CMD_NAME,
        async ({ document, span }: { document: vscode.TextDocument, span?: NodeSpan }) => {
            const configurations = getLaunchConfigurations()
            if (configurations === undefined) {
                return
            }

            const configId = DEBUG_TESTS_IN_CURRENT_MODULE_CONFIG_ID
            let baseConfig: unknown

            //Find configuration for 'Debug Tests in Current Module'
            for (const [_, config] of Object.entries(configurations)) {
                if (config !== null && (typeof config == 'object') && ('id' in config)) {
                    const id = String((config as Record<string, unknown>).id)

                    if (id == DEBUG_TESTS_IN_CURRENT_MODULE_CONFIG_ID) {
                        baseConfig = config
                        break
                    }
                }
            }

            if (baseConfig === undefined) {
                vscode.window.showErrorMessage(`'${configId}' (case insensitive) launch configuration not found in workspace configuration`)
                return
            }

            const usedConfig = JSON.parse(JSON.stringify(baseConfig))
            const positiveTestFilters: Filter[] = [
                {
                    regex: '.*',
                    path: document.uri.path,
                }
            ]

            if (span !== undefined) {
                //Debug a single test.
                positiveTestFilters[0].span = span
            } 

            usedConfig.positiveTestFilters = positiveTestFilters

            vscode.commands.executeCommand('debug.startFromConfig', usedConfig)
        }
    )
}


function getLaunchConfigurations() {
    const workspaceConfig = vscode.workspace.getConfiguration()
    const launch = workspaceConfig.get('launch')

    if (launch === null || (typeof launch != 'object') || !('configurations' in launch)) {
        vscode.window.showErrorMessage('Failed to read launch configurations in workspace configuration')
        return
    }
    const configurations = (launch as Record<string, unknown>).configurations as Record<string, unknown>
    return configurations
}