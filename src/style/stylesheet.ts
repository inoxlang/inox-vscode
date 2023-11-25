import * as vscode from 'vscode';


export function getBaseStyleeshet(){
    const activeColorThemeKind = vscode.window.activeColorTheme.kind
    const darkTheme =  activeColorThemeKind == vscode.ColorThemeKind.Dark || activeColorThemeKind == vscode.ColorThemeKind.HighContrast

     const BASE_STYLESHEET = /*css*/`

        body {
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            font-weight: var(--vscode-font-weight);
        }

        button {
            background: var(--vscode-button-background);
            color: var(--vscode-foreground);

            padding: 0 15px;
            margin-left: var(--padding);
            text-align: center;
            height: 32px;
            line-height: 30px;
            max-width: 200px;
            box-sizing: border-box;
            border: none;
            border-radius: 2px;
        }

        button:hover {
            cursor: pointer;
            background: var(--vscode-button-hoverBackground);
        }
    `

    return BASE_STYLESHEET
}

