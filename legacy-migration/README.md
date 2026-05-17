# legacy-migration

LexSeekApi（旧）→ LexSeek（新）历史数据一次性迁移工具。一次性使用，迁移上线稳定后整体删除本目录。

设计文档：`docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`

## 环境变量

在仓库根 `.env` 中临时追加（迁移完成后移除）：

- `LEGACY_DATABASE_URL` — 旧库（LexSeekApi 生产库快照）连接串
- `DATABASE_URL` — 新库连接串（仓库已有）

## 命令（均从仓库根目录执行）

- `npx tsx legacy-migration/src/index.ts preflight` — 上线前 8 项扫描，结果同时输出到 `legacy-migration/reports/preflight.json`
- `migrate` / `verify` — 见计划二、计划三

## 测试

`npx vitest run --config legacy-migration/vitest.config.ts`

## 清理

迁移上线稳定后：删除本目录、删除新库 `_migration_progress` 表、移除 `.env` 中的 `LEGACY_DATABASE_URL`。
