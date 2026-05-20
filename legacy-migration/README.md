# legacy-migration

LexSeekApi（旧）→ LexSeek（新）历史数据一次性迁移工具。一次性使用，迁移上线稳定后整体删除本目录。

设计文档：`docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`

## 环境变量

在仓库根 `.env` 中临时追加（迁移完成后移除）：

- `LEGACY_DATABASE_URL` — 旧库（LexSeekApi 生产库快照）连接串
- `DATABASE_URL` — 新库连接串（仓库已有）

> 角色 id 由 `migrate` 自动按 `roles.code`（`user` / `admin` / `super_admin`）解析，无需配置。

## 命令（均从仓库根目录执行）

- `npx tsx legacy-migration/src/index.ts preflight` — 上线前 8 项扫描，输出 `reports/preflight.json`
- `npx tsx legacy-migration/src/index.ts migrate` — 全量迁移，输出 `reports/exceptions.csv`、`reports/migration-summary.json`
- `npx tsx legacy-migration/src/index.ts verify` — 迁移后数据校验，输出 `reports/verify.json`
- `npx tsx legacy-migration/reembed.ts` — 历史案件分析向量重建 + 缺失摘要补全（迁移后置步骤，见下方切换流程步骤 6）

## 测试

`npx vitest run --config legacy-migration/vitest.config.ts`

## 切换流程

- **演练**（上线前可反复跑）—— 见"演练流程"
- **正式切换**（蓝绿切换，停写窗口 1-2 小时）—— 见"正式切换"

### 演练流程

提供两种演练路径，按需选其一：

#### A 路径 · 从旧库备份恢复到测试库

1. 用旧库生产备份恢复出测试库。
2. `preflight` — 处理扫描出的 warn 项（参见设计文档 §16）。
3. `migrate` — 跑迁移。
4. `verify` — 校验。
5. 核对 `reports/exceptions.csv` 与 `reports/verify.json`，迭代脚本，重复至干净。

#### B 路径 · 从 migration 重放（完整重建新库，已实测）

最贴近生产部署的演练：`prisma migrate reset` 重置库并重放全部 migration → `prisma db execute` 导入 seedData → 跑迁移。**全程使用 Prisma 原生命令**，本地 Docker / 云数据库（RDS / 阿里云 RDS）/ 独立 Postgres 实例均通用，`DATABASE_URL` 决定操作哪个库。2026-05-20 全流程实测可重复跑通，verify 30 项 0 关注。

**前置确认**：
- `.env` 的 `DATABASE_URL` 指向**目标新库**（第 1 步会重置该库的所有数据，**务必不是误指生产库**）
- `.env` 的 `LEGACY_DATABASE_URL` 指向旧库备份
- 嵌入模型 API 配置就绪（第 7 步用）
- 建议：临时把 `prisma.config.ts` 的 `migrations.seed` 配置去掉，让第 1 步的 `migrate reset` 不再触发已废弃的 `prisma/seed.ts`（与"种子唯一权威是 seedData.sql"策略一致）；如保留该配置，第 1 步末尾会因 `seed.ts:89` 报错，**可忽略**——schema 与 migration 已正确应用完成

**1. 重置 + 应用全部 migration**

```bash
npx prisma migrate reset --force
```

> 该命令会：drop 当前库所有对象 → 重放所有 migration（含建扩展 `vector` / `pg_trgm` / `zhparser`、所有表、索引、触发器）→ 重新生成 Prisma client → 触发配置的 seed。
> Prisma 7 不支持 `--skip-seed`，要跳过 seed 须从 `prisma.config.ts` 移除 `migrations.seed` 配置。

✅ 检查点：`All migrations have been successfully applied`；3 个扩展 + 全部业务表到位。

**2. 导入 seedData.sql**

```bash
npx prisma db execute --file prisma/seeds/seedData.sql
```

> seedData.sql 实测含 1478 条 INSERT（覆盖 users 4 行 / user_roles / 全部配置表）；**不含 `document_templates`**（如新库需要文书模板，由 admin 后台或单独脚本处理）。

