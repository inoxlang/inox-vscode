import { LanguageService, TokenType } from 'vscode-html-languageservice';
import { InoxExtensionContext } from './inox-extension-context';
import * as vscode from 'vscode';

interface EmbeddedRegion {
	languageId: string | undefined;
	start: number;
	end: number;
	attributeValue?: boolean;
}

export function isInsideEmbeddedRegion(
	languageService: LanguageService,
	documentText: string,
	offset: number,
	lang: 'css' | 'js' | 'hyperscript'
) {
	const scanner = languageService.createScanner(documentText);

	let token = scanner.scan();
	while (token !== TokenType.EOS) {
		switch (token) {
			case TokenType.Styles:
				if (lang == 'css' && offset >= scanner.getTokenOffset() && offset <= scanner.getTokenEnd()) {
					return true;
				}
				break
			case TokenType.Script:
				if (lang == 'js' && offset >= scanner.getTokenOffset() && offset <= scanner.getTokenEnd()) {
					return true;
				}
		}
		token = scanner.scan();
	}
	
	return false;
}

export function getEmbeddedBlockVirtualContent(
	languageService: LanguageService,
	documentText: string,
	lang: 'css' | 'js'
): string {
	const regions: EmbeddedRegion[] = [];
	const scanner = languageService.createScanner(documentText);

	let token = scanner.scan();
	while (token !== TokenType.EOS) {
		switch (token) {
			case TokenType.Styles:
				regions.push({
					languageId: 'css',
					start: scanner.getTokenOffset(),
					end: scanner.getTokenEnd()
				});
				break;
			case TokenType.Script:
				regions.push({
					languageId: 'js',
					start: scanner.getTokenOffset(),
					end: scanner.getTokenEnd()
				});
				break;
		}
		token = scanner.scan();
	}

	let content = documentText
		.split('\n')
		.map(line => {
			return ' '.repeat(line.length);
		}).join('\n');

	regions.forEach(r => {
		if (lang == 'css' && r.languageId === 'css') {
			content = content.slice(0, r.start) + documentText.slice(r.start, r.end) + content.slice(r.end);
		}
		if (lang == 'js' && r.languageId === 'js') {
			content = content.slice(0, r.start) + documentText.slice(r.start, r.end) + content.slice(r.end);
		}
	});

	return content;
}


export function createEmbeddedContentProvider(ctx: InoxExtensionContext): vscode.TextDocumentContentProvider {
	return {
	  provideTextDocumentContent: uri => {
		const originalUri = uri.path.slice(1).slice(0, -4);
		const decodedUri = decodeURIComponent(originalUri);
		return ctx.virtualDocumentContents.get(decodedUri);
	  }
	}
  }