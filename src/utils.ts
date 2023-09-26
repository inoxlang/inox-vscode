import { inspect } from "util"

export function stringifyCatchedValue(val: unknown){
    let msg = ''
    if(val instanceof Error){
        msg = val.message
        if(val.stack){
            msg += '\n' + val.stack
        }
    } else {
        msg = inspect(val) + ' '

    }

    msg += Error().stack

    return msg
}

export function sleep(timeMillis: number){
    return new Promise<void>((resolve) => {
        setTimeout(() => resolve(), timeMillis)
    })
}

export function assertNotNil<T>(v: T): asserts v is NonNullable<T> {
    if(v === undefined || v === null){
        throw new Error("value is nil or undefined")
    } 
}