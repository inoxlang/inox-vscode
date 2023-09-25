import * as vscode from 'vscode';
import { INOX_FS_SCHEME } from '../inox-fs';
import { InoxExtensionContext } from '../inox-extension-context';
import { LSP_CLIENT_NOT_RUNNING_MSG } from '../errors';
import { LEARNING_PREFIX } from './const';
import { Tutorial, TutorialSeries, learningInfo, tryUpdatingData, tutorialSeries } from './data';


export const CHOOSE_TUTORIAL_SERIES_CMD_NAME = 'inox.learn.select-tutorial-series'
export const NEXT_TUTORIAL_CMD_NAME = 'inox.learn.next-tutorial'

const DATA_FETCHING_INTERVAL_MILLIS = 300_000
const METADATA_COMMENT_FORMAT = '# Series: series [series_id]\n# Tutorial: tutorial [tutorial_id]'
const METADATA_COMMENT_REGEX = /#[ \t]+Series: (?<series_name>.*?) \[(?<series_id>.*)\]\s*\n#[ \t]+Tutorial: (?<tutorial_name>.*) \[(?<tutorial_id>.*?)\]\s*\n/u

enum MetadataCommentError {
    NotFound,
    UnknownSeries,
    UnknownTutorial
}

export class TutorialCodeLensProvider implements vscode.CodeLensProvider {

    isTutorialLoading = false

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if(this.isTutorialLoading){
            return []
        }

        let topOfDocument = new vscode.Range(0, 0, 0, 0)

        const chooseSeriesCommand: vscode.Command = {
            command: CHOOSE_TUTORIAL_SERIES_CMD_NAME,
            title: 'Select Tutorial Series',
            arguments: [document]
        }

        const chooseSeriesCommandLens = new vscode.CodeLens(topOfDocument, chooseSeriesCommand)

        const nextTutorialCommand: vscode.Command = {
            command: NEXT_TUTORIAL_CMD_NAME,
            title: 'Next Tutorial',
            arguments: [document]
        }

        const nextTutorialCommandLens = new vscode.CodeLens(topOfDocument, nextTutorialCommand)
        const lenses: vscode.CodeLens[] = []

        const text = document.getText()
        const metadata = getTutFileMetadata(text)
        const helpMessage = formatHelpMessage(chooseSeriesCommand.title)

        // if there is no metadata we cannot know the current tutorial so we delete 
        // all the file's content and add the help message
        if (metadata == MetadataCommentError.NotFound && !text.includes(helpMessage)) {
            const editor = vscode.window.activeTextEditor
            if (editor?.document == document) {
                await editor.edit(edit => {
                    const position = new vscode.Position(0, 0)
                    edit.delete(getDocRange(document))
                    edit.insert(position, formatHelpMessage(chooseSeriesCommand.title))
                })
                await document.save()
            }
        } else if(text.includes(helpMessage) && text.length){
            lenses.push(chooseSeriesCommandLens)
        } else {
            lenses.push(chooseSeriesCommandLens, nextTutorialCommandLens)
        }

        return lenses
    }
}


export function registerLearningCodeLensAndCommands(ctx: InoxExtensionContext) {
    const provider = new TutorialCodeLensProvider()

    setTimeout(() => {
        tryUpdatingData(ctx)

        setInterval(() => {
            tryUpdatingData(ctx)
        }, DATA_FETCHING_INTERVAL_MILLIS)
    }, 1000)

    let codeLensProviderDisposable = vscode.languages.registerCodeLensProvider(
        {
            language: 'inox',
            scheme: INOX_FS_SCHEME,
            pattern: '**/*.tut.ix'
        },
        provider,
    )

    ctx.base.subscriptions.push(codeLensProviderDisposable)

    vscode.commands.registerCommand(CHOOSE_TUTORIAL_SERIES_CMD_NAME, async (tutDoc: vscode.TextDocument) => {
        const lspClient = ctx.lspClient

        //make sure we have the data
        {
            if (!lspClient?.isRunning()) {
                vscode.window.showWarningMessage(LEARNING_PREFIX + LSP_CLIENT_NOT_RUNNING_MSG)
                return
            }

            if (learningInfo === undefined || tutorialSeries.length === 0) {
                await tryUpdatingData(ctx)
            }

            if (learningInfo === undefined || tutorialSeries.length === 0) {
                vscode.window.showWarningMessage(LEARNING_PREFIX + 'failed to get learning data')
                return
            }
        }

        type QuickPickItem = vscode.QuickPickItem & {
            series: TutorialSeries
        }

        const quickPickItems = tutorialSeries.filter(series => series.tutorials.length > 0).map((series): QuickPickItem => {
            return {
                series: series,
                label: series.name,
                description: series.description,
            }
        })

        const quickPick = vscode.window.createQuickPick()
        quickPick.items = quickPickItems
        quickPick.canSelectMany = false

        quickPick.onDidAccept(() => {
            const editor = vscode.window.activeTextEditor
            if (!editor || editor.document != tutDoc) {
                return
            }

            const selectedItem = quickPick.selectedItems?.[0] as undefined | QuickPickItem
            if (selectedItem === undefined) {
                return
            }
            quickPick.hide()

            const series = selectedItem.series

            //load first tutorial of the series
            provider.isTutorialLoading = true
            loadTutorialInDocument(editor, selectedItem.series, series.tutorials[0]).then(() => {

                setTimeout(() => {
                    provider.isTutorialLoading = false
                }, 100)
            })
        })

        quickPick.show()
    })

    // const metadata = getTutFileMetadata(tutDoc.getText())

    // switch(metadata){
    // case MetadataCommentError.NotFound:
    // case MetadataCommentError.UnknownSeries:
    // case MetadataCommentError.UnknownTutorial:
    // default:

    // }
}


