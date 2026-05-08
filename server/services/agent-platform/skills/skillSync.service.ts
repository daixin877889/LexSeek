/**
 * Skill 同步服务
 *
 * 负责扫描 .deepagents/skills/* 子目录的 SKILL.md，解析 frontmatter，
 * 通过 DAO upsert 入库。文件系统是真理来源，数据库是注册册 + 元数据缓存。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5
 */

import { readdir, readFile, stat, access } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import matter from 'gray-matter'

import {
    buildUpsertSkillOp,
    listAllSkillsDAO,
    markSkillsDisabledByNamesDAO,
    updateSkillCustomTitleDAO,
    updateSkillStatusDAO,
    listEnabledSkillLabelsDAO,
    type UpsertSkillInput,
} from './skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource, SKILLS_FS_ROOT, SkillStatus, type SkillFrontmatter } from '#shared/types/skill'
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
    //    顺带维护"盘上是目录的 entry"集合，第 5 步用作停用判定基准（避免再次 stat）。
    const dirEntries = new Set<string>()
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
        dirEntries.add(entry)

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

    // 5. 清理盘上已删除但数据库还在的（限 source=filesystem）
    //    判定基准是"盘上目录是否仍在"——SKILL.md/frontmatter 临时损坏 / bulk upsert tx 失败时
    //    目录仍在盘上，不应被误标 disabled。目录名 === skill name 是入库不变量（fm.name === entry）。
    const toDisable = Array.from(existingFilesystemSkills).filter(name => !dirEntries.has(name))
    if (toDisable.length > 0) {
        await markSkillsDisabledByNamesDAO(toDisable)
        result.disabled.push(...toDisable)
    }

    // 6. skills 变化可能影响节点关联，全量清 NodeConfig 缓存和 backend 缓存
    invalidateNodeConfigCache()
    invalidateBackendCache()

    return result
}

/**
 * 编辑 skill 的中文名（后台覆盖层）。
 *
 * @param name skill 主键
 * @param raw 用户输入；trim 后空字符串等价 null（恢复代码默认）
 * @throws Prisma P2025 当 name 不存在
 *
 * 注：不调用 invalidateNodeConfigCache / invalidateBackendCache。
 * customTitle 仅服务于"用户端 /skills/labels 映射表 + 后台显示"，
 * 与 NodeConfig（节点+模型+提示词）和 deepagents FilesystemBackend（按 skill 父目录加载 SKILL.md）
 * 完全无关——这两个缓存内容里都不含 customTitle 字段。
 */
export async function updateSkillCustomTitleService(name: string, raw: string | null) {
    const customTitle = raw?.trim() || null
    return await updateSkillCustomTitleDAO(name, customTitle)
}

/**
 * 列出启用 skill 的 name → label 映射（直接转发 DAO）。
 */
export async function listEnabledSkillLabelsService() {
    return listEnabledSkillLabelsDAO()
}

/**
 * 错误：skill 的文件系统目录或 SKILL.md 已不存在，无法启用。
 * handler 捕获后返回 400 + 中文 message。
 */
export class SkillFsMissingError extends Error {
    constructor(public readonly skillName: string, public readonly missingPath: string) {
        super(`skill "${skillName}" 的文件已不在 ${missingPath}，无法启用。请确认 .deepagents/skills/<name> 目录与 SKILL.md 完整后再试。`)
        this.name = 'SkillFsMissingError'
    }
}

/**
 * 启用/禁用 skill。启用前校验 path 对应目录 + SKILL.md 存在。
 * 禁用永远允许（哪怕文件已被删，仍要支持显式停用）。
 *
 * skill.path 入库时一般是相对项目根的相对路径（如 .deepagents/skills/foo），
 * 但测试 / 上传 skill 等场景也允许绝对路径，这里 isAbsolute 兜底。
 *
 * @throws Prisma P2025 当 skill name 不存在
 * @throws SkillFsMissingError 启用时目录或 SKILL.md 缺失
 */
export async function setSkillStatusService(name: string, status: SkillStatus) {
    if (status === SkillStatus.ENABLED) {
        const skill = await prisma.skills.findUnique({
            where: { name },
            select: { path: true },
        })
        if (!skill) {
            const err: any = new Error('Skill not found')
            err.code = 'P2025'
            throw err
        }
        const absDir = isAbsolute(skill.path) ? skill.path : resolve(process.cwd(), skill.path)
        let dirOk = false
        try {
            const st = await stat(absDir)
            dirOk = st.isDirectory()
        } catch {
            // ENOENT 等：目录不存在
        }
        if (!dirOk) {
            throw new SkillFsMissingError(name, skill.path)
        }
        try {
            await access(resolve(absDir, 'SKILL.md'))
        } catch {
            throw new SkillFsMissingError(name, `${skill.path}/SKILL.md`)
        }
    }
    const updated = await updateSkillStatusDAO(name, status)
    invalidateNodeConfigCache()
    invalidateBackendCache()
    return updated
}
