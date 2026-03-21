# Prisma 时区问题修复实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Prisma 时区问题，通过 `TimeZone=UTC` 确保时间正确存储

**Architecture:** 在 `PrismaPg` 连接中通过 `options: '-c TimeZone=UTC'` 参数将 PG 会话时区设为 UTC，移除原有的手动偏移 workaround，让 pg adapter 发送的时间戳被正确解释为 UTC

**Tech Stack:** Node.js pg driver、PostgreSQL Asia/Shanghai 时区、Prisma ORM

---

## Task 1: 修复 `server/utils/db.ts` 和 `vitest.config.ts`

**Files:**
- Modify: `server/utils/db.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: 重写 db.ts**

```typescript
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'

const prismaClientSingleton = () => {
    // Fix: Set PG session timezone to UTC via connection options
    // @prisma/adapter-pg sends Date values as UTC strings without timezone suffix,
    // and PG interprets these in the session timezone. By setting TimeZone=UTC,
    // PG treats the bare timestamps as UTC, ensuring correct storage and retrieval.
    // Related: https://github.com/prisma/prisma/issues/26786
    const pool = new PrismaPg({
        connectionString: process.env.DATABASE_URL!,
        options: '-c TimeZone=UTC',
    })
    return new PrismaClient({ adapter: pool })
}

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

**改动说明**: 删除所有时区处理代码（218行 → 25行），使用 `TimeZone=UTC` 替代

- [ ] **Step 2: 更新 vitest.config.ts**

在 `createGlobalPrisma` 的 `PrismaPg` 构造函数中添加 `options: '-c TimeZone=UTC'`

- [ ] **Step 3: 新增时区验证测试**

创建 `tests/server/utils/tz-verify.test.ts`，导入 `db.ts` 的 `prisma` 直接测试读写一致性

- [ ] **Step 4: 运行测试确保通过**

Run: `npx vitest run --reporter=dot`
Expected: 所有测试通过（119 个测试文件，1586 个测试）

- [ ] **Step 5: 提交**

```bash
git add server/utils/db.ts vitest.config.ts tests/server/utils/tz-verify.test.ts
git commit -m "fix(db): 修复 Prisma 时区问题，正确处理 UTC 时间存储

问题根因：PostgreSQL session timezone 为 Asia/Shanghai，@prisma/adapter-pg
发送 Date 值时不带时区后缀，导致 PG 将其解释为 Asia/Shanghai 并错误地
加上 +08:00 偏移。

修复方案：在连接字符串中通过 options 参数设置 PG 会话时区为 UTC，
使 pg 发送的时间戳被正确解释为 UTC。

同时：
- 移除原有的错误 workaround（手动 +8h/-8h 偏移逻辑）
- vitest.config.ts 的测试 Prisma client 同步应用 TimeZone=UTC
- 新增时区验证测试 tests/server/utils/tz-verify.test.ts

相关 issue: https://github.com/prisma/prisma/issues/26786"
```

---

## Task 2: 验证修复

**Files:**
- None (验证步骤)

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev &`
Expected: 服务器启动成功

- [ ] **Step 2: 验证数据库时间正确**

```bash
# 检查 PG 会话时区
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SHOW TimeZone;"

# 检查当前时间
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT NOW() AT TIME ZONE 'UTC' as utc_now, NOW() AT TIME ZONE 'Asia/Shanghai' as shanghai_now;"
```

- [ ] **Step 3: 停止开发服务器**
