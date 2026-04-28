/**
 * Skills 中间件包装：按节点动态构造。
 *
 * 阶段 2 起 defineDomainAgent 工厂调用 buildSkillsMiddlewareForNode(nodeId)，
 * 若节点未关联任何 skill 返回 null（工厂判断 null 跳过挂载）。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5.4
 */

import { dirname } from 'node:path'
import { createSkillsMiddleware } from 'deepagents'
import type { AgentMiddleware } from 'langchain'
import { listSkillsByNodeIdDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { getFilesystemBackend } from '~~/server/services/agent-platform/skills/filesystemBackendCache'

/**
 * 按节点关联的 skills 构造 skillsMiddleware。
 * 若无关联 skill 返回 null（工厂判 null 跳过挂载和 skill 工具注入）。
 *
 * 关键契约：deepagents 的 createSkillsMiddleware 期望 sources 是
 * "包含多个 skill 子目录的父目录"（如 `.deepagents/skills`），它会
 * `ls(source)` 列出子目录，再读每个子目录下的 SKILL.md。
 *
 * skills 表 path 字段存的是 skill 自身目录（`.deepagents/skills/<name>`），
 * 这里取父目录的 unique 集合传给 deepagents，让其能正确加载。
 */
export async function buildSkillsMiddlewareForNode(
    nodeId: number,
): Promise<AgentMiddleware | null> {
    const skills = await listSkillsByNodeIdDAO(nodeId)
    if (skills.length === 0) return null
    const sources = [...new Set(skills.map(s => dirname(s.path)))]
    const backend = getFilesystemBackend(sources)
    return createSkillsMiddleware({ backend, sources })
}
