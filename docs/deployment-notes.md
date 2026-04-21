# 部署备注

本文件登记需要在生产/预发部署前手工执行的一次性迁移或操作。按日期倒序排列，执行完的条目保留作为历史档案。

---

## 2026-04-21 · M6.1 合同审查 summary 字段 TEXT → JSONB

**触发变更**: branch `feature/m6-1-contract-review` 合并到主干时

**背景**: `contract_reviews.summary` 字段从 `TEXT`（M4/M5 存 Markdown 字符串）升级为 `JSONB`（存 `ContractOverview = { highlights, overall }`）。PostgreSQL 不支持 TEXT→JSONB 隐式转换，必须先手工跑数据迁移 SQL，再让 Prisma 同步 schema。

**部署步骤**（生产/预发各跑一次）：

```bash
# 1. 用 psql 对目标库跑一次 ALTER，把历史 string 就地包装为 { highlights: null, overall: <string> }
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE "contract_reviews"
    ALTER COLUMN "summary" TYPE JSONB
    USING CASE
        WHEN "summary" IS NULL THEN NULL
        ELSE jsonb_build_object('highlights', NULL, 'overall', "summary")
    END;
SQL

# 2. 应用发布：Prisma schema 已把 summary 定义为 Json?，不需要再 prisma:push（数据库已符合新 schema）
```

**验证**：

```sql
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'contract_reviews' AND column_name = 'summary';
-- 期望: summary | jsonb
```

**关联 commit**：完成本次迁移的 Prisma schema 改动在 M6.1 子期 1 Task 1.3 的 commit 中（参见 git log 上 "feat(contract): summary 字段从 String(Text) 升级为 Json(JsonB)"）。原 SQL 文件曾短暂存在于 `prisma/migrations-m6-1-summary-to-json.sql`，已在迁移完成后删除；需要回查时 `git log -p -- prisma/migrations-m6-1-summary-to-json.sql` 可取。
