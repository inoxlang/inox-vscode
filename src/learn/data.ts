import { InoxExtensionContext } from "../inox-extension-context"
import { LEARNING_PREFIX } from "./const"

const GET_TUTORIAL_SERIES_METHOD = "learn/getTutorialSeries"
const GET_LEARN_INFO_METHOD = "learn/getInfo"


//learning data: periodically updated

export let tutorialSeries: TutorialSeries[] = []
export let learningInfo: LearningInfo | undefined

export interface TutorialSeries {
    id: string
    name: string
    description: string
    tutorials: Tutorial[]
}

export interface Tutorial {
    id: string
    name: string
    program: string
    otherFiles?: Record<string, string>
    output?: string
    logOutput?: string
}

export interface LearningInfo {
}

export async function tryUpdatingData(ctx: InoxExtensionContext) {
    ctx.debugChannel.appendLine(LEARNING_PREFIX + 'try updating learning data')

    if (!ctx.lspClient?.isRunning()) {
        return
    }

    get_tutorials: {
        const result = await ctx.lspClient.sendRequest(GET_TUTORIAL_SERIES_METHOD, {})

        if (typeof result != 'object' || result === null) {
            ctx.debugChannel.appendLine(LEARNING_PREFIX + GET_TUTORIAL_SERIES_METHOD + ': invalid result: ' + JSON.stringify(result))
            break get_tutorials
        }

        const record = result as Record<string, unknown>
        if (!('tutorialSeries' in record)) {
            ctx.debugChannel.appendLine(LEARNING_PREFIX + GET_TUTORIAL_SERIES_METHOD + ': missing tutorialSeries property in result: ' + JSON.stringify(result))
            break get_tutorials
        }

        tutorialSeries = record.tutorialSeries as TutorialSeries[]
        ctx.debugChannel.appendLine(LEARNING_PREFIX + 'tutorials set/updated')
    }

    if (!ctx.lspClient?.isRunning()) {
        return
    }

    get_learning_info: {
        const result = await ctx.lspClient.sendRequest(GET_LEARN_INFO_METHOD, {})

        if (typeof result != 'object' || result === null) {
            ctx.debugChannel.appendLine(LEARNING_PREFIX + GET_LEARN_INFO_METHOD + ': invalid result: ' + JSON.stringify(result))
            break get_learning_info
        }

        learningInfo = result as LearningInfo
        ctx.debugChannel.appendLine(LEARNING_PREFIX + 'learning info set/updated')
    }
}
