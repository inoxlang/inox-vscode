import DOMPurify from 'isomorphic-dompurify';

import { CommitInfo } from "./data_types"

export function renderLog(commits: CommitInfo[], cssNonce: string) {

    const renderedCommits = commits.map(commit => {
        const messageStart = DOMPurify.sanitize(commit.message.slice(0, 60))
        const messageRest = DOMPurify.sanitize(commit.message.slice(60))

        const hash = DOMPurify.sanitize(commit.hashHex)
        const hashStart = DOMPurify.sanitize(commit.hashHex.slice(0, 7))
        const authorName = DOMPurify.sanitize(commit.author.name)
        const authorEmail = DOMPurify.sanitize(commit.author.email)

        return /*html*/`<li class='commit' _='on click toggle .expanded on me'>
            <div class='summary'>
                <span class='message'>
                    ${
                        (messageRest == '') ? messageStart : messageStart + '...'
                    }
                </span>

                <span class='hash-start hide-if-expanded' _='on click halt'>
                    ${hashStart}
                </span>
            </div>
          
            <div class='details show-if-expanded' _='on click halt'>
                ${
                    (messageRest ? 
                        `<span>...${messageRest}</span>`    
                        : ''
                    )
                }
                <span>Author: ${authorName} &lt;${authorEmail}&gt;</span>
                <span>Hash: ${hash}</span>
            </div>
        </li>`;
    })
    return /*html*/`<ul class='commits'>
        ${renderedCommits.join('\n')}

        <style nonce='${cssNonce}'>

            me {
                display: flex;
                flex-direction: column;
                gap: 7px;
                width: 100%;
            }

            me .commit {
                display: flex;
                flex-direction: column;
                padding: 7px;
                border-bottom: 1px solid grey;
                width: 100%;
                gap: 5px;
            }

            me .message:hover {
                filter: brightness(1.25);
            }

            me .commit .summary {
                display: grid;
                grid-template-columns: 80% 20%;
                cursor: pointer;
                gap: 5px;
                width: 100%;
            }

            me .commit .hash-start {
                text-align: end;
            }

            me .commit .message {
                font-weight: 700;
            }

            me .commit .details {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            me .commit.expanded .hide-if-expanded {
                display: none;
            }

            me .commit:not(.expanded) .show-if-expanded {
                display: none;
            }
        </style>
    </ul>`
}