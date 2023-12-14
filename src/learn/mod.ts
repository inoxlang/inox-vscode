import * as vscode from 'vscode';
import { INOX_FS_SCHEME } from '../inoxfs/mod';
import { InoxExtensionContext } from '../inox-extension-context';
import { fmtLspClientNotRunning } from '../errors';
import { LEARNING_LOG_PREFIX } from './const';
import { Tutorial, TutorialSeries, learningInfo, tryUpdatingData, tutorialSeries } from './data';
import { assertNotNil, sleep } from '../utils';
import { loadWASMParsingModule, parseInoxChunk } from '../parse/mod';


export const SELECT_TUTORIAL_SERIES_CMD_NAME = 'inox.learn.select-tutorial-series'
export const SELECT_TUTORIAL_CMD_NAME = 'inox.learn.select-tutorial'
export const NEXT_TUTORIAL_CMD_NAME = 'inox.learn.next-tutorial'

const DATA_FETCHING_INTERVAL_MILLIS = 300_000
const METADATA_COMMENT_FORMAT = '# Series: series [series_id]\n# Tutorial: tutorial [tutorial_id]'
const METADATA_COMMENT_REGEX = /#[ \t]+Series: (?<series_name>.*?) \[(?<series_id>.*)\]\s*\n#[ \t]+Tutorial: (?<tutorial_name>.*) \[(?<tutorial_id>.*?)\]\s*\n/u

enum MetadataCommentError {
    NotFound,
    UnknownSeries,
    UnknownTutorial
}

interface Current {
    series: TutorialSeries
    tutorial?: Tutorial
    error?: MetadataCommentError.UnknownTutorial
}

interface PersistedMetadata {
    seriesName: string
    seriesId: string
    tutorialName: string
    tutorialId: string
}

export class TutorialCodeLensProvider implements vscode.CodeLensProvider {

    isTutorialLoading = false


    constructor(readonly ctx: InoxExtensionContext) { 
        loadWASMParsingModule(ctx)
    }

    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if (this.isTutorialLoading || !this.ctx.lspClient?.isRunning()) {
            return []
        }

        try {
            const parseResult = await parseInoxChunk(this.ctx, document.uri.path, document.getText())
            if (!parseResult.chunk || !parseResult.chunkId) {
                return []
            }
        } catch {
            return []
        }

        let topOfDocument = new vscode.Range(0, 0, 0, 0)

        const selectSeriesCommand: vscode.Command = {
            command: SELECT_TUTORIAL_SERIES_CMD_NAME,
            title: 'Select Tutorial Series',
            arguments: [document]
        }

        const chooseSeriesLens = new vscode.CodeLens(topOfDocument, selectSeriesCommand)

        const nextTutorialCommand: vscode.Command = {
            command: NEXT_TUTORIAL_CMD_NAME,
            title: 'Next Tutorial',
            arguments: [document]
        }

        const selectTutorialCommand: vscode.Command = {
            command: SELECT_TUTORIAL_CMD_NAME,
            title: 'Select Tutorial',
            arguments: [document]
        }

        const selectTutorialLens = new vscode.CodeLens(topOfDocument, selectTutorialCommand)

        const nextTutorialLens = new vscode.CodeLens(topOfDocument, nextTutorialCommand)
        const lenses: vscode.CodeLens[] = []

        const text = document.getText()
        const current = getCurrentTutorialAndSeries(document)
        const helpMessage = formatHelpMessage(selectSeriesCommand.title)

