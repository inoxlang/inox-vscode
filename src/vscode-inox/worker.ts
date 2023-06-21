import { readFileSync } from 'fs';
import { parentPort, workerData } from 'worker_threads';

import { join } from 'path';


import { Go, InoxExports } from './wasm';
import { printDebug, printTrace } from './debug';
import { WebsocketLanguageServer } from './websocket-server';
import { deleteOldFileContents, getFileContent, getFilesystemMetadata, saveEncodedFileContent, saveFilesystemMetadata } from './filesystem';


const parent = parentPort!
const go = new Go();
const wasmBytes = readFileSync(join(__dirname, '../../vscode-inox.wasm'))
const localFilesystemDir = workerData.localFilesystemDir

let mod: WebAssembly.Module;
let inst: WebAssembly.Instance;


WebAssembly.instantiate(
  wasmBytes,
  (go as any).importObject,
).then(
  async result => {
    mod = result.module;
    inst = result.instance;

    go.run(inst);

    setTimeout(() => {
      setup()
    }, 50)
  },
);



function setup() {
  const exports = go.exports as InoxExports;

  exports.setup({
    IWD: '/',
    print_debug: printDebug,
    print_trace: printTrace,

    get_file_content(checksumSHA256){
      return [getFileContent(checksumSHA256, localFilesystemDir), '']
    },
    get_filesystem_metadata(){
      return getFilesystemMetadata(localFilesystemDir)
    },

    save_file_content(checksumSHA256, encodedContent){
      saveEncodedFileContent(checksumSHA256, encodedContent, localFilesystemDir)
    },
    save_filesystem_metadata(metadata){
      if(!Array.isArray(metadata)) {
        printDebug('metadata of filesystem should be an array')
        return
      }
      saveFilesystemMetadata(metadata, localFilesystemDir)
      deleteOldFileContents(metadata, localFilesystemDir)
    }
  })

  const server = new WebsocketLanguageServer(exports)
  server.start()

  parent.postMessage('initialized')
}
