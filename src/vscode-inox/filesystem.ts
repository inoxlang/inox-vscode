import * as fs from 'fs'
import { join } from 'path'
import { inspect } from 'util'


const FILESYSTEM_METADATA_FILENAME = 'metadata.json'

export function saveFilesystemMetadata(metadata: unknown, localFilesystemDir: string){
    fs.mkdirSync(localFilesystemDir, {
        recursive: true
    })

    const metadataFilePath = join(localFilesystemDir, FILESYSTEM_METADATA_FILENAME)

    fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, " "))
}

export function getFilesystemMetadata(localFilesystemDir: string): [metadata: unknown, err: string]{
    if(!fs.existsSync(localFilesystemDir)) {
        return [null, ""]
    }

    const metadataFilePath = join(localFilesystemDir, FILESYSTEM_METADATA_FILENAME)

    let content: Buffer
    try {
        content = fs.readFileSync(metadataFilePath)
    } catch(err) {
        if(err instanceof Error){
            return [null, err.message]
        }
        return [null, inspect(err)]
    }

    return [JSON.parse(content.toString('utf8')), '']
}

export function saveEncodedFileContent(checksumSHA256: string, base64Content: string, localFilesystemDir: string){
    fs.mkdirSync(localFilesystemDir, {
        recursive: true
    })

    const filePath = join(localFilesystemDir, checksumSHA256)


    fs.writeFileSync(filePath,  Buffer.from(base64Content, 'base64'))
}

export function getFileContent(checksumSHA256: string, localFilesystemDir: string){
    fs.mkdirSync(localFilesystemDir, {
        recursive: true
    })

    const filePath = join(localFilesystemDir, checksumSHA256)

    const content = fs.readFileSync(filePath)
    return Buffer.from(content).toString('base64')
}