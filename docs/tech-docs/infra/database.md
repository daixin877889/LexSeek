# 数据库

LexSeek 使用 PostgreSQL 数据库 + Prisma ORM，采用模块化 schema 拆分机制，通过 pgvector 扩展支持向量检索，并通过严格的时区配置避免双偏移问题。

---

## 1. Prisma 模块化模型拼接

### 目录结构

```
prisma/
├── schema.prisma          # 主配置（generator + datasource）
├── models/                # 模块化模型（28 个 .prisma 文件）
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

### 开发阶段：`prisma:push`

```bash
bun run prisma:push
```

直接将当前 schema 推送到数据库，不生成迁移文件。适用于：
- 快速原型开发
- 频繁修改模型

**注意**：`prisma:push` 可能导致数据丢失（如删除列），使用前确认。

### 生产阶段：`prisma:migrate`

```bash
bun run prisma:migrate
```

生成和执行迁移文件，记录变更历史。适用于：
- 生产环境部署
- 需要回滚能力的场景

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

#### 全局清理 (`tests/global-teardown.ts`)

所有测试文件执行完毕后，全局清理函数使用原生 SQL 按前缀批量删除残留数据：

```typescript
export async function teardown() {
    const client = new pg.Client({ connectionString })
    await client.connect()

    // 按 test_ 前缀清理 nodes, prompts, models 等
    await client.query(`
        DELETE FROM prompts WHERE node_id IN
            (SELECT id FROM nodes WHERE name LIKE 'test_node_%');
        DELETE FROM nodes WHERE name LIKE 'test_node_%';
        DELETE FROM models WHERE name LIKE 'test_model_%';
        -- ...
    `)
}
```

清理规则：
- 节点名称以 `test_node_` 或 `node_test_` 开头
- 模型名称以 `test_model_` 开头
- 提供商名称以 `test_provider_` 或 `测试提供商_` 开头
- 案件类型以 `测试类型_` 开头
- 提示词以 `test_` 开头

#### 测试数据命名约定

为确保全局清理能正确识别测试数据：
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
- `fileParallelism: false`，测试文件串行执行，避免数据库并发冲突
- `globalSetup: ['./tests/global-teardown.ts']`，所有测试完成后执行全局清理

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
