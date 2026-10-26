import runtimeCss from './app.css?inline'
import AgGraph from './lib/AgGraph.svelte'

const STYLE_ID = 'autograph-runtime-styles'

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const styleEl = document.createElement('style')
  styleEl.id = STYLE_ID
  styleEl.textContent = runtimeCss
  const target = document.head || document.documentElement
  target?.prepend(styleEl)
}

if (
  typeof customElements !== 'undefined' &&
  !customElements.get('ag-graph') &&
  AgGraph.element
) {
  customElements.define('ag-graph', AgGraph.element)
}

export { AgGraph, runtimeCss }
