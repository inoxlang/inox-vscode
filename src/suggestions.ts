import * as vscode from 'vscode';
import { EXTENSION_DOC_RECOMMENDENTATION_MSG } from './errors';
import { InoxExtensionContext } from "./inox-extension-context";
import { equalSemver, greaterOrEqualSemver, parseSemverParts, stringifyCatchedValue } from './utils';

const SUGGESTION_COMPUTATON_INTERVAL_MILLIS = 3_000
const USER_IDLE_THRESHOLD_MILLIS = 5_000
const MAX_EXTENSION_UPDATE_MUTE_DURATION = 7 * 86400 //~ 7 days

const ONBOARDING_KEY_PREFIX = 'onboarding.'
const UPDATE_SUGGESTIONS_KEY_PREFIX = 'update-suggestions.'
const NEVER_SHOW_AGAIN_STATUS = 'never-show-again'
const DISMISSED_ONCE_STATUS = 'dismissed-once'


const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=graphr00t.inox'
const TAGS_ENDPOINT = 'https://api.github.com/repos/inoxlang/inox-vscode/tags'

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



export async function computeSuggestions(ctx: InoxExtensionContext, maxNonCrucialCount: number): Promise<Suggestion[]> {
    const suggestions = [
        ...await computeUpdateSuggestions(ctx),
        ...computeOnboardingSuggestions(ctx),
    ]

    suggestions.sort((s1, s2) => s1.data.importance - s2.data.importance)
    const crucialCount = suggestions.filter(s => s.data.importance == SuggestionImportance.CRUCIAL).length

    return suggestions.slice(0, maxNonCrucialCount + crucialCount + 1)
}


async function computeUpdateSuggestions(ctx: InoxExtensionContext): Promise<Suggestion[]> {
    try {
        const extensionUpdateSuggestion = await computeExtensionUpdateSuggestion(ctx)

        if (extensionUpdateSuggestion) {
            return [extensionUpdateSuggestion]
        }
    
        return []
    } catch {
        return []
    }
}

async function computeExtensionUpdateSuggestion(ctx: InoxExtensionContext): Promise<Suggestion | null> {
    const LAST_EXTENSION_UPDATE_MUTE_TIMESTAMP = 'last-extension-update-mute-timestamp'

    const setStateValue = (key: string, value: unknown) => ctx.setStateValue(UPDATE_SUGGESTIONS_KEY_PREFIX + key, value)
    const getStateValue = (key: string) => ctx.getStateValue(UPDATE_SUGGESTIONS_KEY_PREFIX + key)

    const version = ctx.extensionVersion
    if (!version) {
        return null
    }

    const lastMuteTimestamp = getStateValue(LAST_EXTENSION_UPDATE_MUTE_TIMESTAMP)
    //Check if the suggestion should be muted.

    if ((typeof lastMuteTimestamp == 'number') && Date.now() - lastMuteTimestamp < MAX_EXTENSION_UPDATE_MUTE_DURATION) {
        return null
    }

    try {
        //Fetch version numbers.
        const installedVersion = parseSemverParts(version)
        const tagLists: { name: string }[] = await fetch(TAGS_ENDPOINT).then(r => r.json())
        
        if (!Array.isArray(tagLists)) {
            return null
        }

        const versions = tagLists.map(e => parseSemverParts(e.name))
        if (versions.length == 0) {
            return null
        }

        //Sort in descending order.
        versions.sort((a, b) => greaterOrEqualSemver(a, b) ? -1 : 1)
        const currentVersion = versions[0]

        //Check that the current version is not less or equal to the installed version.
        if (greaterOrEqualSemver(installedVersion, currentVersion)) {
            return null
        }

        const OK = 'Ok'

        return new Suggestion({
            importance: SuggestionImportance.IMPORTANT,
            items: [OK],
            message: `A new version of the Inox extension is available (v${currentVersion.join('.')}). Make sure to update it. `+
                `If you use VSCodium you can download the VSIX file [on this page](${MARKETPLACE_URL}).`,
            async onAction() {
                setStateValue(LAST_EXTENSION_UPDATE_MUTE_TIMESTAMP, Date.now())
            }
        })
    } catch (reason) {
        ctx.debugChannel.appendLine(stringifyCatchedValue(reason))
        return null
    }
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
                    `The Inox Extension is installed. ` + EXTENSION_DOC_RECOMMENDENTATION_MSG,
                items: ['Got it'],
                async onAction() {
                    await setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, NEVER_SHOW_AGAIN_STATUS)
                },
                async onDismissed() {
                    if (status === undefined) {
                        await setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, DISMISSED_ONCE_STATUS)
                    } else {
                        await setStateValue(FIRST_FOLDER_SUGGESTION_STATUS, NEVER_SHOW_AGAIN_STATUS)
                    }
                },
            }))

        }
    }


    return suggestions
}