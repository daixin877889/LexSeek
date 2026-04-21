# Nuxt 显式导入迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 Nuxt/Vue/H3 内置自动导入的前提下，取消 LexSeek 项目级自动导入与组件自动注册，并把项目源码、测试与文档统一迁移到显式导入模式。

**Architecture:** 先构建可重复执行的 audit/check/codemod 工具链，再按“服务端 -> 前端脚本 -> 组件（含 `ai-elements` 专项）-> 测试基建 -> 文档与守卫”顺序切换。`.vue` 文件一律通过 SFC-safe 编辑器写入 `<script setup>` import，不允许把 `import` 直接插到 SFC 顶部；项目符号扫描同时覆盖 `<template>`、`<script>` 和 `<script setup>`。`ai-elements` 组件不做字符串猜测，而是以真实组件文件路径和现有 barrel export 为真相源，只有 unresolved 为空后才关闭对应 Nuxt 自动注册开关。

**Tech Stack:** Nuxt 4 / Vue 3 / Nitro / TypeScript / tsx / Vitest + @nuxt/test-utils / @vue/compiler-sfc / ripgrep / Bun scripts / Git

---

## Spec 对齐（1:1）

| spec | 本 plan |
|---|---|
| 关闭项目级 `components` / `imports.dirs` / `nitro.imports.dirs` | Task 4 / Task 6 / Task 8 |
| 保留 Nuxt/Vue/H3 内置自动导入 | Task 6（`imports.scan: false`）+ Task 8（`components.dirs: []`） |
| `server/services` / `shared/utils` / `app/store` / `app/composables` 全显式化 | Task 4 / Task 6 |
| `app/components/ai-elements` 专项治理 | Task 7 / Task 8 |
| 测试不再依赖项目级全局注入 | Task 9 |
| 文档和后续守卫更新 | Task 10 |
| 最终验证 | Task 11 |

## 文件结构（新增/修改）

### 迁移工具

```
scripts/nuxt-explicit-imports/
├── audit.ts
├── check.ts
├── transform-server.ts
├── transform-app-symbols.ts
├── transform-components.ts
└── shared/
    ├── aiElementsExports.ts
    ├── fileSets.ts
    ├── loadNuxtArtifacts.ts
    ├── importBlock.ts
    ├── sfc.ts
    ├── symbolUsage.ts
    ├── serverTransform.ts
    ├── appTransform.ts
    └── componentResolver.ts
```

### 核心配置

```
nuxt.config.ts
package.json
vitest.config.ts
```

### 测试

```
tests/shared/nuxt-explicit-imports/
├── loadNuxtArtifacts.test.ts
├── check.test.ts
├── serverTransform.test.ts
├── appTransform.test.ts
└── componentTransform.test.ts

tests/server/agent/test-setup.ts
tests/server/case/test-setup.ts
tests/server/material/test-setup.ts
tests/server/membership/test-setup.ts
```

### 文档

```
docs/tech-docs/architecture/auto-imports.md
docs/tech-docs/frontend/overview.md
docs/tech-docs/frontend/composables.md
docs/tech-docs/frontend/stores.md
docs/tech-docs/patterns/service-dao.md
docs/tech-docs/guides/new-module-checklist.md
docs/tech-docs/guides/testing-strategy.md
```

### 运行时输出（不提交）

```
.cache/nuxt-explicit-imports/
├── ai-elements-exports.json
├── manifest.json
├── findings.json
├── server-unresolved.json
├── app-unresolved.json
└── components-unresolved.json
```

## 复用与约束

| 资产 / 约束 | 用法 |
|---|---|
| `.nuxt/imports.d.ts` / `.nuxt/types/nitro-imports.d.ts` / `.nuxt/components.d.ts` | 作为 audit 与 codemod 的真相源 |
| `server/utils/db.ts` | `prisma` 的唯一显式导入来源 |
| `#shared/utils/logger` | `logger` 的唯一显式导入来源 |
| `#shared/utils/apiResponse` | `resSuccess` / `resError` / `parseErrorMessage` 的唯一显式导入来源 |
| `app/components/ui/*/index.ts` | UI 组件显式导入优先使用目录出口，而不是单文件路径 |
| `app/components/ai-elements/**/index.ts` | `AiElements...` 显式导入优先使用子目录或根目录 barrel export |
| `scripts/nuxt-explicit-imports/shared/importBlock.ts` | 只用于 `.ts` / Nitro 源文件；`.vue` 文件必须走 `shared/sfc.ts` 的 SFC-safe 注入 |
| Nuxt 官方建议 | 项目自定义导入使用 `imports.scan: false`，组件自动注册使用 `components.dirs: []`，不要使用 `imports.autoImport: false` 把内置能力一并关掉 |
| 项目规则 | 类型检查统一使用 `npx nuxi typecheck`；不要用 `tsc` |

---

## Task 0: 基线确认与安全启动

**Files:** 仅读

- [ ] **Step 1: 确认 spec 已在当前分支可见**

Run: `git show --stat --oneline 019c61ac`
Expected: 显示 `docs(superpowers): add explicit imports migration design`

- [ ] **Step 2: 记录当前配置块位置，后续 diff 才不会误删**

Run:

```bash
nl -ba nuxt.config.ts | sed -n '20,150p'
```

Expected:

- `components` 在约 24 行
- `imports` 在约 108 行
- `nitro.imports` 在约 123 行

- [ ] **Step 3: 运行当前基线命令**

Run:

```bash
npx nuxt prepare
npx nuxi typecheck
```

Expected:

- `nuxt prepare` 仍可能出现当前已知 `generated/prisma/enums.js` 扫描告警
- `nuxi typecheck` 成功或仅出现与本迁移无关的既有问题

- [ ] **Step 4: 不提交**

本任务只建立基线，不改代码、不提交。

---

## Task 1: 建立 audit 清单与运行脚本

**Files:**
- Create: `scripts/nuxt-explicit-imports/shared/loadNuxtArtifacts.ts`
- Create: `scripts/nuxt-explicit-imports/audit.ts`
- Create: `tests/shared/nuxt-explicit-imports/loadNuxtArtifacts.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先写失败测试，锁定 `.nuxt` 解析规则**

```ts
// tests/shared/nuxt-explicit-imports/loadNuxtArtifacts.test.ts
import { describe, expect, it } from 'vitest'
import { loadNuxtArtifactsFromText } from '../../../scripts/nuxt-explicit-imports/shared/loadNuxtArtifacts'

