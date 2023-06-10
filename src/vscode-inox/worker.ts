import { readFileSync, writeFileSync } from 'fs';
import { parentPort } from 'worker_threads'
import { join } from 'path';

import { Go, setPrintDebug } from './wasm_exec';

const parent = parentPort!
const printDebug = (...args: string[]) => {
  parent.postMessage({ method: 'print_debug', id: Math.random(), args: args })
}
setPrintDebug(printDebug)

const go = new Go();
const wasmBytes = readFileSync(join(__dirname, '../../vscode-inox.wasm'))

let mod: WebAssembly.Module;
let inst: WebAssembly.Instance;
let lastReadLSPTime = Date.now()

type InoxExports = {
  setup: (arg: { IWD: string, print_debug: Function }) => any,
  write_lsp_input: (s: string) => void,
  read_lsp_output: () => string
}



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
    }, 10)
  },
);



function setup() {
  let exports = go.exports as InoxExports;

  exports.setup({
    IWD: '/',
    print_debug: printDebug
  })

  parent.postMessage('initialized')

  parent.on('message', data => {
    let { method, args, id } = data

    switch (method) {
      case "write_lsp_input": {
        if (id === undefined) {
          parent.postMessage({ method, response: null, error: 'missing .id in call to write_lsp_input' })
        }

        let input = args.input
        if (input === undefined) {
          parent.postMessage({ method, response: null, error: 'missing .input in call to write_lsp_input' })
        } else {
          if (typeof input != 'string') {
            parent.postMessage({ method, response: null, error: 'invalid .input in call to write_lsp_input' })
            break
          }
          exports.write_lsp_input(String(input))
          parent.postMessage({ method, id, response: null })
        }

        break
      }
      case "read_lsp_output": {
        if (id === undefined) {
          parent.postMessage({ method, response: null, error: 'missing .id in call to read_lsp_output' })
          break
        }

        let output = ''
        const now = Date.now()
        const timeSinceLastRead = now - lastReadLSPTime
        lastReadLSPTime = now

        if (timeSinceLastRead > 50) {
          output = exports.read_lsp_output()
        }

        parent.postMessage({ method, id, response: output })

        break
      }
      default:
        parent.postMessage({ error: 'unknown method ' + method, id })
    }

  })
}