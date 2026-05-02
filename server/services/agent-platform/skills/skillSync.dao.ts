/**
 * Skill 同步 DAO
 *
 * 负责 skills + node_skills 表的数据访问。
 * 业务逻辑（扫描文件系统、解析 frontmatter）在 skillSync.service.ts。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5
 */

import { SkillSource, SkillStatus } from '#shared/types/skill'

/** upsertSkillDAO 入参 */
export interface UpsertSkillInput {
    name: string
    path: string
    source: SkillSource
    title?: string | null
    description?: string | null
    version?: string | null
}

/**
 * 构造 upsert skill 的未执行 PrismaPromise，供调用方塞进 prisma.$transaction([...])。
 * 启动期 scanAndSyncSkillsService 用此把 N 条 upsert 合并为 1 次事务批量提交。
 */
export function buildUpsertSkillOp(input: UpsertSkillInput) {
    const now = new Date()
    return prisma.skills.upsert({
        where: { name: input.name },
        create: {
            name: input.name,
            path: input.path,
            source: input.source,
            title: input.title ?? null,
            description: input.description ?? null,
            version: input.version ?? null,
            status: SkillStatus.ENABLED,
            syncedAt: now,
        },
        update: {
            path: input.path,
            source: input.source,
            title: input.title ?? null,
            description: input.description ?? null,
            version: input.version ?? null,
            // status 不写：保留管理员手动设置（启用开关 bug fix）
            // customTitle 不写：后台编辑专属，扫描永不覆盖
            syncedAt: now,
        },
    })
}

/**
 * upsert 单条 skill 记录（即时执行版本）。
 * 同名记录已存在则更新元数据 + 更新 syncedAt；status 与 customTitle 保留管理员手动设置（不被扫描覆盖）。
 */
export async function upsertSkillDAO(input: UpsertSkillInput) {
    return buildUpsertSkillOp(input)
}

/**
 * 列出所有 skill 记录（含 status=0），按 name 排序。
 * 默认包含已停用的，因为后台列表页要显示停用项。
 */
export async function listAllSkillsDAO() {
    return prisma.skills.findMany({
        orderBy: { name: 'asc' },
    })
}

/**
 * 把名字在 names 中的所有 skills 置为 DISABLED。
 * 用于扫描时清理"文件系统已删除但数据库还在"的记录。
 *
 * 仅作用于 source=filesystem 的记录（uploaded 不参与文件系统扫描清理）。
 *
 * @returns 受影响的行数
 */
export async function markSkillsDisabledByNamesDAO(names: string[]): Promise<number> {
    if (names.length === 0) return 0
    const result = await prisma.skills.updateMany({
        where: { name: { in: names }, source: SkillSource.FILESYSTEM },
        data: { status: SkillStatus.DISABLED },
    })
    return result.count
}

/**
 * 返回某节点关联的所有 ENABLED skills（按 priority 升序）。
 * 阶段 2 起被 defineDomainAgent 工厂调用，用于动态构造 skillsMiddleware。
 */
export async function listSkillsByNodeIdDAO(nodeId: number) {
    const rows = await prisma.node_skills.findMany({
        where: {
            nodeId,
            skill: { status: SkillStatus.ENABLED },
        },
        include: { skill: true },
        orderBy: { priority: 'asc' },
    })
    return rows.map(r => ({
        name: r.skill.name,
        path: r.skill.path,
        title: r.skill.title,
        description: r.skill.description,
        priority: r.priority,
    }))
}

/**
 * 更新单条 skill 的启停状态。
 * name 不存在时抛 Prisma P2025 错误（调用方处理 404）。
 */
export async function updateSkillStatusDAO(name: string, status: SkillStatus) {
    return prisma.skills.update({
        where: { name },
        data: { status },
    })
}

/** 删除单条 skill（仅测试用，业务侧无 admin 删除接口）*/
export async function deleteSkillDAO(name: string) {
    await prisma.skills.delete({ where: { name } })
}
