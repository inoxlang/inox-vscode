import { InoxExtensionContext } from "../inox-extension-context"

const PROJECT_KEY_PREFIX = 'project/'


export function getStateValue(ctx: InoxExtensionContext, key: string) {
    return ctx.getStateValue(PROJECT_KEY_PREFIX + key)
}

export function setStateValue(ctx: InoxExtensionContext, key: string, value: unknown) {
    return ctx.setStateValue(PROJECT_KEY_PREFIX + key, value)
}

