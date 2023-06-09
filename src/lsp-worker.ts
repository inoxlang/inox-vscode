import { join } from "path";
import { inspect } from "util";
import { StreamInfo } from "vscode-languageclient/node";
import { Worker } from 'worker_threads';
import { InoxExtensionContext } from "./inox-extension-context";
import stream from 'stream'

let currentWorker: Worker;

export function createStartInoxWorker(ctx: InoxExtensionContext): () => Promise<StreamInfo> {
    return async () => {
      if(currentWorker){
        await currentWorker.terminate()
      }
  
      const workerPath = join(__dirname, './vscode-inox/worker.js')
      const responseCallbacks: Record<string, ((response: unknown) => any)> = {};

      ctx.outputChannel.appendLine('worker\'s path: ' + workerPath.toString())
    
    
      //create worker
      const inoxWorker = new Worker(workerPath, {})
      currentWorker = inoxWorker
    
      //add listeners
      inoxWorker.on('error', (ev) => {
        ctx.outputChannel.appendLine('worker: ' + inspect(ev))
      })
    
      inoxWorker.on('message', (data) => {
        let {method, id, response} = data

        if(method == 'print_debug'){
          ctx.debugOutputChannel.appendLine(Array.from(data.args).join(' '))
          return
        }

        if(typeof id !== undefined){ //response
          let callback = responseCallbacks[id]
          if(callback){
            delete responseCallbacks[id]
            callback(response)
          } else {
            console.error('no response callback for reques with id', id)
          }
        } else { //notification 
    
        }
      })
    
      inoxWorker.on('messageerror', (ev) => {
        ctx.outputChannel.appendLine('worker: ' + inspect(ev))
      })
    
      const sendRequestToInoxWorker = async (method: string, args: unknown) => {
        let id = Math.random()
        inoxWorker.postMessage({ method, args, id });
        return new Promise((resolve, reject) => {
          setTimeout(reject, 2000)
          responseCallbacks[id] = resolve
        })
      }

      //create reader & writer for the LSP client
    
      const reader = new stream.Readable({
        async read(){
            const data = await sendRequestToInoxWorker('read_lsp_output', null)
            this.push(data)
          }
      })
  
      const writer = new stream.Writable({
        async write(chunk){
          if(chunk instanceof Uint8Array){
            chunk = new TextDecoder().decode(chunk)
          }
          await sendRequestToInoxWorker('write_lsp_input', {input: chunk})
        }
      })
  
      return {
        reader: reader as unknown as NodeJS.ReadableStream,
        writer: writer as unknown as NodeJS.WritableStream,
      }
    }
   
  }