/**
 * workflow/middleware 统一入口
 *
 * 通用中间件已迁到 agent-platform/middleware/，此处 re-export 保持兼容。
 * 业务私有中间件（caseProcessMaterial 等）仍在本目录。
 *
 * 注：caseMaterialContextMiddleware 已于 2026-04-30 删除——
 * caseMain 切换到 caseContextMiddleware（5 段式标准管线），
 * documentMainAgent 已直接调 buildSystemPromptForAgent 注入 5 段式 SystemMessage，无需独立中间件。
 */
// 通用中间件（主体在 agent-platform，此处 re-export）
export * from '~~/server/services/agent-platform/middleware'
// 业务私有中间件（留在 workflow/middleware，待后续 vertical 阶段迁移）
export * from './caseProcessMaterial.middleware'
export * from './analysisResultPersistence.middleware'
export { reviewResultPersistenceMiddleware } from './reviewResultPersistence.middleware'
