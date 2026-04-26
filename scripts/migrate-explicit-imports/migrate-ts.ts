// 把单个 .ts 文件中"用了但没 import"的自动导入符号补成显式 import
//
// 用法:
//   bunx tsx scripts/migrate-explicit-imports/migrate-ts.ts <file-or-dir> [--side=frontend|nitro] [--dry-run]
//
// side: frontend 用 .nuxt/imports.d.ts；nitro 用 nitro-imports.d.ts；
//       自动判断：路径在 server/ 下走 nitro，其他走 frontend
//
// 注意：codemod 是 best-effort，跑完必须跑 typecheck 校验

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../..')

interface SymbolEntry {
  name: string
  from: string
  kind: 'frontend' | 'nitro' | 'component'
  isType: boolean
  isDefault: boolean
  originalName?: string
  needsImport: boolean
}
interface SymbolMap {
  frontend: Record<string, SymbolEntry>
  nitro: Record<string, SymbolEntry>
  component: Record<string, SymbolEntry>
}

const symbolMap: SymbolMap = JSON.parse(
  readFileSync(resolve(__dirname, 'symbol-map.json'), 'utf-8')
)

// ========== identifier 收集（基于 TS scanner，比正则可靠） ==========

interface CollectResult {
  used: Set<string>           // 引用集合（已排除局部 binding 屏蔽）— 用于 value 符号判断
  usedAll: Set<string>        // 引用集合（不做局部 binding 屏蔽）— 用于 type 符号判断
                              // 因 TS 的 type 和 value 是独立 namespace，类型不会被局部变量遮蔽
  imported: Set<string>
  importedTypeOnly: Set<string>
}

function collectIdentifiers(source: string): CollectResult {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const used = new Set<string>()
  const usedAll = new Set<string>()
  const imported = new Set<string>()
  const importedTypeOnly = new Set<string>()
  // 区分 type / value 命名空间的局部 binding，避免给同名 type 重复加 import 引发 TS2440
  const localValueBindings = new Set<string>()
  const localTypeBindings = new Set<string>()

  function collectBindings(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const ic = node.importClause
      if (ic) {
        if (ic.name) {
          imported.add(ic.name.text)
          if (ic.isTypeOnly) {
            importedTypeOnly.add(ic.name.text)
            localTypeBindings.add(ic.name.text)
          } else {
            localValueBindings.add(ic.name.text)
            localTypeBindings.add(ic.name.text)
          }
        }
        if (ic.namedBindings) {
          if (ts.isNamespaceImport(ic.namedBindings)) {
            imported.add(ic.namedBindings.name.text)
            localValueBindings.add(ic.namedBindings.name.text)
            localTypeBindings.add(ic.namedBindings.name.text)
          } else if (ts.isNamedImports(ic.namedBindings)) {
            for (const el of ic.namedBindings.elements) {
              imported.add(el.name.text)
              const typeOnly = ic.isTypeOnly || el.isTypeOnly
              if (typeOnly) {
                importedTypeOnly.add(el.name.text)
                localTypeBindings.add(el.name.text)
              } else {
                localValueBindings.add(el.name.text)
                localTypeBindings.add(el.name.text)
              }
            }
          }
        }
      }
      return
    }
    function recordValueName(name: ts.BindingName | ts.PropertyName | undefined | ts.Identifier) {
      if (!name) return
      if (ts.isIdentifier(name)) {
        localValueBindings.add(name.text)
      } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        for (const el of name.elements) {
          if (ts.isBindingElement(el)) recordValueName(el.name)
        }
      }
    }
    if (ts.isParameter(node)) recordValueName(node.name)
    else if (ts.isVariableDeclaration(node)) recordValueName(node.name)
    else if (ts.isFunctionDeclaration(node) && node.name) localValueBindings.add(node.name.text)
    else if (ts.isClassDeclaration(node) && node.name) {
      localValueBindings.add(node.name.text)
      localTypeBindings.add(node.name.text)
    }
    else if (ts.isInterfaceDeclaration(node)) localTypeBindings.add(node.name.text)
    else if (ts.isTypeAliasDeclaration(node)) localTypeBindings.add(node.name.text)
    else if (ts.isEnumDeclaration(node)) {
      localValueBindings.add(node.name.text)
      localTypeBindings.add(node.name.text)
    }
    else if (ts.isCatchClause(node) && node.variableDeclaration) recordValueName(node.variableDeclaration.name)
    else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) localValueBindings.add(node.name.text)
    else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) localValueBindings.add(node.name.text)
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(sourceFile)
  // 兼容旧逻辑：localBindings = value 屏蔽集合（用于 value 引用判断）
  const localBindings = localValueBindings

  // 第二遍：收集所有 identifier 引用（排除属性访问、QualifiedName.right、声明本身）
  function collectRefs(node: ts.Node) {
    if (ts.isImportDeclaration(node)) return // 不重复处理 import
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) return
      if (parent && ts.isQualifiedName(parent) && parent.right === node) return
      if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return
      // 声明本身的命名（不是引用）
      if (parent && (
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isClassDeclaration(parent) && parent.name === node) ||
        (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
        (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
        (ts.isEnumDeclaration(parent) && parent.name === node) ||
        (ts.isEnumMember(parent) && parent.name === node) ||
        (ts.isImportSpecifier(parent) && parent.name === node) ||
        (ts.isExportSpecifier(parent) && parent.name === node) ||
        (ts.isImportClause(parent) && parent.name === node) ||
        (ts.isNamespaceImport(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isPropertyDeclaration(parent) && parent.name === node) ||
        (ts.isMethodSignature(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.name === node) ||
        (ts.isLabeledStatement(parent) && parent.label === node) ||
        (ts.isBreakOrContinueStatement(parent) && parent.label === node)
      )) {
        // ShorthandPropertyAssignment 同时是声明 + 引用（`{ foo }` 等价 `{ foo: foo }`）
        return
      }
      if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
        usedAll.add(node.text)
        if (!localBindings.has(node.text)) used.add(node.text)
        return
      }
      // 普通 Identifier 引用
      usedAll.add(node.text)
      if (!localBindings.has(node.text)) used.add(node.text)
    }
    ts.forEachChild(node, collectRefs)
  }
  collectRefs(sourceFile)
  // 把 type 屏蔽集合通过 importedTypeOnly 借道传出（避免改接口）
  for (const n of localTypeBindings) importedTypeOnly.add('__TYPE_BOUND__:' + n)
  return { used, usedAll, imported, importedTypeOnly }
}

