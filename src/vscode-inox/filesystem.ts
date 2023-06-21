import * as fs from 'fs'
import { join } from 'path'
import { inspect } from 'util'
import { printDebug, printTrace } from './debug'


const FILESYSTEM_METADATA_FILENAME = 'metadata.json'

export function saveFilesystemMetadata(metadata: any[], localFilesystemDir: string){
    fs.mkdirSync(localFilesystemDir, {
        recursive: true
    })

    const metadataFilePath = join(localFilesystemDir, FILESYSTEM_METADATA_FILENAME)

    fs.writeFileSync(metadataFilePath, JSON.stringify(metadata, null, " "))
}


export function deleteOldFileContents(metadata: any[], localFilesystemDir: string){
    if(!fs.existsSync(localFilesystemDir)) {
        return
    }

    const checksums = metadata.map(m => m.checksumSHA256).filter(m => m !== undefined)
    if(checksums.every(e => typeof e == 'string')){
        const entriesToDelete = fs.readdirSync(localFilesystemDir).filter(entry => !checksums.includes(entry) && !entry.endsWith('.json'))
        
        if(entriesToDelete.length == 0){
            printTrace('no file contents to delete')
        }

        entriesToDelete.forEach(entry => {
            if(checksums.includes(entry)){
                return
            }
            const path = join(localFilesystemDir, entry)
            printTrace('delete file content', path)
            fs.rmSync(path)
        })
    } else {
        printDebug('invalid checksums', JSON.stringify(checksums, null, ' '))
    }
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

    printTrace('save file content', filePath)

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