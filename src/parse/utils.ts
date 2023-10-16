import { Chunk, TestCaseExpression, TestSuiteExpression, Node, NodeBase, NodeSpan } from "./ast";

const BASE_KEY_PREFIX = 'base:'


export function findTestSuiteAndCaseStatements(chunk: Chunk) {
    let statements: (TestSuiteExpression|TestCaseExpression)[] = []

    walk(chunk, (node: Node) => {
        if(('base:test-suite-expr' in node) && node.isStatement){
            statements.push(node)
        }
        if(('base:test-case-expr' in node) && node.isStatement){
            statements.push(node)
        }
        return null
    })

    return statements
}

export function getNodeBase(node: Node): NodeBase | undefined {
    for(const [key,value] of Object.entries(node)){
        if(key.startsWith(BASE_KEY_PREFIX)){
            return value as NodeBase
        }
    }
    return
}

export type NodeVisitFn = (node: Node) => Error | null

export function walk(chunk: Chunk, visit: NodeVisitFn) {
    return _walk(chunk, visit, new Set())
}

function _walk(node: Node, visit: NodeVisitFn, visited: Set<unknown>): Error | undefined {
    if ((typeof node != 'object') || node === null) {
        return
    }

    if (visited.has(node)) {
        return
    }
    const err = visit(node)
    if (err != null) {
        return err
    }
    visited.add(node)

    for (const [k, v] of Object.entries(node)) {
        if (k.startsWith(BASE_KEY_PREFIX)) {
            continue
        }
        _walk(v, visit, visited)
    }

    return
}