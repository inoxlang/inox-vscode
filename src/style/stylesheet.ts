import * as vscode from 'vscode';


export function getBaseStylesheet(){
    const activeColorThemeKind = vscode.window.activeColorTheme.kind
    const darkTheme =  activeColorThemeKind == vscode.ColorThemeKind.Dark || activeColorThemeKind == vscode.ColorThemeKind.HighContrast

     const BASE_STYLESHEET = /*css*/`

        *, *::before, *::after {
            box-sizing: border-box;
        }

        html, body {
            height: 100%;
            padding-top: 5px;
            overflow: hidden;
        }
        
        body {
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            font-weight: var(--vscode-font-weight);

            --thin-border: 1px solid rgba(136, 136, 136, 0.568);
        }

        button {
            background: var(--vscode-button-background);
            color: var(--vscode-foreground);

            padding: 0 15px;
            text-align: center;
            height: 32px;
            line-height: 30px;
            max-width: 200px;
            border: none;
            border-radius: 2px;
        }

        button:hover {
            cursor: pointer;
            background: var(--vscode-button-hoverBackground);
        }

        .muted-text {
            color: var(--vscode-descriptionForeground);
        }

        input {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: var(--vscode-input-border);

            height: 32px;
            line-height: 20px;
            max-width: 200px;
            padding: 0 5px;
        }

        input:focus {
            border: var(--vscode-focusBorder);
            border-radius: 1px;
        }

        ul, li {
            list-style: none;
            padding: 0;
            margin: 0;
        }
    `

    return BASE_STYLESHEET
}

