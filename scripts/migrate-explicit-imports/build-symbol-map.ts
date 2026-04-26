// 从 .nuxt/imports.d.ts、.nuxt/components.d.ts、.nuxt/types/nitro-imports.d.ts
// 生成 symbol → { from, kind, isType, isDefault } 的映射
//
// 使用前先确认 nuxt.config.ts 处于 baseline 自动导入开启状态，并跑过 npx nuxi prepare
//
// 用法: bunx tsx scripts/migrate-explicit-imports/build-symbol-map.ts

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface SymbolEntry {
  name: string                    // 符号在使用处的名字（含别名后的）
  from: string                    // 真实来源路径（已规范成项目可用 import path）
  kind: 'frontend' | 'nitro' | 'component'
  isType: boolean                 // 是否为 type-only 符号（type/interface/enum 暂不能区分，按文件名启发）
  isDefault: boolean              // 是否需要 default import
  originalName?: string           // 原始导出名（如果使用 `as` 重命名）
  needsImport: boolean            // 关闭自动导入后是否仍需手动补 import（false = 框架级符号继续保留自动导入）
}

// 关闭自动导入后仍保留为自动 import 的来源前缀（不需要补 import）
// 这些是 Nuxt/Vue 框架级 magic — `imports.scan: false` 仍保留它们
const KEEP_AUTO_PATH_PREFIXES = [
  'vue',           // ref / computed / watch / onMounted ...（精确名 'vue'）
  'vue-router',
  'vue-demi',
  '#app',
  '#imports',
  '@vue/',
  '@nuxt/scripts',
  '@nuxt/image',
  '@pinia/nuxt',
  'nitropack/',
  'h3',
]
// server/utils/* 仍由 nitro 默认扫描（PoC 实测），保留自动
const KEEP_AUTO_PATH_INFIXES = ['/server/utils/']
// 白名单显式声明的符号（按名字匹配，不按路径）
const WHITELIST_SYMBOLS = new Set([
  'logger',
  'resSuccess',
  'resError',
])

// DOM / JS / Node 全局符号（避免跟 ~/store/node、shared/types/node 等同名 export 撞车）
// 出现在使用处时，优先认为是全局，不补 import
const BUILTIN_GLOBALS = new Set([
  'Node', 'NodeList', 'Element', 'HTMLElement', 'HTMLImageElement', 'HTMLInputElement',
  'HTMLAnchorElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLButtonElement',
  'HTMLCanvasElement', 'HTMLVideoElement', 'HTMLAudioElement', 'HTMLFormElement',
  'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLLabelElement', 'HTMLOptionElement',
  'Document', 'Window', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'FocusEvent', 'PointerEvent', 'TouchEvent', 'WheelEvent', 'DragEvent', 'EventTarget',
  'FormData', 'Blob', 'File', 'FileList', 'URL', 'URLSearchParams',
  'Headers', 'Request', 'Response', 'fetch',
  'AbortController', 'AbortSignal', 'ReadableStream', 'WritableStream',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'localStorage', 'sessionStorage', 'console', 'navigator', 'document', 'window',
  'globalThis', 'structuredClone',
  'Buffer', 'process', '__dirname', '__filename',
  'Promise', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect',
  'JSON', 'Math', 'NaN', 'Infinity',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
  'ArrayBuffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array',
  'Int32Array', 'Float32Array', 'Float64Array', 'DataView',
  'Text', // DOM Text node — 跟其他 Text 同名也容易撞
])

function inferNeedsImport(from: string, name: string): boolean {
  if (WHITELIST_SYMBOLS.has(name)) return false
  // DOM / JS 全局名跟项目自定义同名时，不要给项目符号补 import（避免覆盖全局）
  if (BUILTIN_GLOBALS.has(name)) return false
  // 所有 node_modules 衍生符号都是框架 / 库 magic，不需要补
  if (from.startsWith('node_modules:')) return false
  if (KEEP_AUTO_PATH_PREFIXES.some(p => from === p || from.startsWith(p + '/'))) return false
  if (KEEP_AUTO_PATH_INFIXES.some(p => from.includes(p))) return false
  return true
}

interface SymbolMap {
  frontend: Record<string, SymbolEntry>
  nitro: Record<string, SymbolEntry>
  component: Record<string, SymbolEntry>
}