function loadTutorialInDocument(editor: vscode.TextEditor, series: TutorialSeries, tutorial: Tutorial) {
    const comment = formatMetadataComment(series, tutorial)
    const range = getDocRange(editor.document)
    let newFileContent = comment + '\n\n' + tutorial.program

    if (!newFileContent.endsWith('\n')) {
        newFileContent += '\n'
    }

    return editor.edit(builder => {
        builder.delete(range)
        builder.insert(new vscode.Position(0, 0), newFileContent)
    })
}

interface Metadata {
    series: TutorialSeries
    tutorial: Tutorial
}

interface PersistedMetadata {
    seriesName: string
    seriesId: string
    tutorialName: string
    tutorialId: string
}


function formatMetadataComment(series: TutorialSeries, tutorial: Tutorial) {
    return formatPersistedMetadata({
        seriesId: series.id,
        seriesName: series.name,
        tutorialId: tutorial.id,
        tutorialName: tutorial.name
    })
}

function formatPersistedMetadata(metadata: PersistedMetadata) {
    let comment = METADATA_COMMENT_FORMAT.replace('series', metadata.seriesName)
    comment = comment.replace('series_id', metadata.seriesId)
    comment = comment.replace('tutorial', metadata.tutorialName)
    comment = comment.replace('tutorial_id', metadata.tutorialId)

    return comment
}

function parseTutFileMetadata(content: string): PersistedMetadata | MetadataCommentError.NotFound {
    const array = METADATA_COMMENT_REGEX.exec(content.trim())

    if (array === null || array.groups === undefined) {
        return MetadataCommentError.NotFound
    }

    const seriesName = array.groups.series_name.trim()
    const seriesId = array.groups.series_id.trim()
    const tutorialName = array.groups.tutorial_name.trim()
    const tutorialId = array.groups.tutorial_id.trim()

    return { seriesId, seriesName, tutorialId, tutorialName }
}

function getTutFileMetadata(content: string): Metadata | MetadataCommentError {
    const parsed = parseTutFileMetadata(content)

    if (parsed == MetadataCommentError.NotFound) {
        return parsed
    }

    const series = tutorialSeries.find(series => series.id == parsed.seriesId)
    if (series === undefined) {
        return MetadataCommentError.UnknownSeries
    }

    const tutorial = series.tutorials.find(tut => tut.id == parsed.tutorialId)
    if (tutorial === undefined) {
        return MetadataCommentError.UnknownTutorial
    }

    return {
        series: series,
        tutorial: tutorial
    }
}

function getDocRange(document: vscode.TextDocument): vscode.Range {
    const start = document.lineAt(0).range.start;
    const end = document.lineAt(document.lineCount - 1).range.end;
    return new vscode.Range(start, end);
}

function formatHelpMessage(commandTitle: string) {
    return `# This file is a tutorial file. Click just above on [${commandTitle}] to load a tutorial. \nmanifest {\n\n}\n`
}



//test

// const persistedMetadata = {
//     seriesId: 'sid',
//     seriesName: 'series',
//     tutorialId: 'tid',
//     tutorialName: 'tutorial'
// }


// const formatted = formatPersistedMetadata(persistedMetadata)
// const parsed = parseTutFileMetadata(formatted)

// if (parsed == MetadataCommentError.NotFound) {
//     throw new Error('test ' + parsed.toString())
// }

// if (formatted != formatPersistedMetadata(parsed)) {
//     throw new Error('test fail')
// }