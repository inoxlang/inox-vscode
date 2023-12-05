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

            --success-background: rgb(22, 161, 22);
            --success-foreground: rgb(223, 223, 223);

            --transitional-state-background: rgb(22, 161, 22);
            --transitional-state-foreground: rgb(209, 209, 36);;

            --error-background: rgb(22, 161, 22);
            --error-foreground: rgb(214, 23, 23);
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

        button:not(:disabled):hover {
            cursor: pointer;
            background: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 50%;
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

        header {
            font-weight: 700;
        }
    `

    return BASE_STYLESHEET
}