const ROOT = resolve(__dirname, '../..')

// ========== path 规范化 ==========
// .nuxt/imports.d.ts 用 `'../app/composables/foo'`、`'../shared/utils/foo'`、`'../generated/prisma/client'`
// 我们规范成项目内可移植的 alias：
//   ../app/...       → ~/...  （tsconfig 里的 ~ 别名指向 app/）
//   ../shared/...    → #shared/...
//   ../server/...    → ~~/server/...
//   ../generated/... → ~~/generated/...
// 已经是 # 或 vue / vue-router / 第三方包的保留原样

function stripIndexSuffix(p: string): string {
  return p.replace(/\/index$/, '')
}

function normalizeFrom(rawFrom: string): string {
  if (rawFrom.startsWith('#') || rawFrom.startsWith('vue') || rawFrom.startsWith('@') || !rawFrom.startsWith('.')) {
    return stripIndexSuffix(rawFrom)
  }
  // 把 ../ 前缀去掉
  let p = rawFrom.replace(/^(\.\.\/)+/, '')
  if (p.startsWith('app/')) return stripIndexSuffix('~/' + p.slice(4))
  if (p.startsWith('shared/')) return stripIndexSuffix('#shared/' + p.slice(7))
  if (p.startsWith('server/')) return stripIndexSuffix('~~/server/' + p.slice(7))
  if (p.startsWith('generated/')) return stripIndexSuffix('~~/generated/' + p.slice(10))
  if (p.startsWith('node_modules/')) {
    // 保留 node_modules 完整子路径，去掉 dist 中转段
    // 这些路径都是框架 / 库提供的 magic（vue / nitropack / h3 / @nuxt/* / @pinia/nuxt）
    // 用 NODE_MODULES_PREFIX 标记为不需要补 import（推断时统一处理）
    let rest = p.slice('node_modules/'.length).replace('/dist/', '/')
    return 'node_modules:' + rest
  }
  return rawFrom
}

// ========== 解析 imports.d.ts / nitro-imports.d.ts ==========

// 行格式：export { A, B as C, type D } from 'path';
// 或 export { default as Foo } from 'path';
const EXPORT_LINE_RE = /^export\s+(type\s+)?\{\s*([^}]+)\}\s+from\s+'([^']+)'/

function parseExportLine(line: string): Array<{ name: string; originalName?: string; isDefault: boolean; isTypeOnly: boolean }> | null {
  const m = EXPORT_LINE_RE.exec(line.trim())
  if (!m) return null
  const [, typeKw, namesStr] = m
  const exportTypeOnly = !!typeKw
  return namesStr!.split(',').map(part => {
    const trimmed = part.trim()
    const itemTypeOnly = /^type\s+/.test(trimmed)
    const seg = trimmed.replace(/^type\s+/, '')
    if (!seg) return null
    const isTypeOnly = exportTypeOnly || itemTypeOnly
    const asMatch = /^(\S+)\s+as\s+(\S+)$/.exec(seg)
    if (asMatch) {
      const [, original, alias] = asMatch
      return {
        name: alias!,
        originalName: original,
        isDefault: original === 'default',
        isTypeOnly,
      }
    }
    return { name: seg, isDefault: false, isTypeOnly }
  }).filter((x): x is NonNullable<typeof x> => x !== null)
}

function parseImportsDts(filePath: string, kind: 'frontend' | 'nitro'): Record<string, SymbolEntry> {
  const content = readFileSync(filePath, 'utf-8')
  const map: Record<string, SymbolEntry> = {}
  for (const line of content.split('\n')) {
    const m = EXPORT_LINE_RE.exec(line.trim())
    if (!m) continue
    const [, , , rawFrom] = m
    const from = normalizeFrom(rawFrom!)
    const items = parseExportLine(line)
    if (!items) continue
    for (const item of items) {
      // 已有同名条目，第一个胜出（避免被后扫到的覆盖）
      if (map[item.name]) continue
      map[item.name] = {
        name: item.name,
        from,
        kind,
        isType: item.isTypeOnly,
        isDefault: item.isDefault,
        originalName: item.originalName,
        needsImport: inferNeedsImport(from, item.name),
      }
    }
  }
  return map
}

