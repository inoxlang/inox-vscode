import { join } from "path";
import { inspect } from "util";
import { Worker } from 'worker_threads';
import { InoxExtensionContext } from "./inox-extension-context";
import stream from 'stream'

let currentWorker: Worker;

export async function createWebsocketServerWorker(ctx: InoxExtensionContext): Promise<void> {
  if (currentWorker) {
    ctx.debugOutputChannel.appendLine('terminate previous inox worker')
    await currentWorker.terminate()
  }


  const workerPath = join(__dirname, './vscode-inox/worker.js')
  const responseCallbacks: Record<string, ((response: unknown) => any)> = {};

  ctx.outputChannel.appendLine('worker\'s path: ' + workerPath.toString())

  //create worker
  const inoxWorker = new Worker(workerPath, {})
  currentWorker = inoxWorker


  return new Promise((resolve, reject) => {
    //add listeners
    inoxWorker.on('error', (ev) => {
      ctx.outputChannel.appendLine('sent by worker: ' + inspect(ev))
      reject()
    })

    inoxWorker.on('messageerror', (ev) => {
      ctx.outputChannel.appendLine('sent by worker: ' + inspect(ev))
      reject()
    })

    inoxWorker.on('message', (data) => {
      if (data == 'initialized') {
        resolve()
        return
      }

      let { method, id, response } = data

      if (method == 'print') {
        ctx.outputChannel.appendLine(Array.from(data.args).join(' '))
        return
      }

      if (method == 'print_debug') {
        ctx.debugOutputChannel.appendLine(Array.from(data.args).join(' '))
        return
      }

      if (id !== undefined) { //response
        let callback = responseCallbacks[id]
        if (callback) {
          delete responseCallbacks[id]
          callback(response)
        } else {
          ctx.debugOutputChannel.appendLine('no response callback for request with id ' + id)
        }
      } else { //notification 

      }
    })
  })


}