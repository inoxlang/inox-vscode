import * as vscode from 'vscode';
import { LSP_CLIENT_NOT_RUNNING_MSG } from './errors';
import { InoxExtensionContext } from "./inox-extension-context";

const SUGGESTION_COMPUTATON_INTERVAL_MILLIS = 3_000
const USER_IDLE_THRESHOLD_MILLIS = 5_000
const ONBOARDING_KEY_PREFIX = 'onboarding.'
const NEVER_SHOW_AGAIN_STATUS = 'never-show-again'
const DISMISSED_ONCE_STATUS = 'dismissed-once'


let isWindowFocused = true
let isUserIDLE = false //not accurate
let suggestionLoopStarted = false
let idleTimer: NodeJS.Timeout;


export class Suggestion {

    constructor(readonly data: {
        importance: SuggestionImportance
        readonly onAction: (action: string) => Promise<void>,
        readonly onDismissed?: () => Promise<void>,

        message: string
        items: string[]
    }) {

    }

    async show() {
        const result = await vscode.window.showInformationMessage(this.data.message, ...this.data.items)

        if (result === undefined) {
            await this.data.onDismissed?.()
        } else if (this.data.items.includes(result)) {
            await this.data.onAction(result)
        }
    }
}

enum SuggestionImportance {
    CRUCIAL,
    IMPORTANT,
    MODERATE,
    NEGLIGIBLE,
}

export function startSuggestionLoop() {
    if (suggestionLoopStarted) {
        return
    }
    suggestionLoopStarted = true

    setInterval(() => {
    }, SUGGESTION_COMPUTATON_INTERVAL_MILLIS)


    const disposable = vscode.window.onDidChangeWindowState(windowState => {
        isWindowFocused = windowState.focused
    });

    // (loop) set isUserIDLE to true if the last action among the actions we track happened more than a few seconds ago.

    function handleUserActivity() {
        isUserIDLE = false

        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            isUserIDLE = true
        }, USER_IDLE_THRESHOLD_MILLIS);
    }

    vscode.workspace.onDidOpenTextDocument(handleUserActivity)
    vscode.window.onDidChangeTextEditorSelection(handleUserActivity)
    vscode.window.onDidChangeTextEditorViewColumn(handleUserActivity)
    vscode.window.onDidChangeTextEditorVisibleRanges(handleUserActivity)
    vscode.workspace.onDidChangeTextDocument(e => {
        if (vscode.window.activeTextEditor?.document == e.document) {
            handleUserActivity()
        }
    })
}



export function computeSuggestions(ctx: InoxExtensionContext, maxNonCrucialCount: number): Suggestion[] {
    const suggestions = [
        ...computeOnboardingSuggestions(ctx)
    ]

    suggestions.sort((s1, s2) => s1.data.importance - s2.data.importance)
    const crucialCount = suggestions.filter(s => s.data.importance == SuggestionImportance.CRUCIAL).length

    return suggestions.slice(0, maxNonCrucialCount + crucialCount + 1)
}

function computeOnboardingSuggestions(ctx: InoxExtensionContext): Suggestion[] {
    const getStateValue = (key: string) => ctx.getStateValue(ONBOARDING_KEY_PREFIX + key)
    const setStateValue = (key: string, value: unknown) => ctx.setStateValue(ONBOARDING_KEY_PREFIX + key, value)

    const suggestions: Suggestion[] = []

    suggest_first_folder: {
        const FIRST_FOLDER_SUGGESTION_STATUS = 'first-folder-suggestion-status'
        const status = getStateValue(FIRST_FOLDER_SUGGESTION_STATUS)

        if (ctx.config.project) {
            setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, NEVER_SHOW_AGAIN_STATUS)
            break suggest_first_folder
        }

        if (status === undefined || status == DISMISSED_ONCE_STATUS) {
            suggestions.push(new Suggestion({
                importance: SuggestionImportance.CRUCIAL,
                message:
                    "The Inox Extension is installed. You can now create a new folder (example: my-web-app), open it with VSCode " +
                    "and execute the command `Inox: Initialize new Project in Current Folder`.",
                items: ['Got it'],
                async onAction() {
                    if (!ctx.lspClient || !ctx.lspClient.isRunning()) {
                        vscode.window.showErrorMessage(LSP_CLIENT_NOT_RUNNING_MSG)
                        return
                    }

                    setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, NEVER_SHOW_AGAIN_STATUS)
                },
                async onDismissed() {
                    if (status === undefined) {
                        setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, DISMISSED_ONCE_STATUS)
                    } else {
                        setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, NEVER_SHOW_AGAIN_STATUS)
                    }
                },
            }))

        }
    }


    return suggestions
}