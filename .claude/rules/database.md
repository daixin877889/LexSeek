# 数据库迁移规范（强制）

数据库变更在多环境（开发 / 测试 / 预发 / 生产）之间的一致性**只能**依靠 Prisma 迁移系统保证。所有开发者和 AI 助手必须遵守以下三条**强制**规则，任何绕开这套机制的做法都会被视为违规。

## 三条硬性规则

### 1. 数据库变更必须更新 Prisma schema

任何数据库结构变更（表 / 列 / 索引 / 枚举 / 约束）都必须通过修改 `prisma/models/*.prisma`（或 `prisma/schema.prisma`）完成。

**禁止**：
- 绕开 schema 直接在生产 / 开发库里改结构（例如用 psql `ALTER TABLE` 或 GUI 工具修改）
- 修改 schema 却不跑迁移，让 schema 与 DB 漂移

### 2. 迁移必须通过 `prisma migrate dev` 生成

开发阶段的 schema 变更**必须**通过以下命令生成正式迁移文件：

```bash
bun run prisma:migrate --name <描述性_英文_小写_下划线分隔>
# 等价于 prisma migrate dev --name ...
```

生成的迁移文件会自动落入 `prisma/migrations/<timestamp>_<name>/migration.sql`，**随 git 提交**；生产 / 预发部署时用 `bun run prisma:deploy`（`prisma migrate deploy`）自动应用。

**禁止**（每条都是常见的越界做法）：
- 用 `bun run prisma:push`（`prisma db push`）做**正式变更**。`db push` 仅允许临时验证想法，不可 commit 后让他人跟随
- 用 `docker exec psql` / 手写独立 SQL 脚本 / `docs/deployment-notes.md` 里"手工跑 SQL"等外挂方式改生产 schema
- 只改 `prisma/models/*.prisma` 而不跑 `migrate dev`——client 类型和 DB 结构会漂移

### 3. 禁止自行修改 migrations 文件夹

`prisma/migrations/` 目录里的迁移文件是多环境同步的**唯一权威源**，由 Prisma 自动生成和维护。

**禁止**（除非用户明确要求或同意）：
- 手工新建 `prisma/migrations/<xxx>/migration.sql` 当作补丁
- 修改已生成的迁移文件（尤其是已应用到任何环境的）
- 删除 / 重命名已生成的迁移文件
- 在迁移目录外放置"独立 SQL 脚本"替代正式迁移

**唯一例外**（必须用户明确同意）：当迁移涉及数据保全需求、Prisma 自动生成的 SQL 不够安全时（如 `TEXT → JSONB` 需要 `USING` 子句避免数据丢失），允许以下流程：

```bash
# 1. 生成但不自动 apply
bun run prisma:migrate --name <name> --create-only
# 2. 手工编辑 prisma/migrations/<ts>_<name>/migration.sql 加 USING / DEFAULT / 分步 ALTER 等安全子句
# 3. 用户 review 迁移 SQL → 同意后再 apply
bun run prisma:migrate
```

**在 PR 描述中必须明确说明"手工修订 migration.sql + 修订理由 + 用户同意人"**。

## 为什么要这样严格

- `prisma migrate dev` 生成的迁移文件是**多环境同步的唯一权威源**；其它任何渠道（手写 SQL、db push、手工改 migrations）都无法被 CI / 生产部署自动识别
- 生产部署 `prisma migrate deploy` 只应用 migrations 目录里已登记的迁移；漏登记 = 漏部署 = 线上事故
- 绕开迁移机制会造成：
  - 开发者 / CI 本地无法复现生产 schema
  - `prisma migrate status` 报 "drift detected"
  - 多 worktree / 分支间 schema 状态难以追踪
  - 回滚（`prisma migrate reset`）失效
  - 合入主干后其他人 pull 代码但本地 DB 仍是旧结构，运行时报错

## 推荐工作流

```bash
# 1. 改 prisma/models/<module>.prisma
# 2. 先用 --create-only 预览 Prisma 生成的 SQL（防止破坏性改动，例如 DROP+ADD 丢数据）
bun run prisma:migrate --name <name> --create-only
# 3. 阅读 prisma/migrations/<ts>_<name>/migration.sql。若需要 USING / DEFAULT / 分步 ALTER 等安全子句 → 手工加；否则直接
# 4. 应用到本地测试库 + 开发库
bun run prisma:migrate
# 5. 验证：跑相关单元/集成测试；`prisma migrate status` 应显示 "Database schema is up to date"
# 6. commit 范围：
#    - prisma/models/<module>.prisma
#    - prisma/migrations/<ts>_<name>/
#    - 可能变更的 generated/prisma/**
# 7. 生产 / 预发部署：自动跑 `bun run prisma:deploy`，不手工执行 SQL
```

## 触发重新核对的红色信号

遇到以下任何情形，**立刻停下来排查**，不要继续提交代码：

- `prisma migrate status` 显示 "drift detected" 或 "pending migration"
- 其他开发者 pull 你的分支后 client 与 DB 结构不一致、运行时报错
- 你或 AI 助手曾经为了绕过 prisma 检查而在 `docs/deployment-notes.md` 写"需要手工跑 SQL"的条目——这是违规信号
- 迁移文件里出现 `// TODO` / 注释掉的 SQL / 调试语句——绝不允许进 commit

## 与现有命令的关系

命令别名见 `.claude/rules/commands.md` 的 "Prisma 命令" 一节。总结：

| 命令 | 何时用 |
|------|--------|
| `bun run prisma:generate` | schema 改完只想重生成 client 时（一般 migrate dev 会自动跑一次） |
| `bun run prisma:migrate` | **正式变更的唯一入口** |
| `bun run prisma:deploy` | 生产 / 预发部署流程（CI/CD 里跑，不手工） |
| `bun run prisma:push` | ⚠️ 仅允许临时验证 schema 想法；**不可**用于要 commit 的变更 |
| `bun run prisma:studio` | 浏览 / 调试数据，只读安全 |
