import { resolve } from 'node:path'
import { build as viteBuild, defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

let buildingTemplate = false

export default defineConfig({
  plugins: [
    svelte(),
    viteSingleFile(),
    {
      name: 'build-template-singlefile',
      apply: 'build',
      async closeBundle() {
        if (buildingTemplate || process.env.BUILD_ENTRY === 'template') return
        buildingTemplate = true
        try {
          process.env.BUILD_ENTRY = 'template'
          await viteBuild({
            configFile: false,
            plugins: [svelte(), viteSingleFile()],
            build: {
              emptyOutDir: false,
              rollupOptions: {
                input: resolve(import.meta.dirname, 'template.html'),
              },
            },
          })
        } finally {
          delete process.env.BUILD_ENTRY
          buildingTemplate = false
        }
      },
    },
  ],
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
    },
  },
})