describe('loadNuxtArtifactsFromText', () => {
  it('parses app imports, nitro globals and component declarations', () => {
    const manifest = loadNuxtArtifactsFromText({
      importsDts: `
export { useTheme } from '../app/composables/useTheme'
export { useAuthStore } from '../app/store/auth'
`,
      nitroImportsDts: `
declare global {
  const logger: typeof import('../../shared/utils/logger').logger
  const createAssistantSessionService: typeof import('../../server/services/assistant/assistantSession.service').createAssistantSessionService
}
`,
      componentsDts: `
export const GeneralAlertDialog: typeof import("../app/components/general/AlertDialog.vue").default
export const AiElementsPromptInput: typeof import("../app/components/ai-elements/prompt-input/PromptInput.vue").default
`,
    })

    expect(manifest.app.useTheme).toBe('~/composables/useTheme')
    expect(manifest.app.useAuthStore).toBe('~/store/auth')
    expect(manifest.server.logger).toBe('#shared/utils/logger')
    expect(manifest.server.createAssistantSessionService).toBe('~~/server/services/assistant/assistantSession.service')
    expect(manifest.components.GeneralAlertDialog).toBe('~/components/general/AlertDialog.vue')
    expect(manifest.components.AiElementsPromptInput).toBe('~/components/ai-elements/prompt-input/PromptInput.vue')
  })
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run: `npx vitest run tests/shared/nuxt-explicit-imports/loadNuxtArtifacts.test.ts --reporter=verbose`
Expected: FAIL with `Cannot find module '../../../scripts/nuxt-explicit-imports/shared/loadNuxtArtifacts'`

- [ ] **Step 3: 实现 `.nuxt` 解析器与 audit CLI**

```ts
// scripts/nuxt-explicit-imports/shared/loadNuxtArtifacts.ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface NuxtArtifactsManifest {
  app: Record<string, string>
  server: Record<string, string>
  components: Record<string, string>
}

const normalizeAppPath = (raw: string) =>
  raw
    .replace(/^\.\.\/app\//, '~/')
    .replace(/^\.\.\/generated\//, '~~/generated/')
    .replace(/^\.\.\/shared\//, '#shared/')
    .replace(/\\/g, '/')

const normalizeServerPath = (raw: string) =>
  raw
    .replace(/^\.\.\/\.\.\/server\//, '~~/server/')
    .replace(/^\.\.\/\.\.\/shared\/utils\/logger(?:\/index)?$/, '#shared/utils/logger')
    .replace(/^\.\.\/\.\.\/shared\//, '#shared/')
    .replace(/\\/g, '/')

export const loadNuxtArtifactsFromText = (input: {
  importsDts: string
  nitroImportsDts: string
  componentsDts: string
}): NuxtArtifactsManifest => {
  const app: Record<string, string> = {}
  const server: Record<string, string> = {}
  const components: Record<string, string> = {}

  for (const match of input.importsDts.matchAll(/export \{ ([^}]+) \} from '([^']+)'/g)) {
    const names = match[1].split(',').map((value) => value.trim().split(' as ')[0]!)
    const from = normalizeAppPath(match[2]!)
    for (const name of names) app[name] = from
  }

  for (const match of input.nitroImportsDts.matchAll(/const (\w+): typeof import\('([^']+)'\)\.(\w+)/g)) {
    server[match[1]!] = normalizeServerPath(match[2]!)
  }

  for (const match of input.componentsDts.matchAll(/export const (\w+): typeof import\("([^"]+)"\)\.default/g)) {
    components[match[1]!] = normalizeAppPath(match[2]!)
  }

  return { app, server, components }
}

export const loadNuxtArtifacts = async (rootDir: string): Promise<NuxtArtifactsManifest> => {
  const [importsDts, nitroImportsDts, componentsDts] = await Promise.all([
    readFile(resolve(rootDir, '.nuxt/imports.d.ts'), 'utf8'),
    readFile(resolve(rootDir, '.nuxt/types/nitro-imports.d.ts'), 'utf8'),
    readFile(resolve(rootDir, '.nuxt/components.d.ts'), 'utf8'),
  ])

  return loadNuxtArtifactsFromText({ importsDts, nitroImportsDts, componentsDts })
}
```

```ts
// scripts/nuxt-explicit-imports/audit.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadNuxtArtifacts } from './shared/loadNuxtArtifacts'

const rootDir = process.cwd()
const outDir = resolve(rootDir, '.cache/nuxt-explicit-imports')

await mkdir(outDir, { recursive: true })
const manifest = await loadNuxtArtifacts(rootDir)

await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log(JSON.stringify({
  app: Object.keys(manifest.app).length,
  server: Object.keys(manifest.server).length,
  components: Object.keys(manifest.components).length,
}, null, 2))
```

```json
// package.json
{
  "scripts": {
    "audit:explicit-imports": "npx tsx scripts/nuxt-explicit-imports/audit.ts"
  }
}
```

- [ ] **Step 4: 运行测试与 audit**

Run:

```bash
npx vitest run tests/shared/nuxt-explicit-imports/loadNuxtArtifacts.test.ts --reporter=verbose
bun run audit:explicit-imports
```

Expected:

- test PASS
- `.cache/nuxt-explicit-imports/manifest.json` 生成
- stdout 输出 `app` / `server` / `components` 三组计数

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/nuxt-explicit-imports/audit.ts scripts/nuxt-explicit-imports/shared/loadNuxtArtifacts.ts tests/shared/nuxt-explicit-imports/loadNuxtArtifacts.test.ts
git commit -m "chore(migration): add explicit-import audit manifest"
```

---

## Task 2: 建立显式导入检查器（长期守卫）

**Files:**
- Create: `scripts/nuxt-explicit-imports/shared/sfc.ts`
- Create: `scripts/nuxt-explicit-imports/shared/symbolUsage.ts`
- Create: `scripts/nuxt-explicit-imports/check.ts`
- Create: `tests/shared/nuxt-explicit-imports/check.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先写失败测试，锁定“同时扫描 template + script，但不碰内置”的行为**

```ts
// tests/shared/nuxt-explicit-imports/check.test.ts
import { describe, expect, it } from 'vitest'
import { findMissingProjectImports } from '../../../scripts/nuxt-explicit-imports/shared/symbolUsage'

describe('findMissingProjectImports', () => {
  it('scans both template and script of vue files while ignoring Nuxt/Vue built-ins', () => {
    const findings = findMissingProjectImports({
      filePath: 'app/pages/example.vue',
      source: `
<template>
  <div>{{ formatDate(createdAt) }}</div>
</template>
<script setup lang="ts">
const route = useRoute()
const store = useAuthStore()
</script>
`,
      symbols: {
        formatDate: '~/utils/date',
        useAuthStore: '~/store/auth',
      },
      builtins: new Set(['useRoute', 'ref', 'computed', 'defineEventHandler']),
    })

    expect(findings).toEqual([
      { symbol: 'formatDate', importPath: '~/utils/date' },
      { symbol: 'useAuthStore', importPath: '~/store/auth' },
    ])
  })
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run: `npx vitest run tests/shared/nuxt-explicit-imports/check.test.ts --reporter=verbose`
Expected: FAIL with `Cannot find module '../../../scripts/nuxt-explicit-imports/shared/symbolUsage'`

- [ ] **Step 3: 实现检查器与 CLI**

```ts
// scripts/nuxt-explicit-imports/shared/sfc.ts
import { parse, type SFCDescriptor } from '@vue/compiler-sfc'

export interface ParsedVueSfc {
  descriptor: SFCDescriptor
  templateContent: string
  scriptContent: string
  scriptSetupContent: string
}

export const parseVueSfc = (source: string): ParsedVueSfc => {
  const parsed = parse(source)
  return {
    descriptor: parsed.descriptor,
    templateContent: parsed.descriptor.template?.content ?? '',
    scriptContent: parsed.descriptor.script?.content ?? '',
    scriptSetupContent: parsed.descriptor.scriptSetup?.content ?? '',
  }
}

export const getProjectSymbolSearchSource = (filePath: string, source: string) => {
  if (!filePath.endsWith('.vue')) return source
  const parsed = parseVueSfc(source)
  return [parsed.templateContent, parsed.scriptContent, parsed.scriptSetupContent]
    .filter(Boolean)
    .join('\n')
}
```

```ts
// scripts/nuxt-explicit-imports/shared/symbolUsage.ts
import { readFile } from 'node:fs/promises'
import { getProjectSymbolSearchSource } from './sfc'

export interface MissingImportFinding {
  symbol: string
  importPath: string
}

const hasExplicitImport = (source: string, symbol: string) =>
  new RegExp(String.raw`import[\s\S]{0,300}?\b${symbol}\b[\s\S]{0,300}?from\s*['"]`, 'm').test(source)

export const findMissingProjectImports = (input: {
  filePath: string
  source: string
  symbols: Record<string, string>
  builtins: Set<string>
}): MissingImportFinding[] => {
  const searchSource = getProjectSymbolSearchSource(input.filePath, input.source)
  const findings: MissingImportFinding[] = []
  for (const [symbol, importPath] of Object.entries(input.symbols)) {
    if (input.builtins.has(symbol)) continue
    if (!new RegExp(String.raw`\b${symbol}\b`).test(searchSource)) continue
    if (hasExplicitImport(input.source, symbol)) continue
    findings.push({ symbol, importPath })
  }
  return findings
}

export const readSource = (filePath: string) => readFile(filePath, 'utf8')
```

```ts
// scripts/nuxt-explicit-imports/check.ts
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findMissingProjectImports } from './shared/symbolUsage'

const rootDir = process.cwd()
const manifest = JSON.parse(await readFile(resolve(rootDir, '.cache/nuxt-explicit-imports/manifest.json'), 'utf8'))
const builtins = new Set(['useRoute', 'useRouter', 'useFetch', 'useState', 'useRuntimeConfig', 'ref', 'computed', 'watch', 'watchEffect', 'onMounted', 'defineEventHandler', 'readBody', 'getQuery'])

const filePath = process.argv[2]
const source = await readFile(resolve(rootDir, filePath), 'utf8')
const symbols = filePath.startsWith('server/') ? manifest.server : manifest.app
const findings = findMissingProjectImports({ filePath, source, symbols, builtins })

await writeFile(resolve(rootDir, '.cache/nuxt-explicit-imports/findings.json'), JSON.stringify(findings, null, 2))
console.log(JSON.stringify(findings, null, 2))

if (process.argv.includes('--fail-on-findings') && findings.length > 0) process.exit(1)
```

```json
// package.json
{
  "scripts": {
    "check:explicit-imports": "npx tsx scripts/nuxt-explicit-imports/check.ts"
  }
}
```

- [ ] **Step 4: 运行测试与单文件检查**

Run:

```bash
npx vitest run tests/shared/nuxt-explicit-imports/check.test.ts --reporter=verbose
bun run check:explicit-imports app/pages/dashboard/document/templates.vue || true
```

Expected:

- test PASS
- 若 `templates.vue` 尚未显式导入 `formatDate` / `getCategoryLabel` 之类项目符号，stdout 能看到 findings JSON

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/nuxt-explicit-imports/check.ts scripts/nuxt-explicit-imports/shared/sfc.ts scripts/nuxt-explicit-imports/shared/symbolUsage.ts tests/shared/nuxt-explicit-imports/check.test.ts
git commit -m "chore(migration): add explicit-import checker"
```

---

## Task 3: 实现服务端 codemod

**Files:**
- Create: `scripts/nuxt-explicit-imports/shared/importBlock.ts`
- Create: `scripts/nuxt-explicit-imports/shared/serverTransform.ts`
- Create: `scripts/nuxt-explicit-imports/transform-server.ts`
- Create: `tests/shared/nuxt-explicit-imports/serverTransform.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先写失败测试，锁定 import 注入规则**

```ts
// tests/shared/nuxt-explicit-imports/serverTransform.test.ts
import { describe, expect, it } from 'vitest'
import { transformServerFile } from '../../../scripts/nuxt-explicit-imports/shared/serverTransform'

describe('transformServerFile', () => {
  it('adds explicit imports for prisma, logger and apiResponse helpers', () => {
    const output = transformServerFile({
      filePath: 'server/api/health.get.ts',
      source: `
export default defineEventHandler(() => {
  logger.info('health')
  return resSuccess({} as any, 'ok', { ok: true })
})
`,
      manifest: { createAssistantSessionService: '~~/server/services/assistant/assistantSession.service' },
    })

    expect(output).toContain("import { logger } from '#shared/utils/logger'")
    expect(output).toContain("import { resSuccess } from '#shared/utils/apiResponse'")
  })
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run: `npx vitest run tests/shared/nuxt-explicit-imports/serverTransform.test.ts --reporter=verbose`
Expected: FAIL with `Cannot find module '../../../scripts/nuxt-explicit-imports/shared/serverTransform'`

- [ ] **Step 3: 实现服务端 transform**

```ts
// scripts/nuxt-explicit-imports/shared/importBlock.ts
export const upsertImports = (source: string, importsToAdd: Array<{ from: string; names: string[] }>) => {
  const lines = source.split('\n')
  const existing = new Map<string, Set<string>>()

  for (const line of lines) {
    const match = line.match(/^import \{([^}]+)\} from ['"]([^'"]+)['"]/)
    if (!match) continue
    const names = match[1]!.split(',').map((value) => value.trim())
    existing.set(match[2]!, new Set([...(existing.get(match[2]!) ?? []), ...names]))
  }

  for (const item of importsToAdd) {
    const bucket = existing.get(item.from) ?? new Set<string>()
    for (const name of item.names) bucket.add(name)
    existing.set(item.from, bucket)
  }

  const importLines = [...existing.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, names]) => `import { ${[...names].sort().join(', ')} } from '${from}'`)

  const body = lines.filter((line) => !line.startsWith('import '))
  return `${importLines.join('\n')}\n\n${body.join('\n').trimStart()}`
}
```

```ts
// scripts/nuxt-explicit-imports/shared/serverTransform.ts
import { upsertImports } from './importBlock'

const SERVER_IMPORTS: Record<string, string> = {
  prisma: '~~/server/utils/db',
  logger: '#shared/utils/logger',
  resSuccess: '#shared/utils/apiResponse',
  resError: '#shared/utils/apiResponse',
  parseErrorMessage: '#shared/utils/apiResponse',
}

export const transformServerFile = (input: {
  filePath: string
  source: string
  manifest: Record<string, string>
}) => {
  const toAdd = new Map<string, Set<string>>()

  for (const [symbol, from] of Object.entries(SERVER_IMPORTS)) {
    if (!new RegExp(String.raw`\b${symbol}\b`).test(input.source)) continue
    if (new RegExp(String.raw`import[\s\S]{0,300}?\b${symbol}\b[\s\S]{0,300}?from\s*['"]`).test(input.source)) continue
    const bucket = toAdd.get(from) ?? new Set<string>()
    bucket.add(symbol)
    toAdd.set(from, bucket)
  }

  for (const [symbol, from] of Object.entries(input.manifest)) {
    if (!new RegExp(String.raw`\b${symbol}\b`).test(input.source)) continue
    if (new RegExp(String.raw`import[\s\S]{0,300}?\b${symbol}\b[\s\S]{0,300}?from\s*['"]`).test(input.source)) continue
    const bucket = toAdd.get(from) ?? new Set<string>()
    bucket.add(symbol)
    toAdd.set(from, bucket)
  }

  return upsertImports(input.source, [...toAdd.entries()].map(([from, names]) => ({ from, names: [...names] })))
}
```

```ts
// scripts/nuxt-explicit-imports/transform-server.ts
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { transformServerFile } from './shared/serverTransform'

const rootDir = process.cwd()
const manifest = JSON.parse(await readFile(resolve(rootDir, '.cache/nuxt-explicit-imports/manifest.json'), 'utf8'))

for (const dir of ['server/api', 'server/services', 'server/utils']) {
  for (const entry of await readdir(resolve(rootDir, dir), { recursive: true })) {
    const filePath = resolve(rootDir, dir, String(entry))
    if (!filePath.endsWith('.ts')) continue
    const source = await readFile(filePath, 'utf8')
    const next = transformServerFile({ filePath, source, manifest: manifest.server })
    if (next !== source) await writeFile(filePath, next)
  }
}
```

```json
// package.json
{
  "scripts": {
    "migrate:explicit-imports:server": "npx tsx scripts/nuxt-explicit-imports/transform-server.ts"
  }
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npx vitest run tests/shared/nuxt-explicit-imports/serverTransform.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/nuxt-explicit-imports/shared/importBlock.ts scripts/nuxt-explicit-imports/shared/serverTransform.ts scripts/nuxt-explicit-imports/transform-server.ts tests/shared/nuxt-explicit-imports/serverTransform.test.ts
git commit -m "chore(migration): add server explicit-import codemod"
```

---

## Task 4: 应用服务端 codemod 并关闭 Nitro 项目级导入

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `server/api/**/*.ts`（由 codemod 批量改写）
- Modify: `server/services/**/*.ts`（由 codemod 批量改写）
- Modify: `server/utils/**/*.ts`（由 codemod 批量改写）

- [ ] **Step 1: 先跑 audit，保证 `.cache` 是最新 manifest**

Run: `bun run audit:explicit-imports`
Expected: `.cache/nuxt-explicit-imports/manifest.json` 被更新

- [ ] **Step 2: 执行服务端 codemod**

Run: `bun run migrate:explicit-imports:server`
Expected: `server/api`、`server/services`、`server/utils` 出现 import diff

- [ ] **Step 3: 手动切掉 `nitro.imports` 配置**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  // ...
  nitro: {
    // 这里删除整个 imports 块：
    // imports: {
    //   dirs: ['./server/services/*/*'],
    //   imports: [],
    // },
    externals: {
      inline: ['dayjs', 'zod']
    },
    rollupConfig: {
      plugins: [
        ...(process.env.ENABLE_OBFUSCATOR === 'true' ? [
          rollupObfuscator({
            global: true,
            options: {
              ...obfuscatorConfig,
            },
          }),
        ] : []),
      ],
    },
  },
})
```

- [ ] **Step 4: 修复 unresolved 报告中的边角文件**

优先检查以下高价值文件：

```bash
sed -n '1,80p' server/api/health.get.ts
sed -n '1,120p' server/api/v1/assistant/sessions.post.ts
sed -n '1,120p' server/services/assistant/contract/contractReview.dao.ts
sed -n '1,120p' server/services/workflow/utils/promptRenderer.ts
```

Expected:

- `logger`、`prisma`、`resSuccess`、`resError` 均为显式 import
- 跨模块 service/dao 使用真实路径，而不是继续依赖全局注入

- [ ] **Step 5: 运行服务端验证**

Run:

```bash
npx vitest run tests/server/agent tests/server/assistant tests/server/utils tests/server/material --reporter=verbose
npx nuxi typecheck
```

Expected:

- 服务端相关测试通过
- 类型检查不再因 `server/services` / `shared/utils` 自动导入缺失而报错

- [ ] **Step 6: Commit**

```bash
git add nuxt.config.ts server/api server/services server/utils
git commit -m "refactor(server): replace nitro auto imports with explicit imports"
```

---

## Task 5: 实现前端脚本 codemod（store / composable / utils）

**Files:**
- Modify: `scripts/nuxt-explicit-imports/shared/sfc.ts`
- Create: `scripts/nuxt-explicit-imports/shared/appTransform.ts`
- Create: `scripts/nuxt-explicit-imports/transform-app-symbols.ts`
- Create: `tests/shared/nuxt-explicit-imports/appTransform.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先写失败测试，锁定 SFC-safe 注入规则**

```ts
// tests/shared/nuxt-explicit-imports/appTransform.test.ts
import { describe, expect, it } from 'vitest'
import { transformAppFile } from '../../../scripts/nuxt-explicit-imports/shared/appTransform'

describe('transformAppFile', () => {
  it('injects project imports into existing script setup while keeping Nuxt built-ins untouched', () => {
    const output = transformAppFile({
      filePath: 'app/app.vue',
      source: `
<template>
  <div>{{ formatDate(createdAt) }}</div>
</template>
<script setup lang="ts">
const route = useRoute()
const authStore = useAuthStore()
</script>
`,
      manifest: {
        formatDate: '~/utils/date',
        useAuthStore: '~/store/auth',
      },
      builtins: new Set(['useRoute', 'ref', 'computed']),
    })

    expect(output).toContain("import { formatDate } from '~/utils/date'")
    expect(output).toContain("import { useAuthStore } from '~/store/auth'")
    expect(output).not.toContain("import { useRoute }")
  })

  it('creates a script setup block when a vue file has no script setup', () => {
    const output = transformAppFile({
      filePath: 'app/components/icons/ExampleIcon.vue',
      source: `
<template>
  <div>{{ formatDate(createdAt) }}</div>
</template>
<script lang="ts">
const singleton = new Map()
</script>
`,
      manifest: {
        formatDate: '~/utils/date',
      },
      builtins: new Set(['useRoute', 'ref', 'computed']),
    })

    expect(output).toContain('<script setup lang="ts">')
    expect(output).toContain("import { formatDate } from '~/utils/date'")
    expect(output).toContain('const singleton = new Map()')
  })
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run: `npx vitest run tests/shared/nuxt-explicit-imports/appTransform.test.ts --reporter=verbose`
Expected: FAIL with `Cannot find module '../../../scripts/nuxt-explicit-imports/shared/appTransform'`

- [ ] **Step 3: 实现 SFC-safe 编辑器与前端 transform**

```ts
// scripts/nuxt-explicit-imports/shared/sfc.ts
import { parse, type SFCBlock, type SFCDescriptor } from '@vue/compiler-sfc'

export interface ParsedVueSfc {
  descriptor: SFCDescriptor
  templateContent: string
  scriptContent: string
  scriptSetupContent: string
}

export interface JSImportSpec {
  from: string
  kind: 'default' | 'named'
  localName: string
  importedName?: string
}

export const parseVueSfc = (source: string): ParsedVueSfc => {
  const parsed = parse(source)
  return {
    descriptor: parsed.descriptor,
    templateContent: parsed.descriptor.template?.content ?? '',
    scriptContent: parsed.descriptor.script?.content ?? '',
    scriptSetupContent: parsed.descriptor.scriptSetup?.content ?? '',
  }
}

export const getProjectSymbolSearchSource = (filePath: string, source: string) => {
  if (!filePath.endsWith('.vue')) return source
  const parsed = parseVueSfc(source)
  return [parsed.templateContent, parsed.scriptContent, parsed.scriptSetupContent]
    .filter(Boolean)
    .join('\n')
}

const getBlockContentRange = (source: string, block: SFCBlock) => {
  const blockSource = source.slice(block.loc.start.offset, block.loc.end.offset)
  const relativeStart = blockSource.indexOf(block.content)
  if (relativeStart < 0) throw new Error('Unable to locate SFC block content')
  const contentStart = block.loc.start.offset + relativeStart
  return {
    contentStart,
    contentEnd: contentStart + block.content.length,
  }
}

const mergeVueImports = (existingSource: string, importsToAdd: JSImportSpec[]) => {
  const defaultImports = new Map<string, string>()
  const namedImports = new Map<string, Map<string, string>>()

  for (const match of existingSource.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/gm)) {
    defaultImports.set(match[2]!, match[1]!)
  }

  for (const match of existingSource.matchAll(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
    const from = match[2]!
    const bucket = namedImports.get(from) ?? new Map<string, string>()
    for (const part of match[1]!.split(',')) {
      const [importedName, localName] = part.trim().split(/\s+as\s+/)
      bucket.set(importedName!, localName ?? importedName!)
    }
    namedImports.set(from, bucket)
  }

  for (const item of importsToAdd) {
    if (item.kind === 'default') {
      defaultImports.set(item.from, item.localName)
      continue
    }
    const bucket = namedImports.get(item.from) ?? new Map<string, string>()
    bucket.set(item.importedName ?? item.localName, item.localName)
    namedImports.set(item.from, bucket)
  }

  const defaultLines = [...defaultImports.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, localName]) => `import ${localName} from '${from}'`)

  const namedLines = [...namedImports.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, names]) => {
      const content = [...names.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([importedName, localName]) => importedName === localName ? importedName : `${importedName} as ${localName}`)
        .join(', ')
      return `import { ${content} } from '${from}'`
    })

  return [...defaultLines, ...namedLines].join('\n')
}

export const upsertVueScriptSetupImports = (source: string, importsToAdd: JSImportSpec[]) => {
  if (importsToAdd.length === 0) return source

  const { descriptor, scriptSetupContent } = parseVueSfc(source)
  const importBlock = mergeVueImports(scriptSetupContent, importsToAdd)

  if (descriptor.scriptSetup) {
    const { contentStart, contentEnd } = getBlockContentRange(source, descriptor.scriptSetup)
    const nextContent = scriptSetupContent.trimStart()
      ? `${importBlock}\n\n${scriptSetupContent.trimStart()}`
      : `${importBlock}\n`
    return `${source.slice(0, contentStart)}${nextContent}${source.slice(contentEnd)}`
  }

  const newBlock = `<script setup lang="ts">\n${importBlock}\n</script>`
  const anchor = descriptor.script?.loc.end.offset ?? descriptor.template?.loc.end.offset ?? 0
  const prefix = source.slice(0, anchor)
  const suffix = source.slice(anchor)
  const separator = anchor === 0 ? '' : '\n\n'
  return `${prefix}${separator}${newBlock}${suffix}`.trimStart()
}
```

```ts
// scripts/nuxt-explicit-imports/shared/appTransform.ts
import { upsertImports } from './importBlock'
import { getProjectSymbolSearchSource, upsertVueScriptSetupImports } from './sfc'

const hasExplicitImport = (source: string, symbol: string) =>
  new RegExp(String.raw`import[\s\S]{0,300}?\b${symbol}\b[\s\S]{0,300}?from\s*['"]`, 'm').test(source)

export const transformAppFile = (input: {
  filePath: string
  source: string
  manifest: Record<string, string>
  builtins: Set<string>
}) => {
  const targetSource = getProjectSymbolSearchSource(input.filePath, input.source)
  const additions = new Map<string, Set<string>>()

  for (const [symbol, from] of Object.entries(input.manifest)) {
    if (input.builtins.has(symbol)) continue
    if (!new RegExp(String.raw`\b${symbol}\b`).test(targetSource)) continue
    if (hasExplicitImport(input.source, symbol)) continue
    const bucket = additions.get(from) ?? new Set<string>()
    bucket.add(symbol)
    additions.set(from, bucket)
  }

  const importSpecs = [...additions.entries()].flatMap(([from, names]) =>
    [...names].map((name) => ({
      from,
      kind: 'named' as const,
      importedName: name,
      localName: name,
    })))

  if (input.filePath.endsWith('.vue')) {
    return upsertVueScriptSetupImports(input.source, importSpecs)
  }

  return upsertImports(input.source, [...additions.entries()].map(([from, names]) => ({ from, names: [...names] })))
}
```

```ts
// scripts/nuxt-explicit-imports/transform-app-symbols.ts
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { transformAppFile } from './shared/appTransform'

const rootDir = process.cwd()
const manifest = JSON.parse(await readFile(resolve(rootDir, '.cache/nuxt-explicit-imports/manifest.json'), 'utf8'))
const builtins = new Set(['useRoute', 'useRouter', 'useFetch', 'useState', 'useRuntimeConfig', 'ref', 'computed', 'watch', 'onMounted'])

for (const dir of ['app/pages', 'app/layouts', 'app/components', 'app/composables', 'app/store', 'app/utils']) {
  for (const entry of await readdir(resolve(rootDir, dir), { recursive: true })) {
    const filePath = resolve(rootDir, dir, String(entry))
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.vue')) continue
    const source = await readFile(filePath, 'utf8')
    const next = transformAppFile({ filePath, source, manifest: manifest.app, builtins })
    if (next !== source) await writeFile(filePath, next)
  }
}
```

```json
// package.json
{
  "devDependencies": {
    "@vue/compiler-sfc": "^3.5.25"
  },
  "scripts": {
    "migrate:explicit-imports:app": "npx tsx scripts/nuxt-explicit-imports/transform-app-symbols.ts"
  }
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npx vitest run tests/shared/nuxt-explicit-imports/appTransform.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/nuxt-explicit-imports/shared/sfc.ts scripts/nuxt-explicit-imports/shared/appTransform.ts scripts/nuxt-explicit-imports/transform-app-symbols.ts tests/shared/nuxt-explicit-imports/appTransform.test.ts
git commit -m "chore(migration): add app explicit-import codemod"
```

---

## Task 6: 应用前端脚本 codemod 并切到 `imports.scan: false`

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `app/pages/**/*.vue`（由 codemod 批量改写）
- Modify: `app/layouts/**/*.vue`（由 codemod 批量改写）
- Modify: `app/components/**/*.vue`（script 区块由 codemod 批量改写）
- Modify: `app/composables/**/*.ts`
- Modify: `app/store/**/*.ts`
- Modify: `app/utils/**/*.ts`

- [ ] **Step 1: 执行前端脚本 codemod**

Run: `bun run migrate:explicit-imports:app`
Expected: `app` 目录内 store/composable/utils 显式导入被补齐

- [ ] **Step 2: 先用检查器清掉 template/script 中剩余的项目级遗漏**

Run:

```bash
bun run check:explicit-imports app/pages/dashboard/document/templates.vue || true
bun run check:explicit-imports app/pages/admin/document-templates/index.vue || true
bun run check:explicit-imports app/components/case/AnalysisResults.vue || true
```

Expected:

- 若仍有 `formatDate`、`getCategoryLabel`、`formatCurrency` 等漏导入，stdout 能直接定位
- 先修完 findings，再继续关闭 `imports.scan`

- [ ] **Step 3: 手动切换 `imports` 配置**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  // ...
  imports: {
    scan: false,
  },
  // 这里删除旧的项目级配置：
  // imports: {
  //   dirs: ['store'],
  //   imports: [],
  // }
})
```

- [ ] **Step 4: spot check 高价值入口**

Run:

```bash
sed -n '1,120p' app/app.vue
sed -n '1,160p' app/store/auth.ts
sed -n '96,140p' app/pages/dashboard/document/templates.vue
sed -n '1,160p' app/composables/useApiFetch.ts
```

Expected:

- `useAuthStore` / `useUserStore` 等项目级符号都具备显式 import
- 模板里直接调用的 `formatDate` / `getCategoryLabel` 也已经在 `<script setup>` 中显式导入
- `useRoute`、`ref`、`computed` 等内置仍不需要 import

- [ ] **Step 5: 跑前端脚本与类型验证**

Run:

```bash
npx vitest run tests/client/composables tests/client/store tests/app/composables --reporter=verbose
npx nuxi typecheck
```

Expected:

- client / store / composable 测试通过
- 类型检查不再因 `app/store`、`app/composables`、`shared/utils` 的项目级自动导入而报错

- [ ] **Step 6: Commit**

```bash
git add nuxt.config.ts app/pages app/layouts app/components app/composables app/store app/utils
git commit -m "refactor(app): replace project auto imports with explicit imports"
```

---

## Task 7: 实现组件 codemod 与 `ai-elements` 解析器

**Files:**
- Create: `scripts/nuxt-explicit-imports/shared/aiElementsExports.ts`
- Create: `scripts/nuxt-explicit-imports/shared/componentResolver.ts`
- Create: `scripts/nuxt-explicit-imports/transform-components.ts`
- Create: `tests/shared/nuxt-explicit-imports/componentTransform.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 先写失败测试，锁定普通组件与路径前缀型 `AiElements...` 的不同解析策略**

```ts
// tests/shared/nuxt-explicit-imports/componentTransform.test.ts
import { describe, expect, it } from 'vitest'
import type { AiElementsExportManifest } from '../../../scripts/nuxt-explicit-imports/shared/aiElementsExports'
import { resolveComponentImport, transformVueComponentImports } from '../../../scripts/nuxt-explicit-imports/shared/componentResolver'

const aiElements: AiElementsExportManifest = {
  rootExports: new Set(['PromptInput']),
  groupExports: {
    confirmation: new Set(['Confirmation', 'ConfirmationAction', 'ConfirmationActions', 'ConfirmationRequest', 'ConfirmationTitle']),
    'prompt-input': new Set(['PromptInput']),
  },
}

describe('resolveComponentImport', () => {
  it('resolves AiElementsConfirmationConfirmation from the real component file basename', () => {
    expect(resolveComponentImport('AiElementsConfirmationConfirmation', {
      AiElementsConfirmationConfirmation: '~/components/ai-elements/confirmation/Confirmation.vue',
    }, aiElements)).toEqual({
      from: '~/components/ai-elements/confirmation',
      kind: 'named',
      importedName: 'Confirmation',
      localName: 'AiElementsConfirmationConfirmation',
    })
  })

  it('uses manifest real path for normal project components', () => {
    expect(resolveComponentImport('GeneralAlertDialog', {
      GeneralAlertDialog: '~/components/general/AlertDialog.vue',
    }, aiElements)).toEqual({
      from: '~/components/general/AlertDialog.vue',
      kind: 'default',
      localName: 'GeneralAlertDialog',
    })
  })
})

describe('transformVueComponentImports', () => {
  it('adds explicit imports for template components and creates script setup when needed', () => {
    const output = transformVueComponentImports({
      filePath: 'app/app.vue',
      source: `
<template>
  <NuxtLayout>
    <GeneralAlertDialog />
    <AiElementsConfirmationConfirmation />
  </NuxtLayout>
</template>
`,
      manifest: {
        GeneralAlertDialog: '~/components/general/AlertDialog.vue',
        AiElementsConfirmationConfirmation: '~/components/ai-elements/confirmation/Confirmation.vue',
      },
      aiElements,
    })

    expect(output.code).toContain('<script setup lang="ts">')
    expect(output.code).toContain("import GeneralAlertDialog from '~/components/general/AlertDialog.vue'")
    expect(output.code).toContain("import { Confirmation as AiElementsConfirmationConfirmation } from '~/components/ai-elements/confirmation'")
    expect(output.code).not.toContain("import NuxtLayout")
    expect(output.unresolved).toEqual([])
  })

  it('ignores components that are already explicitly imported', () => {
    const output = transformVueComponentImports({
      filePath: 'app/components/general/AlertDialog.vue',
      source: `
<template>
  <CheckCircleIcon />
</template>
<script setup lang="ts">
import { CheckCircleIcon } from 'lucide-vue-next'
</script>
`,
      manifest: {},
      aiElements,
    })

    expect(output.code).toContain("import { CheckCircleIcon } from 'lucide-vue-next'")
    expect(output.unresolved).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run: `npx vitest run tests/shared/nuxt-explicit-imports/componentTransform.test.ts --reporter=verbose`
Expected: FAIL with `Cannot find module '../../../scripts/nuxt-explicit-imports/shared/componentResolver'`

- [ ] **Step 3: 实现组件解析与 transform**

```ts
// scripts/nuxt-explicit-imports/shared/aiElementsExports.ts
import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export interface AiElementsExportManifest {
  rootExports: Set<string>
  groupExports: Record<string, Set<string>>
}

const extractNamedVueExports = (source: string) =>
  new Set(
    [...source.matchAll(/export \{ default as (\w+) \} from ['"][^'"]+\.vue['"]/g)]
      .map((match) => match[1]!)
  )

const extractRootGroups = (source: string) =>
  new Set(
    [...source.matchAll(/export \* from ['"]\.\/([^'"]+)['"]/g)]
      .map((match) => match[1]!)
  )

export const loadAiElementsExportManifest = async (rootDir: string): Promise<AiElementsExportManifest> => {
  const aiRoot = resolve(rootDir, 'app/components/ai-elements')
  const rootIndexSource = await readFile(resolve(aiRoot, 'index.ts'), 'utf8')
  const rootGroups = extractRootGroups(rootIndexSource)
  const groupExports: Record<string, Set<string>> = {}

  for (const entry of await readdir(aiRoot, { recursive: true })) {
    const fullPath = resolve(aiRoot, String(entry))
    if (!fullPath.endsWith('/index.ts') && !fullPath.endsWith('\\index.ts')) continue
    if (fullPath === resolve(aiRoot, 'index.ts')) continue

    const groupPath = relative(aiRoot, dirname(fullPath)).replace(/\\/g, '/')
    const source = await readFile(fullPath, 'utf8')
    groupExports[groupPath] = extractNamedVueExports(source)
  }

  const rootExports = new Set<string>()
  for (const group of rootGroups) {
    for (const name of groupExports[group] ?? []) rootExports.add(name)
  }

  return { rootExports, groupExports }
}
```

```ts
// scripts/nuxt-explicit-imports/shared/componentResolver.ts
import type { AiElementsExportManifest } from './aiElementsExports'
import { parseVueSfc, upsertVueScriptSetupImports, type JSImportSpec } from './sfc'

const BUILTIN_COMPONENTS = new Set([
  'NuxtPage',
  'NuxtLayout',
  'NuxtLink',
  'ClientOnly',
  'Suspense',
  'Teleport',
  'Transition',
  'TransitionGroup',
  'KeepAlive',
])

export interface UnresolvedComponentFinding {
  tag: string
  expectedPath: string | null
  reason: string
}

const hasExplicitComponentImport = (source: string, localName: string) =>
  new RegExp(String.raw`import[\s\S]{0,300}?\b${localName}\b[\s\S]{0,300}?from\s*['"]`, 'm').test(source)

export const resolveComponentImport = (
  name: string,
  manifest: Record<string, string>,
  aiElements: AiElementsExportManifest,
): JSImportSpec | null => {
  if (BUILTIN_COMPONENTS.has(name)) return null

  if (name.startsWith('AiElements')) {
    const raw = manifest[name]
    if (!raw) return null

    const match = raw.match(/^~\/components\/ai-elements\/(.+)\/([^/]+)\.vue$/)
    if (!match) return null

    const groupPath = match[1]!
    const exportedName = match[2]!

    if (aiElements.groupExports[groupPath]?.has(exportedName)) {
      return {
        from: `~/components/ai-elements/${groupPath}`,
        kind: 'named',
        importedName: exportedName,
        localName: name,
      }
    }

    if (aiElements.rootExports.has(exportedName)) {
      return {
        from: '~/components/ai-elements',
        kind: 'named',
        importedName: exportedName,
        localName: name,
      }
    }

    return null
  }

  const raw = manifest[name]
  if (!raw) return null

  return {
    from: raw,
    kind: 'default',
    localName: name,
  }
}

export const transformVueComponentImports = (input: {
  filePath: string
  source: string
  manifest: Record<string, string>
  aiElements: AiElementsExportManifest
}) => {
  const template = parseVueSfc(input.source).templateContent
  const tags = [...template.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1]!)

  const importsToAdd: JSImportSpec[] = []
  const unresolved: UnresolvedComponentFinding[] = []

  for (const tag of new Set(tags)) {
    if (BUILTIN_COMPONENTS.has(tag)) continue
    if (hasExplicitComponentImport(input.source, tag)) continue
    const importSpec = resolveComponentImport(tag, input.manifest, input.aiElements)

    if (!importSpec) {
      unresolved.push({
        tag,
        expectedPath: input.manifest[tag] ?? null,
        reason: tag.startsWith('AiElements')
          ? 'No matching ai-elements barrel export found for manifest-backed component path'
          : 'Component tag is not present in the Nuxt component manifest',
      })
      continue
    }

    importsToAdd.push(importSpec)
  }

  return {
    code: upsertVueScriptSetupImports(input.source, importsToAdd),
    unresolved,
  }
}
```

```ts
// scripts/nuxt-explicit-imports/transform-components.ts
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadAiElementsExportManifest } from './shared/aiElementsExports'
import { transformVueComponentImports } from './shared/componentResolver'

const rootDir = process.cwd()
const manifest = JSON.parse(await readFile(resolve(rootDir, '.cache/nuxt-explicit-imports/manifest.json'), 'utf8'))
const aiElements = await loadAiElementsExportManifest(rootDir)
const outDir = resolve(rootDir, '.cache/nuxt-explicit-imports')
const unresolved: Array<{ filePath: string; tag: string; expectedPath: string | null; reason: string }> = []

await mkdir(outDir, { recursive: true })
await writeFile(resolve(outDir, 'ai-elements-exports.json'), JSON.stringify({
  rootExports: [...aiElements.rootExports].sort(),
  groupExports: Object.fromEntries(
    Object.entries(aiElements.groupExports)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, names]) => [group, [...names].sort()])
  ),
}, null, 2))

for (const dir of ['app/pages', 'app/layouts', 'app/components']) {
  for (const entry of await readdir(resolve(rootDir, dir), { recursive: true })) {
    const filePath = resolve(rootDir, dir, String(entry))
    if (!filePath.endsWith('.vue')) continue
    const source = await readFile(filePath, 'utf8')
    const result = transformVueComponentImports({
      filePath,
      source,
      manifest: manifest.components,
      aiElements,
    })

    if (result.code !== source) await writeFile(filePath, result.code)
    for (const finding of result.unresolved) unresolved.push({ filePath, ...finding })
  }
}

await writeFile(resolve(outDir, 'components-unresolved.json'), JSON.stringify(unresolved, null, 2))
```

```json
// package.json
{
  "scripts": {
    "migrate:explicit-imports:components": "npx tsx scripts/nuxt-explicit-imports/transform-components.ts"
  }
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
npx vitest run tests/shared/nuxt-explicit-imports/componentTransform.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/nuxt-explicit-imports/shared/aiElementsExports.ts scripts/nuxt-explicit-imports/shared/componentResolver.ts scripts/nuxt-explicit-imports/transform-components.ts tests/shared/nuxt-explicit-imports/componentTransform.test.ts
git commit -m "chore(migration): add component explicit-import codemod"
```

---

## Task 8: 应用组件 codemod、处理 `ai-elements`，并关闭组件自动注册

**Files:**
- Modify: `nuxt.config.ts`
- Modify: `app/pages/**/*.vue`（由 codemod 批量改写）
- Modify: `app/layouts/**/*.vue`（由 codemod 批量改写）
- Modify: `app/components/**/*.vue`（由 codemod 批量改写）
- Modify: `app/components/ai-elements/index.ts`（若需要补 barrel export）
- Modify: `app/components/ai-elements/*/index.ts`（若需要补 barrel export）

- [ ] **Step 1: 执行组件 codemod**

Run: `bun run migrate:explicit-imports:components`
Expected:

- 模板里使用的项目组件被补成显式 import
- `.cache/nuxt-explicit-imports/components-unresolved.json` 被更新
- `.cache/nuxt-explicit-imports/ai-elements-exports.json` 被生成，便于 review 当前 barrel 能力

- [ ] **Step 2: 先清空 `components-unresolved.json`，再关闭自动注册**

Run:

```bash
cat .cache/nuxt-explicit-imports/components-unresolved.json
```

Expected:

- 普通组件若 unresolved，优先修 manifest / 标签名问题
- `AiElements...` 若 unresolved，优先修 barrel export，而不是直接改成深层 `.vue` 单文件 import
- 记录 unresolved 的真实原因，进入 Step 3 处理

- [ ] **Step 3: 优先修 `ai-elements` unresolved，而不是回退深层单文件 import**

当 codemod 发现 `AiElements...` 无法从现有 barrel export 解出时，优先补对应 `index.ts`：

```ts
// app/components/ai-elements/prompt-input/index.ts
export * from './context'
export { default as PromptInput } from './PromptInput.vue'
export { default as PromptInputBody } from './PromptInputBody.vue'
export { default as PromptInputButton } from './PromptInputButton.vue'
export { default as PromptInputFooter } from './PromptInputFooter.vue'
export { default as PromptInputHeader } from './PromptInputHeader.vue'
export { default as PromptInputProvider } from './PromptInputProvider.vue'
export { default as PromptInputSubmit } from './PromptInputSubmit.vue'
export { default as PromptInputTextarea } from './PromptInputTextarea.vue'
export { default as PromptInputTools } from './PromptInputTools.vue'
export * from './types'
```

执行原则：

- 先补 barrel export
- 重新执行 `bun run migrate:explicit-imports:components`，直到 `.cache/nuxt-explicit-imports/components-unresolved.json` 为空
- 只有 barrel export 方案经审查确认不适用时，才接受单文件 `.vue` 路径
- 不使用 `#components`

- [ ] **Step 4: 手动切换 `components` 配置**

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  // ...
  components: {
    dirs: [],
  },
})
```

- [ ] **Step 5: 跑高风险 UI 测试与类型检查**

Run:

```bash
npx vitest run tests/app/components/ai/AiPromptInput.test.ts tests/app/components/assistant/contract/RiskListPanel.test.ts tests/client/components/caseAnalysis/promptInput.test.ts --reporter=verbose
npx nuxi typecheck
```

Expected:

- `AiPromptInput`、合同审查面板、案件分析 promptInput 均通过
- 类型检查不再依赖 `.nuxt/components.d.ts` 项目组件映射

- [ ] **Step 6: Commit**

```bash
git add nuxt.config.ts app/pages app/layouts app/components
git commit -m "refactor(ui): replace component auto registration with explicit imports"
```

---

## Task 9: 收口测试基建，移除项目级全局注入依赖

**Files:**
- Modify: `tests/server/agent/test-setup.ts`
- Modify: `tests/server/case/test-setup.ts`
- Modify: `tests/server/material/test-setup.ts`
- Modify: `tests/server/membership/test-setup.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: 先写一个失败测试，锁定“源码不再依赖全局 prisma/logger”的目标**

```ts
// tests/shared/nuxt-explicit-imports/noProjectGlobals.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('test setup does not inject project globals after migration', () => {
  it('removes prisma/logger global setup from shared test bootstrap', () => {
    const source = readFileSync('tests/server/membership/test-setup.ts', 'utf8')
    expect(source).not.toContain('globalThis as any).prisma')
    expect(source).not.toContain('globalThis as any).logger')
    expect(source).not.toContain("vi.stubGlobal('prisma'")
    expect(source).not.toContain("vi.stubGlobal('logger'")
  })
})
```

- [ ] **Step 2: 运行测试，确认它先失败**

Run: `npx vitest run tests/shared/nuxt-explicit-imports/noProjectGlobals.test.ts --reporter=verbose`
Expected: FAIL，因为当前 test setup 仍在注入全局 `prisma` / `logger`

- [ ] **Step 3: 精简 test setup，只保留必要的内置层支持**

```ts
// tests/server/agent/test-setup.ts
import { vi } from 'vitest'

const mockRuntimeConfig = {
  agent: {
    maxConcurrent: 3,
    maxUserConcurrent: 2,
    timeoutMs: 3_600_000,
    heartbeatIntervalMs: 15_000,
    crashThresholdMs: 60_000,
    databaseUrl: '',
  },
  redis: {
    url: 'redis://localhost:6379',
  },
}

vi.stubGlobal('useRuntimeConfig', () => mockRuntimeConfig)

export { mockRuntimeConfig }
```

```ts
// tests/server/case/test-setup.ts
import { resetDatabaseSequences } from './test-db-helper'

resetDatabaseSequences().catch((err) => {
  console.warn('全局序列重置失败：', err)
})

;(globalThis as any).CaseStatus = {
  IN_PROGRESS: 1,
  COMPLETED: 2,
  CLOSED: 3,
}

;(globalThis as any).SessionStatus = {
  IN_PROGRESS: 1,
  COMPLETED: 2,
  INTERRUPTED: 3,
  FAILED: 4,
}
```

同时把 `vitest.config.ts` 中“排除需要 Nuxt 自动导入完整支持的测试”之类注释改成与迁移后状态一致的描述，不再默认把问题归因于项目级自动导入。

- [ ] **Step 4: 跑测试基建验证**

Run:

```bash
npx vitest run tests/shared/nuxt-explicit-imports/noProjectGlobals.test.ts tests/server/agent tests/server/case tests/server/material --reporter=verbose
```

Expected:

- `noProjectGlobals` PASS
- 相关服务端测试不再依赖 `globalThis.prisma/logger`

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/server/agent/test-setup.ts tests/server/case/test-setup.ts tests/server/material/test-setup.ts tests/server/membership/test-setup.ts tests/shared/nuxt-explicit-imports/noProjectGlobals.test.ts
git commit -m "test: remove project-global auto-import assumptions"
```

---

## Task 10: 更新文档与后续守卫

**Files:**
- Create: `scripts/nuxt-explicit-imports/shared/fileSets.ts`
- Modify: `scripts/nuxt-explicit-imports/check.ts`
- Modify: `tests/shared/nuxt-explicit-imports/check.test.ts`
- Modify: `docs/tech-docs/architecture/auto-imports.md`
- Modify: `docs/tech-docs/frontend/overview.md`
- Modify: `docs/tech-docs/frontend/composables.md`
- Modify: `docs/tech-docs/frontend/stores.md`
- Modify: `docs/tech-docs/patterns/service-dao.md`
- Modify: `docs/tech-docs/guides/new-module-checklist.md`
- Modify: `docs/tech-docs/guides/testing-strategy.md`
- Modify: `package.json`

- [ ] **Step 1: 先扩展检查器测试，锁定 `--all` 守卫行为**

```ts
// tests/shared/nuxt-explicit-imports/check.test.ts
import { describe, expect, it } from 'vitest'
import { collectProjectFiles } from '../../../scripts/nuxt-explicit-imports/shared/fileSets'

describe('collectProjectFiles', () => {
  it('collects app and server source files for guard mode', async () => {
    const files = await collectProjectFiles(process.cwd())

    expect(files).toContain('app/app.vue')
    expect(files).toContain('server/api/health.get.ts')
    expect(files.every((file) => file.startsWith('app/') || file.startsWith('server/'))).toBe(true)
  })
})
```

- [ ] **Step 2: 实现全量守卫模式并挂到 package script**

```ts
// scripts/nuxt-explicit-imports/shared/fileSets.ts
import { readdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

export const collectProjectFiles = async (rootDir: string) => {
  const result: string[] = []
  for (const dir of ['app/pages', 'app/layouts', 'app/components', 'app/composables', 'app/store', 'app/utils', 'server/api', 'server/services', 'server/utils']) {
    for (const entry of await readdir(resolve(rootDir, dir), { recursive: true })) {
      const full = resolve(rootDir, dir, String(entry))
      if (!full.endsWith('.ts') && !full.endsWith('.vue')) continue
      result.push(relative(rootDir, full).replace(/\\/g, '/'))
    }
  }
  return result.sort()
}
```

```ts
// scripts/nuxt-explicit-imports/check.ts
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { collectProjectFiles } from './shared/fileSets'
import { findMissingProjectImports } from './shared/symbolUsage'

const rootDir = process.cwd()
const manifest = JSON.parse(await readFile(resolve(rootDir, '.cache/nuxt-explicit-imports/manifest.json'), 'utf8'))
const builtins = new Set(['useRoute', 'useRouter', 'useFetch', 'useState', 'useRuntimeConfig', 'ref', 'computed', 'watch', 'watchEffect', 'onMounted', 'defineEventHandler', 'readBody', 'getQuery'])
const args = new Set(process.argv.slice(2))
const targetFiles = args.has('--all') ? await collectProjectFiles(rootDir) : process.argv.slice(2).filter((arg) => !arg.startsWith('--'))

const allFindings: Array<{ filePath: string; symbol: string; importPath: string }> = []

for (const filePath of targetFiles) {
  const source = await readFile(resolve(rootDir, filePath), 'utf8')
  const symbols = filePath.startsWith('server/') ? manifest.server : manifest.app
  const findings = findMissingProjectImports({ filePath, source, symbols, builtins })
  for (const finding of findings) {
    allFindings.push({ filePath, ...finding })
  }
}

await writeFile(resolve(rootDir, '.cache/nuxt-explicit-imports/findings.json'), JSON.stringify(allFindings, null, 2))
console.log(JSON.stringify(allFindings, null, 2))

if (args.has('--fail-on-findings') && allFindings.length > 0) process.exit(1)
```

```json
// package.json
{
  "scripts": {
    "guard:explicit-imports": "bun run audit:explicit-imports && npx tsx scripts/nuxt-explicit-imports/check.ts --all --fail-on-findings"
  }
}
```

- [ ] **Step 3: 把文档中的默认心智从“自动导入”改成“显式导入”**

```md
<!-- docs/tech-docs/architecture/auto-imports.md -->
## 当前约束

- Nuxt/Vue/H3 内置能力仍可自动导入，例如 `ref`、`useRoute`、`defineEventHandler`
- 项目组件、`app/store`、`app/composables`、`app/utils`、`shared/utils`、`server/services` 必须显式导入
- 不要使用 `#components` 作为项目组件显式导入手段；请直接使用真实路径或目录出口
- `ai-elements` 组件优先从 `~/components/ai-elements` 或对应子目录 `index.ts` 导入
- 组件漏导入主要由 `npx nuxi typecheck` 和高风险页面 smoke test 兜底
```

```md
<!-- docs/tech-docs/guides/new-module-checklist.md -->
- [ ] 新增项目 composable / store / shared util 后，调用方已显式 import
- [ ] 模板中使用的项目组件已在 `<script setup>` 中显式导入
- [ ] 不依赖 Nuxt 项目级自动导入补齐业务符号
```

- [ ] **Step 4: 运行文档 / 守卫验证**

Run:

```bash
bun run guard:explicit-imports
```

Expected:

- 若还有项目级遗漏，脚本失败并打印 findings
- 全部迁移完成后，该命令返回 0

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/nuxt-explicit-imports/check.ts scripts/nuxt-explicit-imports/shared/fileSets.ts tests/shared/nuxt-explicit-imports/check.test.ts docs/tech-docs/architecture/auto-imports.md docs/tech-docs/frontend/overview.md docs/tech-docs/frontend/composables.md docs/tech-docs/frontend/stores.md docs/tech-docs/patterns/service-dao.md docs/tech-docs/guides/new-module-checklist.md docs/tech-docs/guides/testing-strategy.md
git commit -m "docs: document explicit-import architecture and guardrails"
```

---

## Task 11: 最终验证与收尾

**Files:** 仅验证；若发现问题，回到对应 Task 修复

- [ ] **Step 1: 跑最终基线命令**

Run:

```bash
npx nuxt prepare
npx nuxi typecheck
```

Expected:

- `nuxt prepare` 不再依赖项目级组件/导入扫描作为运行前提
- 若 `generated/prisma/enums.js` 的 `unimport` 扫描告警仍存在，将其视为独立问题单独处理，不作为本迁移阻塞条件
- 类型检查通过

- [ ] **Step 2: 跑关键测试集合**

Run:

```bash
npx vitest run tests/server/agent tests/server/assistant tests/server/utils tests/client/composables tests/client/store tests/app/components/ai/AiPromptInput.test.ts tests/app/components/assistant/contract/ContractReviewPanel.test.ts tests/client/components/caseAnalysis/promptInput.test.ts --reporter=verbose
```

Expected: 关键服务端、前端脚本、`ai-elements` 高频入口全部通过

- [ ] **Step 3: 做人工 smoke test**

验证以下路径：

- 登录页
- Dashboard 主入口
- 一个重 `AiElements` 页面（优先验证 `app/components/case/interrupt/ModuleSelectHandler.vue` 所在流程）
- 一个重表单页面
- 一条典型服务端 API

Expected: 页面加载正常、无组件解析报错、无“symbol is not defined” 运行时错误

- [ ] **Step 4: 生成最终 diff 摘要**

Run:

```bash
git diff --stat $(git merge-base HEAD dev)..HEAD
```

Expected: diff 主要集中在 `nuxt.config.ts`、`scripts/nuxt-explicit-imports/`、`app/`、`server/`、`tests/`、`docs/`

- [ ] **Step 5: 不额外提交**

本任务只做最终验收；若此处发现问题，回到对应 Task 修复并在对应 Task 提交。
