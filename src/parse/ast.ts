
export interface ParseError {
    kind: number
    message: string
}


export interface SourcePositionRange {
    sourceName:  string   
	line: number    
	column: number    
	endLine: number    
	endColumn: number    
    span: NodeSpan
    chunk: object
}

export interface NodeSpan {
    start: number
    end: number //exclusive
}

export interface NodeBase {
    span: NodeSpan
    error?: ParseError
}


export type Node = |
    Chunk | EmbeddedModule | Manifest | IncludableChunkDescription |
    TestSuiteExpression | TestCaseExpression | XMLElement | {unknown: never}

export interface Chunk {
    "base:chunk": NodeBase
    manifest?: Manifest
    includableChunkDesc?: IncludableChunkDescription
    statements?: Node[]
}

export interface EmbeddedModule {
    "base:embedded-module": NodeBase
    manifest?: Manifest
    statements?: Node[]
    isSingleCallExpr: boolean
}

export interface Manifest {
    "base:manifest": NodeBase
}

export interface IncludableChunkDescription {
    "base:includable-file-desc": NodeBase
}

export interface TestSuiteExpression {
    "base:test-suite-expr": NodeBase
    isStatement: boolean
}

export interface TestCaseExpression {
    "base:test-case-expr": NodeBase
    isStatement: boolean
}

export interface XMLElement {
    "base:xml-elem": NodeBase
    rawElementContentStart: number
    rawElementContentEnd: number
    estimatedRawElementType: "js-script" | "hyperscript-script" | "css-style"
}

