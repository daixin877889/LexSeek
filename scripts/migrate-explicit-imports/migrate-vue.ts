// Vue SFC codemod: 给 <script>/<script setup> 块补显式 import
// 同时识别 <template> 中的组件标签，补 default import
//
// 用法: bunx tsx scripts/migrate-explicit-imports/migrate-vue.ts <file-or-dir> [--dry-run] [--verbose]

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'

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

// ========== identifier 收集（同 migrate-ts.ts，复制过来） ==========

interface CollectResult {
  used: Set<string>
  usedAll: Set<string>
  imported: Set<string>
  importedTypeOnly: Set<string>
  localValueBindings: Set<string>
  localTypeBindings: Set<string>
}

function collectIdentifiers(source: string): CollectResult {
  const sourceFile = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const used = new Set<string>()
  const usedAll = new Set<string>()
  const imported = new Set<string>()
  const importedTypeOnly = new Set<string>()
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
  const localBindings = localValueBindings

  function collectRefs(node: ts.Node) {
    if (ts.isImportDeclaration(node)) return
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) return
      if (parent && ts.isQualifiedName(parent) && parent.right === node) return
      if (parent && ts.isPropertyAssignment(parent) && parent.name === node) return
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
        return
      }
      if (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
        usedAll.add(node.text)
        if (!localBindings.has(node.text)) used.add(node.text)
        return
      }
      usedAll.add(node.text)
      if (!localBindings.has(node.text)) used.add(node.text)
    }
    ts.forEachChild(node, collectRefs)
  }
  collectRefs(sourceFile)
  for (const n of localTypeBindings) importedTypeOnly.add('__TYPE_BOUND__:' + n)
  return { used, usedAll, imported, importedTypeOnly, localValueBindings, localTypeBindings }
}

// ========== Vue 模板组件标签提取 ==========

// 匹配 <PascalCase 或 <kebab-case 自定义组件标签
// 排除：HTML 标准标签（小写）；Nuxt 内置（NuxtLink、NuxtPage 等会保留自动）
// 注意：仅识别开标签（关闭标签也按开标签转化）
function extractComponentTagsFromTemplate(template: string): Set<string> {
  const tags = new Set<string>()
  const re = /<([A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*-[a-z0-9-]+)(?:\s|\/?>|\n)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const raw = m[1]!
    const pascal = raw.includes('-')
      ? raw.split('-').map(s => s[0]!.toUpperCase() + s.slice(1)).join('')
      : raw
    tags.add(pascal)
  }
  return tags
}

// 从模板表达式中提取 identifier 引用（如 {{ formatByteSize(x) }} / :class="getFileIcon(...)" / v-if="canPreview"）
// 策略：去掉所有 HTML tag，只保留属性值和 mustache 内容；从中提取标识符；排除前面是 . 的属性访问
function extractTemplateIdentifiers(template: string): Set<string> {
  const ids = new Set<string>()
  // 收集表达式片段：mustache + 属性值 + v-* / : / @ 指令
  const expressions: string[] = []
  // {{ ... }}
  for (const m of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) expressions.push(m[1]!)
  // :foo="..." / v-foo="..." / @foo="..."
  for (const m of template.matchAll(/(?::|v-|@)[\w.-]+\s*=\s*"([^"]*)"/g)) expressions.push(m[1]!)
  for (const m of template.matchAll(/(?::|v-|@)[\w.-]+\s*=\s*'([^']*)'/g)) expressions.push(m[1]!)

  for (const expr of expressions) {
    // 跳过字符串字面量
    const stripped = expr
      .replace(/'(?:\\.|[^'\\])*'/g, '""')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/`(?:\\.|[^`\\])*`/g, '""')
    // 提取所有 identifier；排除前面是 . 的（属性访问）
    const re = /(\.\s*)?\b([A-Za-z_][A-Za-z0-9_]*)\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) !== null) {
      if (m[1]) continue // 跳过属性访问
      ids.add(m[2]!)
    }
  }
  return ids
}

// ========== 计算需要补的 import ==========

function buildFrontendMap(): Record<string, SymbolEntry> {
  const merged: Record<string, SymbolEntry> = { ...symbolMap.frontend }
  // 兜底：跨层用的 server export type（如 SafeUserInfo / CaseWithRelations）也允许前端 import
  for (const [name, entry] of Object.entries(symbolMap.nitro)) {
    if (merged[name]) continue
    if (!entry.isType) continue
    if (!entry.from.startsWith('~~/server/')) continue
    merged[name] = entry
  }
  return merged
}

function diffNeededScript(used: Set<string>, usedAll: Set<string>, imported: Set<string>, importedTypeOnly: Set<string>): SymbolEntry[] {
  const map = buildFrontendMap()
  const localTypeBindings = new Set<string>()
  for (const x of importedTypeOnly) {
    if (x.startsWith('__TYPE_BOUND__:')) localTypeBindings.add(x.slice('__TYPE_BOUND__:'.length))
  }
  const candidates = new Set<string>()
  for (const n of used) candidates.add(n)
  for (const n of usedAll) {
    const entry = map[n]
    if (entry?.isType) candidates.add(n)
  }
  const needed: SymbolEntry[] = []
  for (const name of candidates) {
    if (imported.has(name)) continue
    const entry = map[name]
    if (!entry) continue
    if (!entry.needsImport) continue
    if (localTypeBindings.has(name)) continue
    needed.push(entry)
  }
  return needed
}

function diffNeededComponents(tags: Set<string>, imported: Set<string>): SymbolEntry[] {
  const map = symbolMap.component
  const needed: SymbolEntry[] = []
  for (const name of tags) {
    if (imported.has(name)) continue
    const entry = map[name]
    if (!entry) continue
    if (!entry.needsImport) continue
    needed.push(entry)
  }
  return needed
}

