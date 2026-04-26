// 删除所有 `import Xxx from '~/components/ai-elements/...'` 形式的冗余 import 行
// 因为 ai-elements 已经通过 components.dirs 自动注册，无需显式 import
//
// 用法: bunx tsx scripts/migrate-explicit-imports/remove-redundant-ai-elements-imports.ts [--dry-run]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '../..')

// 匹配 ai-elements 来源的 import 行
// import Foo from '~/components/ai-elements/.../Foo.vue'
// import Foo from '~~/app/components/ai-elements/...'
// import Foo from '@repo/shadcn-vue/...' （shadcn 有别名，但 ai-elements 不会用到 shadcn）
const RE = /^\s*import\s+\w+\s+from\s+['"](?:~\/components\/ai-elements\/|~~\/app\/components\/ai-elements\/|\.\.\/[^'"]*\/components\/ai-elements\/)[^'"]+['"]\s*;?\s*$/

function processSource(source: string): { newSource: string; removed: number } {
  const lines = source.split('\n')
  const out: string[] = []
  let removed = 0
  for (const line of lines) {
    if (RE.test(line)) {
      removed++
      continue
    }
    out.push(line)
  }
  return { newSource: out.join('\n'), removed }
}

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
  const targets = ['app', 'server', 'shared', 'tests']
  const exts = new Set(['.ts', '.tsx', '.vue'])
  const files: string[] = []
  for (const t of targets) {
    const abs = resolve(ROOT, t)
    try { files.push(...listFiles(abs, exts)) } catch {}
  }
  let totalChanged = 0
  let totalRemoved = 0
  for (const f of files) {
    try {
      const src = readFileSync(f, 'utf-8')
      const { newSource, removed } = processSource(src)
      if (removed > 0) {
        totalChanged++
        totalRemoved += removed
        if (!dryRun) writeFileSync(f, newSource, 'utf-8')
        console.log(`✓ ${relative(ROOT, f)}: -${removed} import lines`)
      }
    } catch (e: any) {
      console.error(`✗ ${relative(ROOT, f)}: ${e.message}`)
    }
  }
  console.log(`\nDone: ${totalChanged}/${files.length} files changed, ${totalRemoved} import lines removed${dryRun ? ' (dry-run)' : ''}`)
}

main()
