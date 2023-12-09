import * as fs from 'fs'
import * as path from 'path'
import { Chunk, ParseError, SourcePositionRange } from './ast'
import { sleep } from '../utils'
import { createGo as createGoClass } from './wasm_exec'
import { InoxExtensionContext } from '../inox-extension-context'


export * from './ast'
export * from './utils'



export async function parseInoxChunk(ctx: InoxExtensionContext, filepath: string, content: string) {
    const { parseChunk } = await getExports(ctx)
    const result = parseChunk(filepath, path.dirname(filepath), content)
    const [chunk, err] = result
    if (err != null) {
        throw new Error(err)
    }
    return JSON.parse(chunk) as ParseResult
}

export async function getSpanLineColumn(ctx: InoxExtensionContext, chunkId: string, startIndex: number, endIndex: number) {
    const { getSpanLineColumn: get } = await getExports(ctx)

    const [result, err] = get(chunkId, startIndex, endIndex)
    if (err != null) {
        throw new Error(err)
    }
    return result as [number, number]
}

export async function loadWASMParsingModule(ctx: InoxExtensionContext) {
    getExports(ctx)
}

const MOD_PATH = path.join(__dirname, '..', '..', 'assets', 'parse.wasm')
const MOD_BYTES = fs.readFileSync(MOD_PATH)
const modExports = new Map<InoxExtensionContext, Exports | 'loading'>();

interface Exports {
    parseChunk: (filepath: string, dirpath: string, content: string) => any
    getSpanLineColumn: (chunkId: string, startIndex: number, endIndex: number) => any
}


async function createInstance(ctx: InoxExtensionContext) {
    const Go = createGoClass(ctx.debugChannel)
    const go = new Go()
    const MOD_INSTANCE = (await WebAssembly.instantiate(MOD_BYTES.buffer, go.importObject)).instance
    go.run(MOD_INSTANCE);
    setTimeout(() => {
        let exports = go.exports;

        const parseChunk = exports.parse_chunk
        if (typeof parseChunk != 'function') {
            throw new Error('parse_chunk should be a function not a ' + typeof parseChunk)
        }

        const getSpanLineColumn = exports.get_span_line_column
        if (typeof getSpanLineColumn != 'function') {
            throw new Error('get_span_line_column should be a function not a ' + typeof getSpanLineColumn)
        }

        modExports.set(ctx, {
            getSpanLineColumn: getSpanLineColumn,
            parseChunk: parseChunk,
        })
    }, 100)
}

async function getExports(ctx: InoxExtensionContext) {
    let moduleExports = modExports.get(ctx)
    if (moduleExports == undefined) {
        createInstance(ctx)
        await sleep(500)
    } else if (moduleExports === 'loading') {
        await sleep(500)
    } else {
        return moduleExports
    }

    moduleExports = modExports.get(ctx)
    if (typeof moduleExports != 'object') {
        throw new Error('wasm module is not loaded')
    }

    return moduleExports
}

export interface ParseResult {
    completeErrorMessage: string
    errors: ParseError[]
    errorPositions: SourcePositionRange[]
    chunk?: Chunk
    chunkId?: string
}

