import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'oxc-transform'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = __dirname
const appDir = resolve(rootDir, 'app')
const sharedDir = resolve(rootDir, 'shared')
const serverDir = resolve(rootDir, 'server')

// OXC TypeScript transformer plugin (replaces vite:esbuild)
const oxcTsPlugin = {
  name: 'oxc-ts',
  transform(code, id) {
    if (!id.match(/\.[cm]?tsx?(\?.*)?$/)) return null
    if (id.includes('node_modules')) return null
    const result = transformSync(id.replace(/\?.*$/, ''), code)
    if (result.errors && result.errors.length > 0) {
      throw new Error('OXC transform error: ' + result.errors[0])
    }
    return { code: result.code, map: result.map ?? undefined }
  }
}

export default defineConfig({
  root: rootDir,
  esbuild: false,
  plugins: [oxcTsPlugin],
  test: {
    include: ['tests/server/assistant/document/templateScanner.test.ts'],
    testTimeout: 30000,
    environment: 'node',
    server: {
      deps: {
        inline: ['#shared/**', '~~/**'],
      },
    },
  },
  resolve: {
    alias: {
      '#shared': sharedDir,
      '#shared/types/document': resolve(sharedDir, 'types/document.ts'),
      '~~': rootDir,
      '~~/*': resolve(rootDir, '*'),
      '~/server': serverDir,
      '~': appDir,
    },
  },
})
