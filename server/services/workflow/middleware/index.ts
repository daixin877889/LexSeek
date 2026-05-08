/**
 * workflow/middleware 统一入口
 *
 * 通用中间件已迁到 agent-platform/middleware/，此处 re-export 保持兼容。
 * 业务私有中间件（caseProcessMaterial 等）仍在本目录。
 *
 * 注：caseMaterialContextMiddleware 已于 2026-04-30 删除——
 * caseMain / caseModule / documentMain 三个 Agent 已于 2026-05-05 统一切换到
 * caseContextSyncMiddleware（HumanMessage 注入 + 双轨 metadata + splice 模式），
 * 不再走 SystemMessage 拼装。详见 spec §4.2 与本仓库 plan 2026-05-05-agent-context-sync-unification.md。
 */
// 通用中间件（主体在 agent-platform，此处 re-export）
export * from '~~/server/services/agent-platform/middleware'
// 业务私有中间件（留在 workflow/middleware，待后续 vertical 阶段迁移）
export * from './caseProcessMaterial.middleware'
export * from './analysisResultPersistence.middleware'
export { reviewResultPersistenceMiddleware } from './reviewResultPersistence.middleware'