✅ 检查点：`Script executed successfully.`

**3. 清空业务表（必要）**

seedData 写入了种子 users / user_roles，必须 TRUNCATE 给迁移让路。

```bash
npx prisma db execute --stdin <<'SQL'
TRUNCATE TABLE
  system_configs, users, user_roles, oss_files,
  asr_tasks, asr_records, doc_recognition_records, image_recognition_records,
  cases, case_sessions, case_materials, text_content_records, case_analyses,
  user_memberships, orders, payment_transactions, membership_upgrade_records,
  point_records, point_consumption_records, user_benefits,
  redemption_codes, redemption_records,
  document_drafts, case_analysis_embeddings, case_material_embeddings
RESTART IDENTITY CASCADE;
SQL
```

> CASCADE 会一并清空 `document_templates` / `contract_*` / `mineru_tasks` / `permission_audit_logs`，这些表 seedData 都不填，无损失。

**4.（可选）preflight**：`npx tsx legacy-migration/src/index.ts preflight`

**5. 跑迁移**：`npx tsx legacy-migration/src/index.ts migrate`

✅ 关键指标（2026-05-20 实测）：
- `「案件描述」材料派生：新增 3 条`
- `原被告回填：0 个案件字段已补`
- `数据迁移完成：异常 ~1855 行` —— 明细见 `reports/exceptions.csv`，均为已知丢弃项（跳过 type=5 视频材料、丢弃 2340 条当事人提取记录等）

**6. 校验**：`npx tsx legacy-migration/src/index.ts verify`

✅ 检查点：`校验完成：30 项，0 项需关注`。

**7. 重建案件分析向量 + 补摘要**：`npx tsx legacy-migration/reembed.ts`

> 约 1 万条、耗时较长，可后台跑。**案件材料**的识别 / 嵌入 / 摘要由新项目 `caseProcessMaterialMiddleware` 在每次案件分析 / 小索对话启动前自动补齐，不在此步。

**8. 抽查**：
- `prisma studio` / psql 抽几个案件：标题、原被告、材料、自由文书显示正常
- `bun dev` 登录某迁移用户，验证案件列表 / 案件详情 / 分析结果 / 自由文书预览
- 抽看 `exceptions.csv`，确认都是已知丢弃项

> ⚠️ **不要跑 `bun run prisma/seed.ts`**：本项目种子数据唯一权威源是 `prisma/seeds/seedData.sql`，`seed.ts` 已与 `prompts` 模型 schema 漂移（2026-05-20 实测 `seed.ts:89` 用了已不存在的 `nodeId / type / version / deletedAt` 字段会运行时报错）。

### 正式切换（蓝绿切换，停写窗口 1-2 小时）

1. 旧系统停写（设为只读或挂维护页）。
2. 备份旧库快照（回滚兜底）。
3. 新库重建：按 **B 路径 步骤 1-2** 执行（DROP + CREATE + migrate deploy + 导入 seedData.sql）。
4. 配置 `.env`：`LEGACY_DATABASE_URL` 指向旧库快照、`DATABASE_URL` 指向新库；如需给关键账号补绑更细的角色组合，按真实管理员名单填好 `src/adminRoles.ts` 的 `ADMIN_BINDINGS`。
5. 执行 **B 路径 步骤 3-6**（TRUNCATE → migrate → verify）。
6. **案件分析向量重建**：执行 **B 路径 步骤 7**（`reembed.ts`，幂等、可中断重跑、失败自动重试一轮）。可与冒烟测试并行，不阻塞切换。
7. 冒烟测试新系统关键路径（登录 / 看案件 / 看订单 / 看会员 / 看材料 / 看自由文书预览）。
8. 校验 + 冒烟通过 → 切域名到新版、开放写入；不通过 → 回滚（域名切回旧版、旧系统恢复写入）。

### 清理（上线稳定后）

- 删除 `legacy-migration/` 目录。
- 删除新库 `_migration_progress` 表。
- 移除 `.env` 中的 `LEGACY_DATABASE_URL`。
