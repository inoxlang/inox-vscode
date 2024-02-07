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

export function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}


export function parseSemverParts(s: string): [number, number, number] {
    if (s[0] == 'v'){
        s = s.slice(1)
    }

    const parts = s.split('.')
    const ints = parts.map(p => parseInt(p))
    switch(ints.length){
    case 1:
        return [ints[0], 0, 0]
    case 2:
        return [ints[0], ints[1], 0]
    case 3:
        return ints as [number, number, number]
    default:
        throw new Error('invalid semver: ' + s)
    }
}


export function greaterOrEqualSemver(a: [number, number, number], b: [number, number, number]): boolean {
    return a.every((part, index) => part >= b[index])
}

export function equalSemver(a: [number, number, number], b: [number, number, number]): boolean {
    return a.every((part, index) => part == b[index])
}