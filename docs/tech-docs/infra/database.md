# 数据库

LexSeek 使用 PostgreSQL 数据库 + Prisma ORM，采用模块化 schema 拆分机制，通过 pgvector 扩展支持向量检索，并通过严格的时区配置避免双偏移问题。

---

## 1. Prisma 模块化模型拼接

### 目录结构

```
prisma/
├── schema.prisma          # 主配置（generator + datasource）
├── models/                # 模块化模型（29 个 .prisma 文件）
│   ├── user.prisma
│   ├── case.prisma
│   ├── membership.prisma
│   ├── order.prisma
│   └── ...
└── migrations/            # 迁移历史
```

### 主配置 (`prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

关键设计：
- `generator` 使用 `prisma-client` provider（Prisma 6+），输出到 `generated/prisma/`
- `datasource` 仅声明 `provider = "postgresql"`，连接 URL 由 `prisma.config.ts` 中通过环境变量 `DATABASE_URL` 提供
- **不在 schema.prisma 中写 `url`**，避免硬编码

### prisma.config.ts

```typescript
import "dotenv/config"
import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma",           // schema 目录（非单文件）
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
})
```

`schema: "prisma"` 告诉 Prisma CLI 扫描整个 `prisma/` 目录（包括子目录 `models/`），自动发现所有 `.prisma` 文件并拼接为完整 schema。这是 Prisma 6+ 的多文件 schema 特性。

---

## 2. 数据库扩展

### pgvector

开发环境的 PostgreSQL 基于 `pgvector/pgvector:pg17` 镜像构建（`docker/postgres/Dockerfile`），支持向量类型和相似度搜索。

两个向量表使用 `Unsupported("vector")` 类型：
- `law_embeddings` - 法条内容嵌入
- `case_material_embeddings` - 案件材料嵌入

向量操作通过原生 SQL 执行（Prisma 不支持 `vector` 类型的直接操作）。

### zhparser

开发环境同时安装了 `zhparser` 扩展（中文全文检索分词器），配合 `scws` 分词库使用。

---

## 3. 迁移流程

### 正式变更唯一入口：`prisma:migrate`

```bash
bun run prisma:migrate --name <描述性_英文_小写_下划线分隔>
```

等价于 `prisma migrate dev`。任何数据库结构变更（表 / 列 / 索引 / 枚举 / 约束）**必须**先改 `prisma/models/*.prisma`，再通过此命令生成正式迁移文件——迁移文件落入 `prisma/migrations/<timestamp>_<name>/migration.sql` 并随 git 提交，生产 / 预发用 `bun run prisma:deploy` 自动应用。这是多环境 schema 同步的唯一权威源。

详见 `.claude/rules/database.md` 的强制规则。

### `prisma:push` 仅用于临时验证

```bash
bun run prisma:push
```

直接将当前 schema 推送到数据库，不生成迁移文件。**仅允许临时验证 schema 想法**——不可作为正式变更，不可 commit 后让他人跟随。

**禁止**用 `db push` 做正式 schema 变更：它无法被 CI / 生产部署自动识别，会造成 schema 漂移、`prisma migrate status` 报 "drift detected"。正式变更一律走 `prisma migrate dev`。

**注意**：`prisma:push` 可能导致数据丢失（如删除列），使用前确认。

### 生成客户端

```bash
bun run prisma:generate
```

根据当前 schema 生成 TypeScript 客户端到 `generated/prisma/` 目录。每次修改 schema 后都需要执行。

### Prisma Studio

```bash
bun run prisma:studio
```

打开可视化数据库管理界面。

---

## 4. 时区陷阱

### 问题描述

Prisma 在发送 `timestamptz` 值时使用 ISO 8601 格式（如 `2024-01-01T08:00:00+08:00`）。PostgreSQL 接收到这个值后，会将其转换为当前会话时区的时间再存储。

如果 PG 会话时区为 `Asia/Shanghai`（UTC+8）：
1. Prisma 发送 `2024-01-01T08:00:00+08:00`
2. PG 解析为 UTC `2024-01-01T00:00:00Z`
3. PG 按 `Asia/Shanghai` 时区显示为 `2024-01-01 08:00:00+08`
4. Prisma 读取时再次转换 -> 可能导致"双偏移"

### 解决方案

设置 PG 会话时区为 UTC：

```typescript
// server/utils/db.ts
const adapter = new PrismaPg({
    connectionString,
    options: '-c TimeZone=UTC',
})
```

这确保 PG 会话时区与 Prisma 的 UTC 假设一致，避免双偏移。

### 影响范围

