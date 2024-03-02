import { Chunk, TestCaseExpression, TestSuiteExpression, Node, NodeBase, NodeSpan } from "./ast";

const BASE_KEY_PREFIX = 'base:'


export function findTestSuiteAndCaseStatements(chunk: Chunk) {
    let statements: (TestSuiteExpression | TestCaseExpression)[] = []

    walk(chunk, (node: Node) => {
        if (('base:test-suite-expr' in node) && node.isStatement) {
            statements.push(node)
        }
        if (('base:test-case-expr' in node) && node.isStatement) {
            statements.push(node)
        }
        return null
    })

    return statements
}

export function isPositionInHyperscriptScript(chunk: Chunk, position: number) {
    let yes = false
    walk(chunk, (node: Node) => {
        if (('base:xml-elem' in node) && position >= node.rawElementContentStart && position <= node.rawElementContentEnd) {
            yes = true
            return StopTraversal
        }
        return null
    })
    return yes
}

export function getNodeBase(node: Node): NodeBase | undefined {
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith(BASE_KEY_PREFIX)) {
            return value as NodeBase
        }
    }
    return
}

export type NodeVisitFn = (node: Node) => Error |  (typeof StopTraversal) | null

export function walk(chunk: Chunk, visit: NodeVisitFn) {
    return _walk(chunk, visit, new Set())
}

export const StopTraversal = Symbol()

function _walk(node: Node, visit: NodeVisitFn, visited: Set<unknown>): Error | (typeof StopTraversal) | undefined {
    if ((typeof node != 'object') || node === null) {
        return
    }

    if (visited.has(node)) {
        return
    }
    const res = visit(node)
    if (res instanceof Error) {
        return res
    }
    if (res == StopTraversal) {
        return StopTraversal
    }
    visited.add(node)

    for (const [k, v] of Object.entries(node)) {
        if (k.startsWith(BASE_KEY_PREFIX)) {
            continue
        }
        const res = _walk(v, visit, visited)
        if (res instanceof Error) {
            return res
        }
        if (res == StopTraversal) {
            return StopTraversal
        }
    }

    return
}