import { parentPort } from "worker_threads"

export const printDebug = (...args: string[]) => {
    parentPort!.postMessage({ method: 'print_debug', id: Math.random(), args: args })
}