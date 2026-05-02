/**
 * Skill 同步服务
 *
 * 负责扫描 .deepagents/skills/* 子目录的 SKILL.md，解析 frontmatter，
 * 通过 DAO upsert 入库。文件系统是真理来源，数据库是注册册 + 元数据缓存。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import matter from 'gray-matter'

import {
    buildUpsertSkillOp,
    listAllSkillsDAO,
    markSkillsDisabledByNamesDAO,
    type UpsertSkillInput,
} from './skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource, SKILLS_FS_ROOT, type SkillFrontmatter } from '#shared/types/skill'
import { invalidateNodeConfigCache } from '~~/server/services/agent-platform/nodeConfig/loader'
import { invalidateBackendCache } from '~~/server/services/agent-platform/skills/filesystemBackendCache'

/** 扫描结果 */
export interface ScanResult {
    /** 实际扫描到的 skill 名（含 SKILL.md 解析成功的）*/
    scanned: string[]
    /** 新增的 skill 名 */
    added: string[]
    /** 更新的 skill 名（已有的）*/
    updated: string[]
    /** 二次扫描时发现文件系统已删除并被标记 disabled 的 skill 名 */
    disabled: string[]
    /** 解析失败的条目 */
    errors: Array<{ name: string; reason: string }>
}

/**
 * 解析 SKILL.md 的 frontmatter。
 * 必须含 name 字段；缺失或 frontmatter 完全没有则返回 null。
 */
export function parseSkillFrontmatterFromMarkdown(content: string): SkillFrontmatter | null {
    try {
        const parsed = matter(content)
        const data = parsed.data as Record<string, unknown>
        if (typeof data.name !== 'string' || data.name.trim() === '') return null
        return {
            name: String(data.name),
            title: typeof data.title === 'string' ? data.title : undefined,
            description: typeof data.description === 'string' ? data.description : undefined,
            license: typeof data.license === 'string' ? data.license : undefined,
            version: typeof data.version === 'string' ? data.version : (data.version != null ? String(data.version) : undefined),
        }
    } catch {
        return null
    }
}

/**
 * 扫描 skills 根目录并同步到数据库。
 *
 * @param skillsRoot 可选自定义根目录，仅供测试覆盖；生产路径走默认 SKILLS_FS_ROOT
 */
export async function scanAndSyncSkillsService(skillsRoot?: string): Promise<ScanResult> {
    const root = skillsRoot ?? resolve(process.cwd(), SKILLS_FS_ROOT)

    const result: ScanResult = {
        scanned: [],
        added: [],
        updated: [],
        disabled: [],
        errors: [],
    }

    // 1. 列子目录
    let entries: string[]
    try {
        entries = await readdir(root)
    } catch (err) {
        // ENOENT：根目录不存在 → 视为无 skill；其它错误抛出
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return result
        }
        throw err
    }

    // 2. 数据库现有 filesystem 来源的 skill 名集合（用于稍后清理）
    const existingFilesystemSkills = new Set(
        (await listAllSkillsDAO())
            .filter(s => s.source === SkillSource.FILESYSTEM)
            .map(s => s.name),
    )

    // 3. 第一遍：遍历每个子目录、读 SKILL.md、解析 frontmatter，收集合法 upsert 输入
    const validated: Array<{ input: UpsertSkillInput; isNew: boolean }> = []
    for (const entry of entries) {
        if (entry.startsWith('.')) continue
        const subDir = resolve(root, entry)
        try {
            const st = await stat(subDir)
            if (!st.isDirectory()) continue
        } catch {
            continue
        }

        const skillMdPath = resolve(subDir, 'SKILL.md')
        let mdContent: string
        try {
            mdContent = await readFile(skillMdPath, 'utf-8')
        } catch {
            // 没有 SKILL.md：跳过（不算错误，可能只是其他目录）
            continue
        }

        const fm = parseSkillFrontmatterFromMarkdown(mdContent)
        if (!fm) {
            result.errors.push({ name: entry, reason: 'SKILL.md frontmatter 无 name 或解析失败' })
            continue
        }

        // skill name 必须与目录名一致（防错配）
        if (fm.name !== entry) {
            result.errors.push({
                name: entry,
                reason: `SKILL.md frontmatter.name=${fm.name} 与目录名=${entry} 不一致`,
            })
            continue
        }

        validated.push({
            input: {
                name: fm.name,
                path: `${SKILLS_FS_ROOT}/${entry}`,
                source: SkillSource.FILESYSTEM,
                title: fm.title?.trim() || fm.name,
                description: fm.description ?? null,
                version: fm.version ?? null,
            },
            isNew: !existingFilesystemSkills.has(fm.name),
        })
    }

    // 4. 第二遍：所有合法条目走单次 $transaction 批量 upsert（避免启动期 N+1）
    if (validated.length > 0) {
        try {
            await prisma.$transaction(validated.map(v => buildUpsertSkillOp(v.input)))
            for (const v of validated) {
                result.scanned.push(v.input.name)
                if (v.isNew) result.added.push(v.input.name)
                else result.updated.push(v.input.name)
            }
        } catch (err) {
            // 整批事务失败属基础设施异常（DB 中断 / 约束冲突）；将所有候选条目标错以便诊断
            const reason = `bulk upsert tx 失败: ${(err as Error).message}`
            for (const v of validated) {
                result.errors.push({ name: v.input.name, reason })
            }
        }
    }

    // 5. 清理文件系统已删除但数据库还在的（限 source=filesystem）
    const stillSeen = new Set(result.scanned)
    const toDisable = Array.from(existingFilesystemSkills).filter(n => !stillSeen.has(n))
    if (toDisable.length > 0) {
        await markSkillsDisabledByNamesDAO(toDisable)
        result.disabled.push(...toDisable)
    }

    // 6. skills 变化可能影响节点关联，全量清 NodeConfig 缓存和 backend 缓存
    invalidateNodeConfigCache()
    invalidateBackendCache()

    return result
}
