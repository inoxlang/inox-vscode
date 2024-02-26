import * as path from 'path'
import * as fs from 'fs'

const HYPER_SCRIPT_MIN_JS_PATH = path.join(__dirname, '..', '..', 'assets', 'hyperscript.min.js')
export const HYPER_SCRIPT_MIN_JS = fs.readFileSync(HYPER_SCRIPT_MIN_JS_PATH).toString('utf-8')

export const CSS_SCOPE_INLINE_JS = `
//https://github.com/gnat/css-scope-inline/blob/7aa5c4c91e8ed032a91ba7f8cdee3f3d46563482/script.js
// 🌘 CSS Scope Inline (https://github.com/gnat/css-scope-inline)
window.cssScopeCount ??= 1 // Let extra copies share the scope count.
window.cssScope ??= new MutationObserver(mutations => { // Allow 1 observer.
	document?.body?.querySelectorAll('style:not([ready])').forEach(node => { // Faster than walking MutationObserver results when recieving subtree (DOM swap, htmx, ajax, jquery).
		var scope = 'me__'+(window.cssScopeCount++) // Ready. Make unique scope, example: .me__1234
		node.parentNode.classList.add(scope)
		node.textContent = node.textContent
		.replace(/(?:^|\.|(\s|[^a-zA-Z0-9\-\_]))(me|this|self)(?![a-zA-Z])/g, '$1.'+scope) // Can use: me this self
		.replace(/((@keyframes|animation:|animation-name:)[^{};]*)\.me__/g, '$1me__') // Optional. Removes need to escape names, ex: "\.me"
		.replace(/(?:@media)\s(xs-|sm-|md-|lg-|xl-|sm|md|lg|xl|xx)/g, // Optional. Responsive design. Mobile First (above breakpoint): 🟢 None sm md lg xl xx 🏁  Desktop First (below breakpoint): 🏁 xs- sm- md- lg- xl- None 🟢 *- matches must be first!
			(match, part1) => { return '@media '+({'sm':'(min-width: 640px)','md':'(min-width: 768px)', 'lg':'(min-width: 1024px)', 'xl':'(min-width: 1280px)', 'xx':'(min-width: 1536px)', 'xs-':'(max-width: 639px)', 'sm-':'(max-width: 767px)', 'md-':'(max-width: 1023px)', 'lg-':'(max-width: 1279px)', 'xl-':'(max-width: 1535px)'}[part1]) }
		)
		node.setAttribute('ready', '')
	})
}).observe(document.documentElement, {childList: true, subtree: true})
`

