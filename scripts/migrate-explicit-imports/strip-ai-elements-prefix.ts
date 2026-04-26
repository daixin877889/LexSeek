// 把项目中所有 `AiElementsXxx` 标识符 + `<ai-elements-xxx>` 标签替换成 `Xxx` / `<xxx>`
// 仅替换那些在 ai-elements/ 文件名白名单内的标识符，避免误伤其他同名变量
//
// 用法: bunx tsx scripts/migrate-explicit-imports/strip-ai-elements-prefix.ts [--dry-run]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../..')

// 1. 收集 ai-elements 下所有 .vue 文件名（无扩展名）作为新组件名集合
function collectAiElementNames(): Set<string> {
  const dir = resolve(ROOT, 'app/components/ai-elements')
  const names = new Set<string>()
  function walk(d: string) {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.vue')) names.add(basename(ent.name, '.vue'))
    }
  }
  walk(dir)
  return names
}

const newNames = collectAiElementNames()
// 旧名 → 新名映射：AiElements + 文件名 → 文件名
const oldToNew = new Map<string, string>()
for (const n of newNames) oldToNew.set('AiElements' + n, n)

console.log(`ai-elements 组件总数: ${newNames.size}`)
console.log(`oldName → newName 映射: ${oldToNew.size}`)

// PascalCase → kebab-case
function pascalToKebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/^-/, '').toLowerCase()
}

const oldKebabToNewKebab = new Map<string, string>()
for (const [oldP, newP] of oldToNew) {
  oldKebabToNewKebab.set(pascalToKebab(oldP), pascalToKebab(newP))
}

// 2. 替换函数
function processSource(source: string): { newSource: string; changed: boolean; replaceCount: number } {
  let s = source
  let count = 0

  // 先处理双前缀的特殊 case：AiElementsXxxXxx... → 去掉重复的 Xxx 段
  // 例如 AiElementsConfirmationConfirmationRequest → ConfirmationRequest
  // 仅当去重后能在白名单里找到时才替换
  s = s.replace(/\bAiElements([A-Z][A-Za-z0-9]*)\1([A-Za-z0-9]*)\b/g, (m, dup, rest) => {
    const candidate = dup + rest
    if (newNames.has(candidate)) {
      count++
      return candidate
    }
    return m
  })

  // PascalCase 标识符替换：\bAiElementsXxx\b → Xxx（仅当 Xxx 在白名单中）
  s = s.replace(/\bAiElements([A-Z][A-Za-z0-9]*)\b/g, (m, suffix) => {
    if (oldToNew.has('AiElements' + suffix)) {
      count++
      return suffix
    }
    return m
  })

  // kebab-case template 标签替换：<ai-elements-xxx → <xxx
  for (const [oldKebab, newKebab] of oldKebabToNewKebab) {
    // 严格匹配（开标签和闭标签）
    const reOpen = new RegExp(`<${oldKebab}(\\s|/?>|\\n|>)`, 'g')
    const reClose = new RegExp(`</${oldKebab}\\s*>`, 'g')
    let beforeLen = s.length
    s = s.replace(reOpen, (_m, after) => `<${newKebab}${after}`)
    s = s.replace(reClose, `</${newKebab}>`)
    if (s.length !== beforeLen) count++ // 粗略计数
  }

  // 文档里的双前缀 kebab-case：<ai-elements-confirmation-confirmation-...> → <confirmation-...>
  // 通用规则：<ai-elements-{seg}-{seg}-{rest}> 中 {seg} 重复时压缩掉前缀
  s = s.replace(/<ai-elements-([a-z0-9]+)-\1((?:-[a-z0-9-]+)?)([\s/>])/g, (m, dup, rest, after) => {
    const pascalCheck = dup.charAt(0).toUpperCase() + dup.slice(1) +
      rest.split('-').filter(Boolean).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    if (newNames.has(pascalCheck)) {
      count++
      return `<${dup}${rest}${after}`
    }
    return m
  })
  s = s.replace(/<\/ai-elements-([a-z0-9]+)-\1((?:-[a-z0-9-]+)?)>/g, (m, dup, rest) => {
    const pascalCheck = dup.charAt(0).toUpperCase() + dup.slice(1) +
      rest.split('-').filter(Boolean).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    if (newNames.has(pascalCheck)) {
      count++
      return `</${dup}${rest}>`
    }
    return m
  })

  return { newSource: s, changed: s !== source, replaceCount: count }
}

// 3. 文件遍历
function listFiles(target: string, exts: Set<string>): string[] {
  const out: string[] = []
  const stat = statSync(target)
  if (stat.isFile()) {
    if (exts.has(target.slice(target.lastIndexOf('.')))) out.push(target)
    return out
  }
  for (const ent of readdirSync(target, { withFileTypes: true })) {
    if (ent.isDirectory() && ent.name.startsWith('.')) continue
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.output') continue
    const p = join(target, ent.name)
    if (ent.isDirectory()) out.push(...listFiles(p, exts))
    else if (exts.has(ent.name.slice(ent.name.lastIndexOf('.')))) out.push(p)
  }
  return out
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const targets = ['app', 'server', 'shared', 'tests', 'docs']
  const exts = new Set(['.ts', '.tsx', '.vue', '.md'])
  const files: string[] = []
  for (const t of targets) {
    const abs = resolve(ROOT, t)
    try { files.push(...listFiles(abs, exts)) } catch {}
  }
  let totalChanged = 0
  let totalReplaces = 0
  for (const f of files) {
    try {
      const src = readFileSync(f, 'utf-8')
      const { newSource, changed, replaceCount } = processSource(src)
      if (changed) {
        totalChanged++
        totalReplaces += replaceCount
        if (!dryRun) writeFileSync(f, newSource, 'utf-8')
        console.log(`✓ ${relative(ROOT, f)}: ${replaceCount} replacements`)
      }
    } catch (e: any) {
      console.error(`✗ ${relative(ROOT, f)}: ${e.message}`)
    }
  }
  console.log(`\nDone: ${totalChanged}/${files.length} files changed, ${totalReplaces} replacements${dryRun ? ' (dry-run)' : ''}`)
}

main()
