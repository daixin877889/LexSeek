/**
 * Fallback vitest 配置 - 使用 OXC 替代 esbuild
 *
 * 用途：当 esbuild binary 在某些沙箱/CI 环境被 SIGKILL 时（macOS 沙箱常见问题），
 * 用这个配置绕开。正常环境应使用 `vitest.config.ts`。
 *
 * 使用：
 *   npx vitest run tests/path/to/your.test.ts --config vitest.scanner.config.mjs --configLoader native
 *
 * 注：CLI 传入的测试文件路径会覆盖 include；如不传则匹配 assistant/document 下全部测试。
 */
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
    include: ['tests/server/assistant/document/**/*.test.ts'],
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
