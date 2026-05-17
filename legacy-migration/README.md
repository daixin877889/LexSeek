# legacy-migration

LexSeekApi（旧）→ LexSeek（新）历史数据一次性迁移工具。一次性使用，迁移上线稳定后整体删除本目录。

设计文档：`docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`

## 环境变量

在仓库根 `.env` 中临时追加（迁移完成后移除）：

- `LEGACY_DATABASE_URL` — 旧库（LexSeekApi 生产库快照）连接串
- `DATABASE_URL` — 新库连接串（仓库已有）
- `MIGRATION_ADMIN_ROLE_ID` — 新库 `roles` 表中基础 admin 角色的 id（`migrate` 命令需要）

## 命令（均从仓库根目录执行）

- `npx tsx legacy-migration/src/index.ts preflight` — 上线前 8 项扫描，输出 `reports/preflight.json`
- `npx tsx legacy-migration/src/index.ts migrate` — 全量迁移，输出 `reports/exceptions.csv`、`reports/migration-summary.json`
- `npx tsx legacy-migration/src/index.ts verify` — 迁移后数据校验，输出 `reports/verify.json`

## 测试

`npx vitest run --config legacy-migration/vitest.config.ts`

## 切换流程（蓝绿切换，停写窗口 1-2 小时）

### 演练阶段（上线前，可反复）

1. 用旧库生产备份恢复出测试库。
2. `preflight` — 处理扫描出的 warn 项（参见设计文档 §16）。
3. `migrate` — 跑迁移。
4. `verify` — 校验。
5. 核对 `reports/exceptions.csv` 与 `reports/verify.json`，迭代脚本，重复至干净。

### 正式切换

1. 旧系统停写（设为只读或挂维护页）。
2. 备份旧库快照（回滚兜底）。
3. 新库：`prisma migrate deploy` + 导入 `seedData.sql`（**剔除 `users` / `user_roles` 两表的 INSERT**）+ 跑 `seed.ts`。
4. 配置 `.env`：`LEGACY_DATABASE_URL`、`DATABASE_URL`、`MIGRATION_ADMIN_ROLE_ID`；按真实管理员名单填好 `src/adminRoles.ts` 的 `ADMIN_BINDINGS`。
5. `migrate` → `verify`。
6. **向量重嵌入**：迁移已把案件材料的 `lastEmbeddingAt` 置 null 作为"待嵌入"标记；在新项目侧对这些材料批量重嵌入（复用 `server/services/material/materialEmbedding.service.ts` 的 `embedMaterialUnifiedService`；建议在新项目 `server/scripts/` 下补一个批量重嵌入脚本，与 `rebuildLawEmbeddings.ts` 同款）。未完成期间历史材料暂不可语义检索，不阻塞切换。
7. 冒烟测试新系统关键路径（登录 / 看案件 / 看订单 / 看会员 / 看材料）。
8. 校验 + 冒烟通过 → 切域名到新版、开放写入；不通过 → 回滚（域名切回旧版、旧系统恢复写入）。

### 清理（上线稳定后）

- 删除 `legacy-migration/` 目录。
- 删除新库 `_migration_progress` 表。
- 移除 `.env` 中的 `LEGACY_DATABASE_URL`、`MIGRATION_ADMIN_ROLE_ID`。
