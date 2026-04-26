/**
 * Agent Platform 类型层统一出口
 *
 * 阶段 2 引入：所有业务 vertical 与 agent-platform 内部模块通过本文件
 * 引用平台层类型，避免直接散链 #shared/types/* 的零散 import。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.1
 */

// 路由 + 事件 + interrupt 枚举（阶段 1 已建）
export {
    SessionScope,
    SessionType,
    SSECustomEventType,
    InterruptType,
} from '#shared/types/agentEvent'

export type {
    SSECustomEventMap,
    SubAgentTokenPayload,
    SubAgentToolStartPayload,
    SubAgentToolEndPayload,
    SubAgentStatusPayload,
    AnalysisResultSavedPayload,
    DraftSavedPayload,
    ContractReviewSavedPayload,
    ContractStagePayload,
    ContractRiskPayload,
    ContractProgressPayload,
    ChildAgentInvokedPayload,
} from '#shared/types/agentEvent'

// Skills（阶段 1 已建）
export { SkillSource, SkillStatus, SKILLS_FS_ROOT } from '#shared/types/skill'
export type { SkillFrontmatter } from '#shared/types/skill'

// Agent Registry（阶段 1 已建）
export { AgentRegistry, agentRegistry } from './registry/agentRegistry'
export type {
    AgentRunner,
    AgentRunnerContext,
    AgentRegistryEntry,
    SessionRouteKey,
} from './registry/types'