        switch (current) {
            case MetadataCommentError.NotFound: case MetadataCommentError.UnknownSeries:
                // if there is no metadata (or the series is unknown) we cannot know the current tutorial so we delete 
                // all the file's content and add the help message. 

                if (!removeCRs(text).includes(removeCRs(helpMessage))) {
                    //note: we remove carriage returns because VSCode could haved added them before linefeeds on Windows.

                    const editor = vscode.window.activeTextEditor
                    if (editor?.document == document) {
                        await editor.edit(edit => {
                            const position = new vscode.Position(0, 0)
                            edit.delete(getDocRange(document))
                            edit.insert(position, helpMessage)
                        })
                        await document.save()
                    }
                } else {
                    // if the help message is already present we show the lens to choose a series.

                    lenses.push(chooseSeriesLens)
                }
                break
            default:
                if (current.error == MetadataCommentError.UnknownTutorial) {
                    lenses.push(chooseSeriesLens, selectTutorialLens)
                    break
                }
                assertNotNil(current.tutorial)

                const { series, tutorial } = current
                const indexCurrentTutorial = series.tutorials.findIndex(tut => tut.id == tutorial.id)

                if (indexCurrentTutorial == series.tutorials.length - 1) {  // last tutorial
                    lenses.push(chooseSeriesLens, selectTutorialLens)
                } else {
                    lenses.push(chooseSeriesLens, nextTutorialLens, selectTutorialLens)
                }
        }

        return lenses
    }
}