// nitro-imports.d.ts 里大量是 `const X: typeof import('path').X` 形式的全局声明
// 行格式: `  const Foo: typeof import('../../server/services/x/x.service').Foo`
// 或者: `  const Foo: typeof import('../../server/services/x/x.service')['Foo']`
const NITRO_GLOBAL_RE = /^\s*const\s+(\w+):\s*typeof\s+import\(['"]([^'"]+)['"]\)(?:\.(\w+)|\[['"](\w+)['"]\])?/

function parseNitroImportsDts(filePath: string): Record<string, SymbolEntry> {
  const content = readFileSync(filePath, 'utf-8')
  const map: Record<string, SymbolEntry> = {}
  for (const line of content.split('\n')) {
    // 优先按 export 行解析
    const exp = EXPORT_LINE_RE.exec(line.trim())
    if (exp) {
      const [, , , rawFrom] = exp
      const from = normalizeFrom(rawFrom!)
      const items = parseExportLine(line)
      if (items) {
        for (const item of items) {
          if (map[item.name]) continue
          map[item.name] = {
            name: item.name,
            from,
            kind: 'nitro',
            isType: item.isTypeOnly,
            isDefault: item.isDefault,
            originalName: item.originalName,
            needsImport: inferNeedsImport(from, item.name),
          }
        }
      }
      continue
    }
    // 再按 const 全局声明
    const m = NITRO_GLOBAL_RE.exec(line)
    if (m) {
      const [, name, rawFrom, prop1, prop2] = m
      const from = normalizeFrom(rawFrom!)
      const original = prop1 || prop2 || name
      if (!map[name!]) {
        map[name!] = {
          name: name!,
          from,
          kind: 'nitro',
          isType: false,
          isDefault: false,
          originalName: original !== name ? original : undefined,
          needsImport: inferNeedsImport(from, name!),
        }
      }
    }
  }
  return map
}

// ========== 解析 components.d.ts ==========

// 行格式: `export const FooBar: typeof import("../app/components/path/Foo.vue").default`
// 或:    `export const FooBar: typeof import("../app/components/path/index").FooBar`
const COMPONENT_RE = /^export\s+const\s+(\w+):\s+typeof\s+import\("([^"]+)"\)\.(\w+|\bdefault\b)$/

function parseComponentsDts(filePath: string): Record<string, SymbolEntry> {
  const content = readFileSync(filePath, 'utf-8')
  const map: Record<string, SymbolEntry> = {}
  for (const line of content.split('\n')) {
    const m = COMPONENT_RE.exec(line.trim())
    if (!m) continue
    const [, name, rawFrom, exportName] = m
    if (name!.startsWith('Lazy')) continue // 跳过 Lazy 变体（运行时按需用）
    const from = normalizeFrom(rawFrom!)
    // 组件需补 import 的判断：来源不在 ai-elements/ 且不是 shadcn ui/、Nuxt 内置、@nuxt/* 模块
    const isNodeModules = from.startsWith('node_modules:')
    const isAiElements = from.includes('/components/ai-elements/') || from.startsWith('~/components/ai-elements/')
    const isShadcnUi = from.includes('/components/ui/') || from.startsWith('~/components/ui/')
    const needsImport = !isAiElements && !isShadcnUi && !isNodeModules
    map[name!] = {
      name: name!,
      from,
      kind: 'component',
      isType: false,
      isDefault: exportName === 'default',
      originalName: exportName !== 'default' && exportName !== name ? exportName : undefined,
      needsImport,
    }
  }
  return map
}

// ========== type / value enrichment ==========
// 对 ~~/generated/prisma/client、#shared/types/*、#shared/utils/*、~/composables/*、~/store/*、~/utils/* 解析真实文件，
// 把每个 export 的 kind（type-only 还是 value）准确填入 isType

const ROOT2 = resolve(__dirname, '../..')

function aliasToFsPath(alias: string): string | null {
  let candidate: string | null = null
  if (alias.startsWith('~~/')) candidate = resolve(ROOT2, alias.slice(3))
  else if (alias.startsWith('~/')) candidate = resolve(ROOT2, 'app', alias.slice(2))
  else if (alias.startsWith('#shared/')) candidate = resolve(ROOT2, 'shared', alias.slice(8))
  else return null

  // 允许 .ts / index.ts / .vue（必须是文件，不是目录）
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = candidate + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  // 最后再考虑 candidate 本身（必须是文件）
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

// 收集一个文件中"type-only export"和"value export"
function collectExportKinds(filePath: string): Map<string, 'type' | 'value'> {
  const kinds = new Map<string, 'type' | 'value'>()
  if (!existsSync(filePath)) return kinds
  const src = readFileSync(filePath, 'utf-8')
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  function record(name: string, kind: 'type' | 'value') {
    if (!kinds.has(name)) kinds.set(name, kind)
  }

  for (const stmt of sf.statements) {
    // export const / let / var
    if (ts.isVariableStatement(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) record(decl.name.text, 'value')
      }
    }
    // export function
    if (ts.isFunctionDeclaration(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && stmt.name) {
      record(stmt.name.text, 'value')
    }
    // export class
    if (ts.isClassDeclaration(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && stmt.name) {
      record(stmt.name.text, 'value')
    }
    // export enum（默认值）
    if (ts.isEnumDeclaration(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      record(stmt.name.text, 'value')
    }
    // export type / export interface
    if (ts.isTypeAliasDeclaration(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      record(stmt.name.text, 'type')
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      record(stmt.name.text, 'type')
    }
    // export namespace（值）
    if (ts.isModuleDeclaration(stmt) && stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && ts.isIdentifier(stmt.name)) {
      record(stmt.name.text, 'value')
    }
    // export { A, type B } from '...';
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const isType = stmt.isTypeOnly || el.isTypeOnly
        record(el.name.text, isType ? 'type' : 'value')
      }
    }
  }
  return kinds
}

function enrichSymbolMap(map: SymbolMap): void {
  // 收集所有需要解析的 from 路径
  const fromsToResolve = new Set<string>()
  for (const m of [map.frontend, map.nitro]) {
    for (const e of Object.values(m)) {
      if (!e.needsImport) continue
      // 仅项目内来源（~/, ~~/, #shared/）
      if (e.from.startsWith('~/') || e.from.startsWith('~~/') || e.from.startsWith('#shared/')) {
        fromsToResolve.add(e.from)
      }
    }
  }
  // 解析每个来源文件的 export kinds
  const fromKinds = new Map<string, Map<string, 'type' | 'value'>>()
  for (const from of fromsToResolve) {
    const fsPath = aliasToFsPath(from)
    if (!fsPath) continue
    fromKinds.set(from, collectExportKinds(fsPath))
  }
  // 反填 isType
  for (const m of [map.frontend, map.nitro]) {
    for (const entry of Object.values(m)) {
      if (!entry.needsImport) continue
      const kinds = fromKinds.get(entry.from)
      if (!kinds) continue
      const realName = entry.originalName || entry.name
      const kind = kinds.get(realName)
      if (kind === 'type') entry.isType = true
    }
  }
}

// ========== 主流程 ==========

function main() {
  const importsDts = resolve(ROOT, '.nuxt/imports.d.ts')
  const nitroImportsDts = resolve(ROOT, '.nuxt/types/nitro-imports.d.ts')
  const componentsDts = resolve(ROOT, '.nuxt/components.d.ts')

  const map: SymbolMap = {
    frontend: parseImportsDts(importsDts, 'frontend'),
    nitro: parseNitroImportsDts(nitroImportsDts),
    component: parseComponentsDts(componentsDts),
  }

  enrichSymbolMap(map)

  const out = resolve(ROOT, 'scripts/migrate-explicit-imports/symbol-map.json')
  writeFileSync(out, JSON.stringify(map, null, 2), 'utf-8')

  const countNeed = (m: Record<string, SymbolEntry>) => Object.values(m).filter(e => e.needsImport).length
  console.log(`frontend:  total=${Object.keys(map.frontend).length}  needsImport=${countNeed(map.frontend)}`)
  console.log(`nitro:     total=${Object.keys(map.nitro).length}     needsImport=${countNeed(map.nitro)}`)
  console.log(`component: total=${Object.keys(map.component).length} needsImport=${countNeed(map.component)}`)
  console.log(`written → ${out}`)
}

main()
