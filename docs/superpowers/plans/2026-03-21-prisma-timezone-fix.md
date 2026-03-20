# Prisma 时区问题修复实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 `server/utils/db.ts` 中的错误时区 workaround，恢复为普通的 Prisma client

**Architecture:** 删除所有时区处理逻辑（offset 常量、toShanghaiDate、fromShanghaiDate、convertDatesForWrite、convertDatesForRead、convertQueryArgs、$extends 扩展），让 pg driver 和 PostgreSQL 的默认行为处理时区转换

**Tech Stack:** Node.js pg driver、PostgreSQL Asia/Shanghai 时区、Prisma ORM

---

## Task 1: 简化 `server/utils/db.ts`

**Files:**
- Modify: `server/utils/db.ts:1-218`

- [ ] **Step 1: 备份并重写 db.ts**

```typescript
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'

const prismaClientSingleton = () => {
    const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
    return new PrismaClient({ adapter: pool })
}

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
```

**改动说明**: 将原来的 218 行简化到约 20 行，删除所有时区处理代码

- [ ] **Step 2: 运行测试确保通过**

Run: `npx vitest run --reporter=dot`
Expected: 所有测试通过（107 个测试文件）

- [ ] **Step 3: 提交**

```bash
git add server/utils/db.ts
git commit -m "fix(db): 移除错误的时区 workaround，恢复 pg driver 默认行为

PostgreSQL session timezone 为 Asia/Shanghai，pg driver 在该时区下
已自动附加 +08:00 后缀，PostgreSQL 正确转换为 UTC 存储。
原有 workaround 在写入时多加 8h，导致数据库存储的 UTC 时间
比正确值多 8 小时。读取时减 8h 抵消了写入错误，应用层
看到的时间是对的，但数据库原始值错误。

修复后让 pg driver + PostgreSQL 的默认行为处理时区转换。"

```

---

## Task 2: 验证修复

**Files:**
- None (验证步骤)

- [ ] **Step 1: 启动开发服务器**

Run: `bun dev &`
Expected: 服务器启动成功

- [ ] **Step 2: 通过 API 创建一条记录，验证时间正确**

通过浏览器或 curl 调用任意会写入 createdAt/updatedAt 的 API（如注册用户、创建案件），然后：

```bash
# 连接数据库查看
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "SELECT NOW() AT TIME ZONE 'UTC' as utc_now, NOW() AT TIME ZONE 'Asia/Shanghai' as shanghai_now;"
```

验证数据库当前时间与实际时间一致。

- [ ] **Step 3: 停止开发服务器**
