import { inspect } from "util"

export function stringifyCatchedValue(val: unknown){
    let msg = ''
    if(val instanceof Error){
        msg = val.message
        if(val.stack){
            msg += '\n' + val.stack
        }
    } else {
        msg = inspect(val)
    }

    msg += Error().stack

    return msg
}