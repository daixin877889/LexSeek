/**
 * 通用中间件统一入口
 *
 * 包含所有业务无关的通用中间件，可被任意 agent 装配。
 * 业务私有中间件（caseContext / caseProcessMaterial 等）保留在 server/agents/_shared/。
 */
export * from './types'
export * from './pointConsumption.middleware'
export * from './safetyTrim.middleware'
export { createScopeGuardMiddleware } from './scopeGuard.middleware'
export { createAuditMiddleware } from './audit.middleware'
export { createToolCallLimitMiddlewares } from './toolCallLimit.middleware'
export { createMessageIntegrityMiddleware } from './messageIntegrity.middleware'
export { userInjectionMiddleware } from './userInjection.middleware'
export { dateContextMiddleware, formatCurrentDate, formatCurrentDateWithWeekday } from './dateContext.middleware'
