# 部署备注

本文件登记需要在生产/预发部署前手工注意的事项。按日期倒序排列，执行完的条目保留作为历史档案。

> 常规数据库迁移**不**出现在本文件——它们通过 `bun run prisma:deploy`（`prisma migrate deploy`）自动应用，见 [`.claude/rules/database.md`](../.claude/rules/database.md)。本文件只登记"自动部署不足以完全处理"的特殊情形。

---

## 2026-04-21 · M6.1 合同审查 summary 字段 TEXT → JSONB

**触发变更**：branch `feature/m6-1-contract-review` 合并到主干时

**迁移文件**：`prisma/migrations/20260421143222_summary_string_to_json/migration.sql`（已登记为正式迁移）

**部署流程**（无需额外手工操作）：

```bash
# 生产 / 预发正常走
bun run prisma:deploy
```

迁移文件内含 `USING jsonb_build_object(...)` 子句，历史 `summary` 字符串会**原地**包装成 `{ highlights: null, overall: <old_string> }`，数据不会丢失。

**本分支开发期间的特殊情形**（已处理，仅作记录）：

- Task 1.3 最初没走 `prisma migrate dev` 正式流程，而是手工用 `docker exec psql` 对测试库 + 开发库先跑了 SQL（此时两库 `summary` 列已是 JSONB），之后才把同样内容搬进 `prisma/migrations/` 作为正式迁移，并用 `prisma migrate resolve --applied 20260421143222_summary_string_to_json` 把两库 `_prisma_migrations` 表里补登了已应用记录
- 生产 / 预发不需要做 resolve —— 它们从未手工跑过 SQL，`prisma migrate deploy` 会正常执行本迁移的 SQL
- 这次属于"Prisma 默认 DROP+ADD 会丢数据，需要手工加 USING 子句"的**规则 3 例外**。后续变更请严格走 `.claude/rules/database.md` 的正规流程