// ========== import 语句生成（同 migrate-ts.ts） ==========

function buildImportStatements(needed: SymbolEntry[]): string {
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
      if (defaults.length > 1) {
        for (const d of defaults.slice(1)) lines.push(`import ${d.name} from '${from}'`)
      }
    }
  }
  return lines.join('\n')
}

// ========== Vue SFC 处理 ==========

interface MigrateResult {
  changed: boolean
  added: number
  message?: string
}

function migrateVue(absPath: string, dryRun: boolean): MigrateResult {
  const source = readFileSync(absPath, 'utf-8')
  const { descriptor, errors } = parse(source, { filename: absPath })
  if (errors.length) {
    throw new Error('SFC parse errors: ' + errors.map(e => e.message).join('; '))
  }

  // 获取 script 块（优先 setup，再普通 script）
  const scriptBlock = descriptor.scriptSetup || descriptor.script
  if (!scriptBlock) return { changed: false, added: 0 } // 无 script 块跳过

  // 解析 script 内容
  const scriptContent = scriptBlock.content
  const { used: scriptUsed, usedAll: scriptUsedAll, imported, importedTypeOnly, localValueBindings, localTypeBindings } = collectIdentifiers(scriptContent)

  // 屏蔽集合：本地 value/type binding + 已 import 名（不能再补）
  const scriptLocalAll = new Set<string>([...localValueBindings, ...localTypeBindings, ...imported])

  // 模板中的组件标签 + 表达式 identifier
  const templateTags = descriptor.template ? extractComponentTagsFromTemplate(descriptor.template.content) : new Set<string>()
  const templateIds = descriptor.template ? extractTemplateIdentifiers(descriptor.template.content) : new Set<string>()

  const mergedUsed = new Set<string>(scriptUsed)
  const mergedUsedAll = new Set<string>(scriptUsedAll)
  for (const n of templateIds) {
    if (scriptLocalAll.has(n)) continue
    mergedUsed.add(n)
    mergedUsedAll.add(n)
  }

  // 计算 needed
  const neededFromScript = diffNeededScript(mergedUsed, mergedUsedAll, imported, importedTypeOnly)
  const neededComponents = diffNeededComponents(templateTags, imported)

  // 合并去重
  const all: SymbolEntry[] = []
  const seen = new Set<string>()
  for (const e of [...neededFromScript, ...neededComponents]) {
    const k = `${e.name}::${e.from}::${e.isDefault}`
    if (seen.has(k)) continue
    seen.add(k)
    all.push(e)
  }
  if (all.length === 0) return { changed: false, added: 0 }

  const importBlock = buildImportStatements(all)

  // 找到 scriptBlock 内最后一个 import 语句的结束位置（在 script 块内的相对位置）
  const sourceFile = ts.createSourceFile('x.ts', scriptContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let lastImportEnd = -1
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt)) {
      lastImportEnd = stmt.getEnd()
    } else {
      break
    }
  }
  let newScriptContent: string
  if (lastImportEnd >= 0) {
    newScriptContent = scriptContent.slice(0, lastImportEnd) + '\n' + importBlock + scriptContent.slice(lastImportEnd)
  } else {
    // script 块以换行开头是常态，保留之
    newScriptContent = '\n' + importBlock + '\n' + scriptContent.replace(/^\n/, '')
  }

  // 把新的 script content 替换回 source（按 scriptBlock 在原文件的偏移）
  // scriptBlock.loc.start.offset / end.offset 是 <script> 开标签内容区起止
  const startOffset = scriptBlock.loc.start.offset
  const endOffset = scriptBlock.loc.end.offset
  const newSource = source.slice(0, startOffset) + newScriptContent + source.slice(endOffset)

  if (newSource === source) return { changed: false, added: 0 }
  if (!dryRun) writeFileSync(absPath, newSource, 'utf-8')
  return { changed: true, added: all.length, message: importBlock }
}

// ========== CLI ==========

function listFiles(target: string, exts: Set<string>): string[] {
  const out: string[] = []
  const stat = statSync(target)
  if (stat.isFile()) {
    if (exts.has(target.slice(target.lastIndexOf('.')))) out.push(target)
    return out
  }
  for (const ent of readdirSync(target, { withFileTypes: true })) {
    if (ent.isDirectory() && ent.name.startsWith('.')) continue
    if (ent.name === 'node_modules' || ent.name === 'dist') continue
    const p = join(target, ent.name)
    if (ent.isDirectory()) out.push(...listFiles(p, exts))
    else if (exts.has(ent.name.slice(ent.name.lastIndexOf('.')))) out.push(p)
  }
  return out
}

function main() {
  const args = process.argv.slice(2)
  const target = args.find(a => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')
  const verbose = args.includes('--verbose')
  if (!target) {
    console.error('Usage: tsx migrate-vue.ts <file-or-dir> [--dry-run] [--verbose]')
    process.exit(1)
  }
  const absTarget = resolve(ROOT, target)
  const files = listFiles(absTarget, new Set(['.vue']))
  let totalChanged = 0
  let totalAdded = 0
  for (const f of files) {
    try {
      const r = migrateVue(f, dryRun)
      if (r.changed) {
        totalChanged++
        totalAdded += r.added
        console.log(`✓ ${relative(ROOT, f)}: +${r.added} imports`)
        if (verbose && r.message) console.log(r.message.split('\n').map(l => '    ' + l).join('\n'))
      }
    } catch (e: any) {
      console.error(`✗ ${relative(ROOT, f)}: ${e.message}`)
    }
  }
  console.log(`\nDone: ${totalChanged}/${files.length} files changed, ${totalAdded} imports added${dryRun ? ' (dry-run)' : ''}`)
}

main()
