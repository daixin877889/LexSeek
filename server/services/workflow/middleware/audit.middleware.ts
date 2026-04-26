/**
 * Re-export shim，向后兼容旧 import 路径。
 * 阶段 2 迁移后，主体在 agent-platform/middleware/audit.middleware.ts。
 * 此 shim 保留以兼容旧 import 路径，后续清理阶段可删除。
 */
export * from '~~/server/services/agent-platform/middleware/audit.middleware'
