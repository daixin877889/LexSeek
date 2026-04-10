-- 删除 type=3 caseSessions 的 (caseId, type, moduleName) 唯一约束
-- 模块对话改为多 session 模式（与小索一致），允许同一模块创建多个独立对话
-- 并发防重改由应用层的 Redis dedupeKey 实现（session_dedupe:* 短时窗口锁）
DROP INDEX IF EXISTS uq_case_sessions_module;
