import * as https from 'https';
import { InoxExtensionContext } from "../inox-extension-context";
import { generate } from 'selfsigned';


const STATE_KEY_FOR_SELF_SIGNED_CERT = 'localhost-self-signed-certificates'

interface SelfSignedCerticate {
    cert: string
    key: string
}

// getSelfSignedCertificate returns a persisted self-signed certificate or generates a new one.
export function getSelfSignedCertificate(ctx: InoxExtensionContext): https.ServerOptions {

    let selfSignedCert = ctx.getStateValue(STATE_KEY_FOR_SELF_SIGNED_CERT) as SelfSignedCerticate | undefined
    if (selfSignedCert !== undefined) {
        return selfSignedCert
    }

    const certGenerationAttributes = [
        {
            name: 'commonName',
            value: 'Acme Co - ' + Math.random()
        }
    ]

    const { cert, private: key } = generate(certGenerationAttributes, { days: 365 });

    selfSignedCert = { cert, key }
    ctx.setStateValue(STATE_KEY_FOR_SELF_SIGNED_CERT, selfSignedCert)

    return selfSignedCert
}