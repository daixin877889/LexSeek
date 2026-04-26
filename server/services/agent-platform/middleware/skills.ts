/**
 * Skills 中间件包装：按节点动态构造。
 *
 * 阶段 2 起 defineDomainAgent 工厂调用 buildSkillsMiddlewareForNode(nodeId)，
 * 若节点未关联任何 skill 返回 null（工厂判断 null 跳过挂载）。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5.4
 */

import { createSkillsMiddleware } from 'deepagents'
import type { AgentMiddleware } from 'langchain'
import { listSkillsByNodeIdDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { getFilesystemBackend } from '~~/server/services/agent-platform/skills/filesystemBackendCache'

/**
 * 按节点关联的 skills 构造 skillsMiddleware。
 * 若无关联 skill 返回 null（工厂判 null 跳过挂载和 skill 工具注入）。
 */
export async function buildSkillsMiddlewareForNode(
    nodeId: number,
): Promise<AgentMiddleware | null> {
    const skills = await listSkillsByNodeIdDAO(nodeId)
    if (skills.length === 0) return null
    const sources = skills.map(s => s.path)
    const backend = getFilesystemBackend(sources)
    return createSkillsMiddleware({ backend, sources })
}
