import { mount } from 'svelte'
import './app.css'
import AgGraph from './lib/AgGraph.svelte'
import App from './App.svelte'

// Ensure <ag-graph> is registered and never tree-shaken
if (typeof customElements !== 'undefined' && !customElements.get('ag-graph') && AgGraph.element) {
  customElements.define('ag-graph', AgGraph.element)
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
