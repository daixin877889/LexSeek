# Context Governance Eval

> 设计：`docs/superpowers/specs/2026-04-25-context-governance-eval-design.md`
> 评测对象：`docs/superpowers/specs/2026-04-23-case-context-governance-design.md`

## 一次性初始化

`ls_eval` 库与生产库 `ls_new`、测试库 `ls_new_testing` 物理隔离。初始化包含 4 步：

```bash
# 1) 创建空库（已存在则忽略）
createdb ls_eval

# 2) 推 Prisma schema 到 ls_eval
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' \
  bun run prisma:push --accept-data-loss

# 3) 生成 Prisma client（一般 push 已自动跑过一次，重跑无副作用）
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_eval?schema=public&TimeZone=UTC' \
  bun run prisma:generate

# 4) 灌入项目种子数据（nodes / caseTypes / models 等业务必备数据）
psql 'postgresql://daixin:daixin88@localhost:5432/ls_eval' -f prisma/seeds/seedData.sql
```

注：测试用户由 `buildFixture` 在第一次跑评测时自动 upsert，无需手工 seed 用户。

## 运行

```bash
EVAL_DEEPSEEK_KEY=sk-xxx bun run eval:context
```

## 运行时依赖

- PostgreSQL `ls_eval` 库（独立于 `ls_new` / `ls_new_testing`）
- Redis 实例可达；评测使用独立 ioredis 客户端切到 `db=15`，与生产 `db=0` 物理隔离，跑前 `flushdb`
- 环境变量 `EVAL_DEEPSEEK_KEY`（DeepSeek API key）

## 首跑预期

第一次 `bun run eval:context` 通常 exit 1（cacheHitRate 冷启动远低于 60%）。这是预期行为，**不是 plan 故障**。等接入真 dataset、跑多模块多轮后命中率才会到位。