export function registerLearningCodeLensAndCommands(ctx: InoxExtensionContext) {
    const provider = new TutorialCodeLensProvider(ctx)

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

    //add commands providing tutorial selection and navigation.

    vscode.commands.registerCommand(SELECT_TUTORIAL_SERIES_CMD_NAME, async (tutDoc: vscode.TextDocument) => {
        if (! await tryLoadingData(ctx)) {
            return
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
        quickPick.show()

        const disposable = quickPick.onDidAccept(() => {
            const editor = vscode.window.activeTextEditor
            if (!editor || editor.document != tutDoc) {
                return
            }

            const selectedItem = quickPick.selectedItems?.[0] as undefined | QuickPickItem
            if (selectedItem === undefined) {
                return
            }

            const series = selectedItem.series

            quickPick.hide()
            quickPick.dispose()
            disposable.dispose()

            //load first tutorial of the series
            provider.isTutorialLoading = true
            loadTutorialInDocument(ctx, editor, selectedItem.series, series.tutorials[0]).then(() => {

                setTimeout(() => {
                    provider.isTutorialLoading = false
                }, 100)
            })
        })

        return new vscode.Disposable(() => {
            disposable.dispose()
            quickPick.dispose()
        })
    })

    vscode.commands.registerCommand(NEXT_TUTORIAL_CMD_NAME, async (tutDoc: vscode.TextDocument) => {
        if (! await tryLoadingData(ctx)) {
            return
        }

        const current = getCurrentTutorialAndSeries(tutDoc)
        if ((typeof current != 'object') || current.tutorial === undefined) {
            return
        }
        const { series, tutorial } = current
        const indexOfCurrentTutorial = series.tutorials.findIndex(tut => tut.id == tutorial.id)

        // not found or last tutorial
        if (indexOfCurrentTutorial < 0 || indexOfCurrentTutorial == series.tutorials.length - 1) {
            return
        }

        const editor = vscode.window.activeTextEditor
        if (!editor || editor.document != tutDoc) {
            return
        }

        const nextTutorial = series.tutorials[indexOfCurrentTutorial + 1]
        return loadTutorialInDocument(ctx, editor, series, nextTutorial)
    })

    vscode.commands.registerCommand(SELECT_TUTORIAL_CMD_NAME, async (tutDoc: vscode.TextDocument) => {
        if (! await tryLoadingData(ctx)) {
            return
        }

        const current = getCurrentTutorialAndSeries(tutDoc)

        if (current == MetadataCommentError.NotFound || current == MetadataCommentError.UnknownSeries) {
            return
        }

        type QuickPickItem = vscode.QuickPickItem & {
            tutorial: Tutorial
        }

        const series = current.series
        const quickPickItems = series.tutorials.map((tutorial): QuickPickItem => {
            return {
                tutorial: tutorial,
                label: tutorial.name,
            }
        })

        const quickPick = vscode.window.createQuickPick()
        quickPick.items = quickPickItems
        quickPick.canSelectMany = false
        quickPick.show()

        const disposable = quickPick.onDidAccept(() => {
            const editor = vscode.window.activeTextEditor
            if (!editor || editor.document != tutDoc) {
                return
            }

            const selectedItem = quickPick.selectedItems?.[0] as undefined | QuickPickItem
            if (selectedItem === undefined) {
                return
            }

            quickPick.hide()
            quickPick.dispose()
            disposable.dispose()

            //load selected tutorial in document
            provider.isTutorialLoading = true
            loadTutorialInDocument(ctx, editor, series, selectedItem.tutorial).then(() => {
                setTimeout(() => {
                    provider.isTutorialLoading = false
                }, 100)
            })
        })

        return new vscode.Disposable(() => {
            disposable.dispose()
            quickPick.dispose()
        })
    })
}

async function tryLoadingData(ctx: InoxExtensionContext): Promise<boolean> {
    if (!ctx.lspClient?.isRunning()) {
        vscode.window.showWarningMessage(LEARNING_LOG_PREFIX + fmtLspClientNotRunning(ctx))
        return false
    }

    if (learningInfo === undefined || tutorialSeries.length === 0) {
        await tryUpdatingData(ctx)
    }

    if (learningInfo === undefined || tutorialSeries.length === 0) {
        vscode.window.showWarningMessage(LEARNING_LOG_PREFIX + 'failed to get learning data')
        return false
    }

    return true
}

// loadTutorialInDocument updates the content of the document and creates tutorial.otherFiles.
function loadTutorialInDocument(ctx: InoxExtensionContext, editor: vscode.TextEditor, series: TutorialSeries, tutorial: Tutorial) {
    const comment = formatMetadataComment(series, tutorial)

    ctx.debugChannel.appendLine(LEARNING_LOG_PREFIX + 'load tutorial ' + tutorial.name)

    if (ctx.inoxFS) {
        for (const [path, content] of Object.entries(tutorial.otherFiles ?? {})) {
            const uri = vscode.Uri.from({ scheme: INOX_FS_SCHEME, path: path })
            const buf = new TextEncoder().encode(content)
            ctx.inoxFS.writeFile(uri, buf, { overwrite: true, create: true }).catch()
        }
    }

    let newFileContent = comment + '\n\n' + tutorial.program

    if (!newFileContent.endsWith('\n')) {
        newFileContent += '\n'
    }

    return editor.edit(builder => {
        const range = getDocRange(editor.document)

        builder.delete(range)
        builder.insert(new vscode.Position(0, 0), newFileContent)
    }).then(() => sleep(100)) //wait a bit to make sure the document has been updated.
    .then(() => editor.document.save())
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

function getCurrentTutorialAndSeries(doc: vscode.TextDocument): Current | MetadataCommentError.NotFound | MetadataCommentError.UnknownSeries {
    const parsed = parseTutFileMetadata(doc.getText())

    if (parsed == MetadataCommentError.NotFound) {
        return parsed
    }

    const series = tutorialSeries.find(series => series.id == parsed.seriesId)
    if (series === undefined) {
        return MetadataCommentError.UnknownSeries
    }

    const current: Current = {
        series: series,
    }

    const tutorial = series.tutorials.find(tut => tut.id == parsed.tutorialId)

    if (tutorial === undefined) {
        current.error = MetadataCommentError.UnknownTutorial
    } else {
        current.tutorial = tutorial
    }

    return current
}

function getDocRange(document: vscode.TextDocument): vscode.Range {
    const start = document.lineAt(0).range.start;
    const end = document.lineAt(document.lineCount - 1).range.end;
    return new vscode.Range(start, end);
}

function formatHelpMessage(commandTitle: string) {
    return ([
        `# This file is a tutorial file. Click just above on [${commandTitle}] to load a tutorial.`,
        '# You can execute an Inox program in VSCode by doing the following:',
        "# - Click on 'Run and Debug' in the activity bar (left)",
        "# - Select the 'Launch Current Program' task",
        "# - Click on the green arrow",
        "manifest {}",
    ]).join('\n')
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


// removeCRs removes all carriage return characters.
function removeCRs(s: string){
    return s.replace(/\r/g, "")
}