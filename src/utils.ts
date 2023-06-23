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