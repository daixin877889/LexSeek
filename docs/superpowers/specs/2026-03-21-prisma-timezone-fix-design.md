# Prisma 时区问题修复设计方案

## 问题描述

PostgreSQL 数据库时区配置为 `Asia/Shanghai` (+08:00)，但数据库中存储的时间比正确时间少了 8 小时。例如：

- 实际存储: `2026-03-20 17:14:53.31+08`
- 正确应为: `2026-03-21 01:14:53.31+08`

## 根因分析

`server/utils/db.ts` 中存在一个时区 workaround，其核心逻辑：

- **写操作**: `new Date(date.getTime() + 8 * 60 * 60 * 1000)` — Date 加 8 小时后再发送
- **读操作**: `new Date(date.getTime() - 8 * 60 * 60 * 1000)` — 读取结果减 8 小时

该 workaround 的前提假设是 **错误的**：

pg driver (`node-postgres`) 在 `Asia/Shanghai` 时区环境下，已经自动在序列化的日期字符串后附加 `+08:00` 后缀（因为 `dateToString` 使用 `date.getHours()` 等本地时区组件）。PostgreSQL 收到带 `+08:00` 的字符串后，正确地将其转换为 UTC 存储。

workaround 又加了一次 8h，导致写入的数据多了 8h。读取时减 8h 抵消了写入错误，所以应用层看到的时间是对的，但数据库中存储的原始 UTC 值错了 8 小时。

## 解决方案

通过 `options: '-c TimeZone=UTC'` 参数将 PostgreSQL 会话时区设置为 UTC，让 pg driver 发送的时间戳被正确解释为 UTC 而非 Asia/Shanghai。

相关 issue: https://github.com/prisma/prisma/issues/26786

## 改动详情

### `server/utils/db.ts`

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

### `vitest.config.ts`

同步应用 `TimeZone=UTC` 到测试 Prisma client：
```typescript
const adapter = new PrismaPg({
    connectionString,
    options: '-c TimeZone=UTC',
})
```

### `tests/server/utils/tz-verify.test.ts`（新增）

时区验证测试，导入 `db.ts` 直接测试生产代码。

## 原理说明

修复后的时间流程：

1. **应用层**: `new Date()` 创建 UTC 时间（如 `2026-03-21T01:14:53.310Z`）
2. **pg adapter**: 发送裸时间戳字符串（如 `2026-03-21T01:14:53.310`）到 PG
3. **PostgreSQL**: 会话时区为 UTC，将裸时间戳正确解释为 UTC 并存储
4. **读取**: pg adapter 将数据库返回的 UTC 时间转换为 JavaScript `Date`（UTC）
5. **前端**: `dayjs` 解析 UTC 字符串，输出浏览器本地时区时间

## 验证方式

1. 写入一条带明确时间的记录，验证数据库中存储的 UTC 时间正确
2. 读取该记录，验证应用层 `Date` 对象正确
3. 前端显示的时间正确
4. 运行测试套件，确保全部通过（`npx vitest run`）

## 风险评估

- **风险等级**: 低
- pg driver + PostgreSQL 的默认行为本就正确，移除错误代码不会引入新问题
- 无需数据迁移，现有数据库中因 workaround 产生的错误数据暂不处理
