/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  compilerOptions: {
    customElement: true,
  },
  vitePlugin: {
    dynamicCompileOptions({ filename }) {
      if (!filename.endsWith('AgGraph.svelte')) {
        return { customElement: false }
      }
    },
  },
}