// ========== 计算需要补的 import ==========

function getSymbolMapForFile(absPath: string): Record<string, SymbolEntry> {
  const relPath = relative(ROOT, absPath)
  if (relPath.startsWith('server/')) {
    return { ...symbolMap.frontend, ...symbolMap.nitro }
  }
  // 前端：以 frontend map 为主；遇到 frontend 没有但 nitro 里有的 type-only 符号
  // （如 server export 的 interface），允许前端 import 该类型来源（避免 baseline 项目代码原本就跨层用 server 类型时的兜底缺失）
  const merged: Record<string, SymbolEntry> = { ...symbolMap.frontend, ...symbolMap.component }
  for (const [name, entry] of Object.entries(symbolMap.nitro)) {
    if (merged[name]) continue
    if (!entry.isType) continue
    if (!entry.from.startsWith('~~/server/')) continue
    merged[name] = entry
  }
  return merged
}

function diffNeeded(used: Set<string>, usedAll: Set<string>, imported: Set<string>, map: Record<string, SymbolEntry>, importedTypeOnly?: Set<string>): SymbolEntry[] {
  const needed: SymbolEntry[] = []
  // 提取 localTypeBindings（borrowed via importedTypeOnly）
  const localTypeBindings = new Set<string>()
  if (importedTypeOnly) {
    for (const x of importedTypeOnly) {
      if (x.startsWith('__TYPE_BOUND__:')) localTypeBindings.add(x.slice('__TYPE_BOUND__:'.length))
    }
  }
  const candidates = new Set<string>()
  for (const n of used) candidates.add(n)
  for (const n of usedAll) {
    const entry = map[n]
    if (entry?.isType) candidates.add(n) // type 不被局部 value 屏蔽
  }
  for (const name of candidates) {
    if (imported.has(name)) continue
    const entry = map[name]
    if (!entry) continue
    if (!entry.needsImport) continue
    // type 符号被本地 type 声明屏蔽时跳过（避免 TS2440）
    // 本地若有同名 type 声明或 value 声明，跳过补 import 避免 TS2440
    if (localTypeBindings.has(name)) continue
    needed.push(entry)
  }
  return needed
}

// ========== 生成 import 语句并插入文件 ==========

