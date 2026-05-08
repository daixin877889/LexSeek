# 数据库迁移规范（强制）

数据库变更在多环境（开发 / 测试 / 预发 / 生产）之间的一致性**只能**依靠 Prisma 迁移系统保证。所有开发者和 AI 助手必须遵守以下三条**强制**规则，任何绕开这套机制的做法都会被视为违规。

## 三条硬性规则

### 1. 数据库变更必须更新 Prisma schema

任何数据库结构变更（表 / 列 / 索引 / 枚举 / 约束）都必须通过修改 `prisma/models/*.prisma`（或 `prisma/schema.prisma`）完成。

**禁止**：
- 绕开 schema 直接在生产 / 开发库里改结构（例如用 psql `ALTER TABLE` 或 GUI 工具修改）
- 修改 schema 却不跑迁移，让 schema 与 DB 漂移
- 在 `prisma/migrations/` 文件夹下手写迁移脚本

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

### 3. 禁止自行修改 migrations 文件夹（铁律，无例外）

`prisma/migrations/` 目录里的迁移文件是多环境同步的**唯一权威源**，由 Prisma 自动生成和维护。

**绝对禁止**：
- 手工新建 `prisma/migrations/<xxx>/migration.sql` 当作补丁
- 修改 / 删除 / 重命名已生成的迁移文件
- 用 `--create-only` 流程后手改 SQL 加 USING / DEFAULT / 分步 ALTER 等子句
- 在迁移目录外放置"独立 SQL 脚本"替代正式迁移

**没有"用户同意的例外"**——任何数据保全 / 复杂迁移需求,都必须通过调整 Prisma schema 或拆分多次 `prisma migrate dev` 解决,**不允许手写 SQL**。

## 为什么要这样严格

- `prisma migrate dev` 生成的迁移文件是**多环境同步的唯一权威源**；其它任何渠道（手写 SQL、db push、手工改 migrations）都无法被 CI / 生产部署自动识别
- 生产部署 `prisma migrate deploy` 只应用 migrations 目录里已登记的迁移；漏登记 = 漏部署 = 线上事故
- 绕开迁移机制会造成：
  - 开发者 / CI 本地无法复现生产 schema
  - `prisma migrate status` 报 "drift detected"
  - 多 worktree / 分支间 schema 状态难以追踪
  - 回滚（`prisma migrate reset`）失效
  - 合入主干后其他人 pull 代码但本地 DB 仍是旧结构，运行时报错

## Schema 变更推荐工作流

```bash
# 1. 改 prisma/models/<module>.prisma
# 2. 跑 prisma migrate dev 自动生成迁移文件并应用
bun run prisma:migrate --name <name>
# 3. 验证：跑相关单元/集成测试；`prisma migrate status` 应显示 "Database schema is up to date"
# 4. commit 范围：
#    - prisma/models/<module>.prisma
#    - prisma/migrations/<ts>_<name>/（Prisma 自动生成,不手改）
#    - 可能变更的 generated/prisma/**
# 5. 生产 / 预发部署：自动跑 `bun run prisma:deploy`，不手工执行 SQL
```

> 如果 Prisma 自动生成的 SQL 不够安全（如 `TEXT → JSONB` 默认 DROP+ADD 丢数据），**正确做法是调整 Prisma schema 让生成的 SQL 安全**（例如先加新列,业务代码迁移,再删旧列——拆分成 2-3 次 `prisma migrate dev`），而不是手写 SQL。

## 数据级变更（行/字段值更新）

**数据级变更不走 migration 流程**。Prisma migration 只负责 schema（表/列/索引/约束），不负责种子数据或业务配置数据的 update。

数据级变更指：
- `nodes.tools` JSON 字段值改变（节点工具配置调整）
- `node_skills` 关联关系新增/删除（节点挂载 skill 调整）
- `prompts.content` 文本更新（系统提示词改写）
- `prompts.status` 启停切换
- 其他业务配置类数据的字段值修改

### 正确做法

1. **直接修改 dev 库**：用任何顺手的方式改本地开发库（`prisma studio` GUI 编辑 / 通过管理后台 admin 页面操作 / 直接连库执行 SQL 都可以——只要是改 dev 库就行）。
2. **同步修改 `prisma/seeds/seedData.sql`**：把 dev 库里改后的最终值，写回 seedData.sql 对应的 `INSERT INTO` 语句里。
3. **commit 范围**：仅 `prisma/seeds/seedData.sql`（dev 库的改动不入 git，靠 seedData.sql 在新环境复现）。

### seedData.sql 编写铁律

- seedData.sql **只能包含 `INSERT INTO ... VALUES (...)`**（以及 `CREATE EXTENSION` 等基础设施语句）
- **绝对禁止**在 seedData.sql 中写 `UPDATE` / `DELETE` 语句——它是"现状的全量快照"，不是"增量补丁"
- 调整已有数据时，**直接改对应 INSERT 语句的 VALUES 字段值**，不追加 UPDATE
- 新增数据时，追加新的 INSERT INTO

### 为什么这样设计

- seedData.sql 是新环境（CI / 新人本地 / 测试库）一次性导入的快照,导入完成后状态就是当前线上配置
- 如果在 seedData.sql 里塞 UPDATE,新环境导入时会"先 INSERT 老值再 UPDATE 改值",既冗余又容易出错
- 任何业务配置类数据的"历史变更轨迹"由 git 历史负责（修改 seedData.sql 的 commit 自带变更说明），不由 seedData.sql 自己承担

### 多环境同步

- 开发环境：直接改 dev 库 + 改 seedData.sql
- 测试 / 预发 / 生产：根据部署流程从 seedData.sql 重新导入,或手动按 PR 中的 seedData.sql diff 应用对应字段更新（具体由部署 SOP 决定，不属于本规则范围）

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
