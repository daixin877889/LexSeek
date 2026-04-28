/**
 * Skill 同步独立脚本（CI / 一次性手动用）
 *
 * 业务用 server/services/agent-platform/skills/skillSync.service.ts（用 prisma + nuxt alias），
 * 但 CI 不起 nitro server，alias 解析不了。本脚本用纯 pg + fs + gray-matter 复制最小同步逻辑：
 * 扫 .deepagents/skills/<name>/SKILL.md → 解析 frontmatter → upsert skills 表。
 *
 * 用法：
 *   DATABASE_URL='...' npx tsx server/scripts/syncSkillsForCI.ts
 *
 * 与 plugins/skill-sync.ts 行为对齐：仅 upsert，不停用旧 skill（CI 干净库无旧数据）。
 */
import { readdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import matter from 'gray-matter'
import pg from 'pg'

const SKILLS_FS_ROOT = '.deepagents/skills'

interface SkillRecord {
    name: string
    path: string
    title: string | null
    description: string | null
    version: string | null
}

async function scanSkills(rootDir: string): Promise<SkillRecord[]> {
    const skillsRoot = resolve(rootDir, SKILLS_FS_ROOT)
    const entries = await readdir(skillsRoot, { withFileTypes: true })
    const records: SkillRecord[] = []

    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const name = entry.name
        const skillMdPath = join(skillsRoot, name, 'SKILL.md')
        try {
            const raw = await readFile(skillMdPath, 'utf-8')
            const { data } = matter(raw)
            records.push({
                name: data.name || name,
                path: `${SKILLS_FS_ROOT}/${name}`,
                title: data.title || null,
                description: data.description || null,
                version: data.version || null,
            })
        } catch (err) {
            console.warn(`⚠️  跳过 ${name}: 读取/解析 SKILL.md 失败 - ${(err as Error).message}`)
        }
    }
    return records
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL 环境变量未设置')
        process.exit(1)
    }

    const rootDir = process.cwd()
    console.log(`🔍 扫描 ${rootDir}/${SKILLS_FS_ROOT}/`)

    const records = await scanSkills(rootDir)
    if (records.length === 0) {
        console.warn('⚠️  未扫到任何 skill')
        return
    }
    console.log(`📦 扫到 ${records.length} 个 skill: ${records.map(r => r.name).join(', ')}`)

    const pool = new pg.Pool({ connectionString: databaseUrl })
    try {
        for (const r of records) {
            await pool.query(
                `INSERT INTO skills (name, path, source, title, description, version, status, synced_at, created_at, updated_at)
                 VALUES ($1, $2, 'filesystem', $3, $4, $5, 1, NOW(), NOW(), NOW())
                 ON CONFLICT (name) DO UPDATE SET
                   path = EXCLUDED.path,
                   title = EXCLUDED.title,
                   description = EXCLUDED.description,
                   version = EXCLUDED.version,
                   synced_at = NOW(),
                   updated_at = NOW()`,
                [r.name, r.path, r.title, r.description, r.version],
            )
        }
        console.log(`✅ ${records.length} 个 skill 已同步入库`)
    } catch (err) {
        console.error('❌ Skill 同步失败:', err)
        process.exit(1)
    } finally {
        await pool.end()
    }
}

main()
