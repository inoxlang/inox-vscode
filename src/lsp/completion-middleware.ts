import * as vscode from 'vscode';
import { CompletionMiddleware } from "vscode-languageclient"
import { getLanguageService } from 'vscode-html-languageservice';

import { getEmbeddedBlockVirtualContent, isInsideEmbeddedRegion } from '../embedded-support';
import { InoxExtensionContext } from '../inox-extension-context';

const htmlLanguageService = getLanguageService();


export function makeProvideCompletionItemFn(ctx: InoxExtensionContext): CompletionMiddleware['provideCompletionItem'] {
    return async (document, position, context, token, next) => {
        const docText = document.getText()
        const offsetAtPosition = document.offsetAt(position)

        const inCSS = isInsideEmbeddedRegion(htmlLanguageService, docText, offsetAtPosition, 'css')
        const inJS = isInsideEmbeddedRegion(htmlLanguageService, docText, offsetAtPosition, 'js')

        //if not in CSS or JS do no forward request forwarding
        if (!inCSS && !inJS) {
            return await next(document, position, context, token);
        }

        const lang = inCSS ? 'css' : 'js'

        const originalUri = document.uri.toString(true);
        ctx.virtualDocumentContents.set(originalUri, getEmbeddedBlockVirtualContent(htmlLanguageService, docText, lang));

        const vdocUriString = `embedded-content://${lang}/${encodeURIComponent(
            originalUri
        )}.${lang}`;

        const vdocUri = vscode.Uri.parse(vdocUriString);
        return await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            vdocUri,
            position,
            context.triggerCharacter
        );
    }
}