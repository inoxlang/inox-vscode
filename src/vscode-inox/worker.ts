import { readFileSync, writeFileSync } from 'fs';
import { Go } from './wasm_exec';

import {parentPort} from 'worker_threads'
import { join } from 'path';

const parent = parentPort!


const go = new Go();

/** @type {WebAssembly.Module} */
let mod;

/** @type {WebAssembly.Instance} */
let inst;


type InoxExports = {
  setup: (arg: {IWD: string, print_debug: Function}) => any,
  write_lsp_input: (s: string) => void,
  read_lsp_output: () => string
}


const wasmBytes = readFileSync(join(__dirname, '../../vscode-inox.wasm'))

WebAssembly.instantiate(
  wasmBytes,
  (go as any).importObject,
).then(
  async result => {
    mod = result.module;
    inst = result.instance;
    let lastReadLSPTime = Date.now()


    const print_debug = (...args: string[]) => {
      parent.postMessage({ method: 'print_debug', id: Math.random(), args: args})
    }

    go.run(inst);

    setTimeout(() => {
      let exports = go.exports as InoxExports;

      exports.setup({
        IWD: '/',
        print_debug: print_debug
      })

      parent.postMessage('initialized')
      
      parent.on('message', data => {
        let {method, args, id} = data

        switch(method){
        case "write_lsp_input": {
          if(id === undefined){
            parent.postMessage({ method, response: null, error:  'missing .id in call to write_lsp_input'})
          }

          let input = args.input
          if(input === undefined){
            parent.postMessage({ method, response: null, error:  'missing .input in call to write_lsp_input'})
          } else {
            if(typeof input != 'string'){
              parent.postMessage({ method, response: null, error:  'invalid .input in call to write_lsp_input'})
              break
            }
            exports.write_lsp_input(String(input))
            parent.postMessage({ method, id, response: null })
          }

          break
        }
        case "read_lsp_output": {
          if(id === undefined){
            parent.postMessage({ method, response: null, error:  'missing .id in call to read_lsp_output'})
            break
          }

          let output = ''
          const now = Date.now()
          const timeSinceLastRead = now - lastReadLSPTime
          lastReadLSPTime = now

          if(timeSinceLastRead > 50){
            output = exports.read_lsp_output()
          }

          parent.postMessage({ method, id, response: output })

          break
        }
        default:
          parent.postMessage({ error: 'unknown method ' + method})
        }

      })
    }, 10)
  },
);