function buildImportStatements(needed: SymbolEntry[]): string {
  // 按 from 聚合，并区分 type-only 和 value
  // 一个 from 可能同时有 type 和 value 两种 named import，需要分开两行
  const byFrom: Record<string, {
    defaults: SymbolEntry[]
    namedValue: SymbolEntry[]
    namedType: SymbolEntry[]
  }> = {}
  for (const e of needed) {
    if (!byFrom[e.from]) byFrom[e.from] = { defaults: [], namedValue: [], namedType: [] }
    if (e.isDefault) byFrom[e.from]!.defaults.push(e)
    else if (e.isType) byFrom[e.from]!.namedType.push(e)
    else byFrom[e.from]!.namedValue.push(e)
  }
  const lines: string[] = []
  const fromKeys = Object.keys(byFrom).sort()
  const fmtList = (arr: SymbolEntry[]) =>
    `{ ${arr.map(e => e.originalName && e.originalName !== e.name ? `${e.originalName} as ${e.name}` : e.name).sort().join(', ')} }`
  for (const from of fromKeys) {
    const { defaults, namedValue, namedType } = byFrom[from]!
    if (defaults.length === 1 && namedValue.length === 0 && namedType.length === 0) {
      lines.push(`import ${defaults[0]!.name} from '${from}'`)
    } else {
      if (defaults.length === 1 && namedValue.length > 0) {
        lines.push(`import ${defaults[0]!.name}, ${fmtList(namedValue)} from '${from}'`)
      } else if (defaults.length === 1) {
        lines.push(`import ${defaults[0]!.name} from '${from}'`)
      } else if (namedValue.length > 0) {
        lines.push(`import ${fmtList(namedValue)} from '${from}'`)
      }
      if (namedType.length > 0) {
        lines.push(`import type ${fmtList(namedType)} from '${from}'`)
      }
      // 多个 default（罕见）
      if (defaults.length > 1) {
        for (const d of defaults.slice(1)) lines.push(`import ${d.name} from '${from}'`)
      }
    }
  }
  return lines.join('\n')
}

function insertImports(source: string, importBlock: string): string {
  if (!importBlock) return source
  // 找最后一个 import 语句的位置（顶部块），插在它后面；找不到则插在开头
  const sourceFile = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let lastImportEnd = -1
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      lastImportEnd = stmt.getEnd()
    } else {
      break
    }
  }
  if (lastImportEnd >= 0) {
    return source.slice(0, lastImportEnd) + '\n' + importBlock + source.slice(lastImportEnd)
  }
  // 没有现有 import
  // 跳过文件开头的 shebang / commented header
  return importBlock + '\n' + source
}

// ========== 处理单个文件 ==========

interface MigrateResult {
  changed: boolean
  added: number
  message?: string
}

function migrateFile(absPath: string, dryRun: boolean): MigrateResult {
  const source = readFileSync(absPath, 'utf-8')
  const { used, usedAll, imported, importedTypeOnly } = collectIdentifiers(source)
  const map = getSymbolMapForFile(absPath)
  const needed = diffNeeded(used, usedAll, imported, map, importedTypeOnly)
  if (needed.length === 0) return { changed: false, added: 0 }
  const importBlock = buildImportStatements(needed)
  const newSource = insertImports(source, importBlock)
  if (newSource === source) return { changed: false, added: 0 }
  if (!dryRun) writeFileSync(absPath, newSource, 'utf-8')
  return { changed: true, added: needed.length, message: importBlock }
}

// ========== 批量处理目录 ==========

function listFiles(target: string, exts: Set<string>): string[] {
  const out: string[] = []
  const stat = statSync(target)
  if (stat.isFile()) {
    if (exts.has(target.slice(target.lastIndexOf('.')))) out.push(target)
    return out
  }
  for (const ent of readdirSync(target, { withFileTypes: true })) {
    // 仅跳过 . 开头的目录（如 .git / .nuxt），允许 . 开头的文件（如 Nuxt 的 .get.ts / .post.ts）
    if (ent.isDirectory() && ent.name.startsWith('.')) continue
    if (ent.name === 'node_modules' || ent.name === 'dist') continue
    const p = join(target, ent.name)
    if (ent.isDirectory()) out.push(...listFiles(p, exts))
    else if (exts.has(ent.name.slice(ent.name.lastIndexOf('.')))) out.push(p)
  }
  return out
}

// ========== 主入口 ==========

function main() {
  const args = process.argv.slice(2)
  const target = args.find(a => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')
  if (!target) {
    console.error('Usage: tsx migrate-ts.ts <file-or-dir> [--dry-run]')
    process.exit(1)
  }
  const absTarget = resolve(ROOT, target)
  const files = listFiles(absTarget, new Set(['.ts']))
  let totalChanged = 0
  let totalAdded = 0
  for (const f of files) {
    try {
      const r = migrateFile(f, dryRun)
      if (r.changed) {
        totalChanged++
        totalAdded += r.added
        console.log(`✓ ${relative(ROOT, f)}: +${r.added} imports`)
        if (process.argv.includes('--verbose') && r.message) {
          console.log(r.message.split('\n').map(l => '    ' + l).join('\n'))
        }
      }
    } catch (e: any) {
      console.error(`✗ ${relative(ROOT, f)}: ${e.message}`)
    }
  }
  console.log(`\nDone: ${totalChanged}/${files.length} files changed, ${totalAdded} imports added${dryRun ? ' (dry-run)' : ''}`)
}

main()
