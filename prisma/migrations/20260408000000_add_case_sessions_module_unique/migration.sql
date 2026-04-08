-- 添加 type=3 caseSessions 的 (caseId, type, moduleName) 唯一约束
-- 通过部分函数索引实现：仅对 type=3 且未删除的记录生效
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_sessions_module ON case_sessions (case_id, type, (metadata->>'moduleName')) WHERE type = 3 AND deleted_at IS NULL;
