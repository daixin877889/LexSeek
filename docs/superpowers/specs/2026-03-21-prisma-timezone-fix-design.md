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

移除 `server/utils/db.ts` 中的所有时区处理逻辑，恢复为普通的 Prisma client。

## 改动详情

### `server/utils/db.ts`

删除所有时区处理代码：

- 删除 `SHANGHAI_OFFSET_MS` 常量
- 删除 `toShanghaiDate()` 函数
- 删除 `fromShanghaiDate()` 函数
- 删除 `convertDatesForWrite()` 函数
- 删除 `convertDatesForRead()` 函数
- 删除 `convertQueryArgs()` 函数
- 删除 `$extends` 扩展，简化为普通 Prisma client

### `vitest.config.ts`

保持不变。测试环境的 Prisma client 本来就没有 workaround 扩展，行为与修复后的生产环境一致。

## 原理说明

修复后的时间流程：

1. **应用层**: `new Date()` 创建 UTC 时间（如 `2026-03-21T01:14:53.310Z`）
2. **pg driver**: 在 Shanghai 时区下，序列化时使用 `date.getHours()` 等本地组件，输出 `2026-03-21T09:14:53.310+08:00`
3. **PostgreSQL**: 收到 `+08:00` 字符串，正确转换为 UTC `2026-03-21T01:14:53.310Z` 存储
4. **读取**: pg driver 反解析数据库返回的字符串为 JavaScript `Date`（UTC）
5. **前端**: `toISOString()` 显示 UTC 时间

## 验证方式

1. 写入一条带明确时间的记录，验证数据库中存储的 UTC 时间正确
2. 读取该记录，验证应用层 `Date` 对象正确
3. 前端显示的时间正确
4. 运行测试套件，确保全部通过（`npx vitest run`）

## 风险评估

- **风险等级**: 低
- pg driver + PostgreSQL 的默认行为本就正确，移除错误代码不会引入新问题
- 无需数据迁移，现有数据库中因 workaround 产生的错误数据暂不处理
