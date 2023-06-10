import { readFileSync } from 'fs';
import { parentPort } from 'worker_threads';

import { join } from 'path';


import { Go, InoxExports } from './wasm';
import { printDebug } from './debug';
import { WebsocketLanguageServer } from './websocket-server';

const parent = parentPort!
const go = new Go();
const wasmBytes = readFileSync(join(__dirname, '../../vscode-inox.wasm'))

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
    print_debug: printDebug
  })


  const server = new WebsocketLanguageServer(exports)
  server.start()

  parent.postMessage('initialized')
}
