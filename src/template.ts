import './app.css'
import AgGraph from './lib/AgGraph.svelte'

if (
  typeof customElements !== 'undefined' &&
  !customElements.get('ag-graph') &&
  AgGraph.element
) {
  customElements.define('ag-graph', AgGraph.element)
}
