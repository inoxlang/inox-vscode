export interface ChangeInfo {
    absoluteFilepath: string
    status: string
}

export interface CommitInfo {
    hashHex: string
    message: string
    author: SignatureInfo
    committer: SignatureInfo
}

export interface SignatureInfo {
    name: string
    email: string
    when: number
}