所有使用 Prisma Client 的代码自动受益，包括：
- `server/utils/db.ts` - 生产环境
- `vitest.config.ts` - 测试环境
- `scripts/eval/search_law_tool/evalRetrievalQuality.ts` - 脚本环境
- `server/scripts/rebuildLawEmbeddings.ts` - 重建索引脚本

---

## 5. 测试数据库

### 配置

- **数据库名**：`ls_new_testing`
- **连接串**：`postgresql://daixin:daixin88@localhost:5432/ls_new_testing`
- **环境变量文件**：`.env.testing`

### Schema 同步

测试数据库的 schema 需要与主数据库保持同步。当 schema 发生变更时，执行：

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:push --accept-data-loss
```

`--accept-data-loss` 标志在测试数据库上是安全的，因为测试数据是临时的。

### 测试数据清理

#### afterEach / afterAll 清理

每个测试文件负责清理自己创建的数据：

```typescript
afterEach(async () => {
    // 清理本测试创建的数据
    await prisma.someTable.deleteMany({
        where: { name: { startsWith: 'test_' } }
    })
})
```

#### worker 级 DB 隔离基建 (`tests/_infra/`)

测试套件采用 **database-per-worker** 物理隔离，相关基建集中在 `tests/_infra/`：

| 文件 | 职责 |
|------|------|
| `global-setup.ts` | master 进程执行一次：准备 template DB（指纹缓存命中则跳过）、按 worker 数预创建 `ls_test_w*` 库（`CREATE DATABASE ... TEMPLATE` 物理拷贝）；teardown 阶段 DROP 所有 worker DB |
| `template-db.ts` | 构建 / 维护测试模板库（schema + seed 快照），供 worker 库拷贝 |
| `worker-prisma.ts` | 为当前 worker 解析对应的 worker DB 连接串并构造 Prisma 客户端 |
| `worker-setup.ts` | 每个 worker 进程加载一次（`vitest.config.ts` 的 `setupFiles`），把 `globalThis.prisma` 指向当前 worker 专属 DB |

每个 worker 拥有独立物理数据库，测试间天然无数据污染，无需依赖前缀清理来隔离并发。

#### 测试数据命名约定

为避免同一 worker 内多个测试文件互相干扰：
- 测试创建的节点：名称使用 UUID（`crypto.randomUUID()`）或 `test_` 前缀
- 测试创建的模型/提供商：使用 `test_` 前缀
- 严禁使用硬编码的短名称（如 `test1`），可能与其他测试冲突

---

## 6. Vitest 配置中的数据库

`vitest.config.ts` 创建了全局 Prisma 客户端供测试使用：

```typescript
const createGlobalPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    const adapter = new PrismaPg({
        connectionString,
        options: '-c TimeZone=UTC',  // 与生产环境一致
    })
    return new PrismaClient({ adapter })
}
```

配置要点：
- 环境变量通过 `dotenv` 从 `.env.testing` 加载
- 使用与生产环境相同的 `TimeZone=UTC` 设置
- `testTimeout` 设置为 120000ms（2 分钟），因为数据库操作可能较慢
- `fileParallelism: true`，测试文件并行执行；database-per-worker 隔离已避免数据库并发冲突
- `globalSetup: ['./tests/_infra/global-setup.ts']`，套件启动时准备模板库与 worker 库，结束时统一 DROP
- `setupFiles: ['./tests/_infra/worker-setup.ts']`，每个 worker 加载一次，注入指向 worker 专属 DB 的 `prisma`

---

## 7. 开发环境 PostgreSQL

### Docker Compose（`docker-compose.dev.yml`）

```yaml
services:
  postgres:
    build:
      context: .
      dockerfile: docker/postgres/Dockerfile
    image: lexseek-postgres:dev
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=daixin
      - POSTGRES_PASSWORD=daixin88
      - POSTGRES_DB=postgres
      - TZ=Asia/Shanghai
    volumes:
      - lexseek-pgdata:/var/lib/postgresql/data
```

### Dockerfile (`docker/postgres/Dockerfile`)

```dockerfile
FROM pgvector/pgvector:pg17

# 安装 scws（中文分词库）+ zhparser（PG 中文分词扩展）
RUN apt-get update && apt-get install -y ... \
    && curl ... scws-1.2.3.tar.bz2 \
    && ./configure && make install \
    && git clone ... zhparser \
    && cd /tmp/zhparser && make && make install
```

基于 `pgvector/pgvector:pg17`（PostgreSQL 17 + pgvector），额外安装：
- **scws**：中文分词库
- **zhparser**：PostgreSQL 中文全文检索扩展

启动命令：
```bash
docker compose -f docker-compose.dev.yml up -d
```
