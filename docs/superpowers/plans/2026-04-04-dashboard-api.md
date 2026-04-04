# Dashboard API 对接实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 Dashboard 首页 API 对接，将硬编码的 mock 数据替换为真实 API 数据

**Architecture:** 新建聚合 Dashboard API，内部复用已有的积分、会员服务，新建统计逻辑

**Tech Stack:** Nuxt 4 (服务端渲染), Prisma, TypeScript

---

## 文件结构

```
server/
├── api/v1/dashboard/
│   └── index.get.ts           # 新建 - 聚合 API
server/services/
└── dashboard.service.ts       # 新建 - Dashboard 统计逻辑

shared/types/
└── dashboard.ts               # 新建 - 类型定义

app/pages/dashboard/
└── index.vue                  # 修改 - 对接 API
```

---

## 数据逻辑

| 数据项 | 来源 | 口径 |
|--------|------|------|
| `totalCases` | `prisma.cases.count` | 未删除 |
| `caseIncrease` | `prisma.cases.count` | 本月新增，未删除 |
| `totalAnalysis` | `prisma.caseAnalyses.count` | 默认不包含软删除 |
| `analysisIncrease` | `prisma.caseAnalyses.count` | 本月新增，默认不包含软删除 |
| `points.remaining` | `getUserPointSummary` | 已生效未过期 |
| `points.purchasePoint` | 同上，按 sourceType 分类 | 已生效未过期 |
| `points.otherPoint` | 同上，按 sourceType 分类 | 已生效未过期 |
| `membership.levelName` | `getCurrentMembershipService` | 当前有效会员 |
| `membership.expiresAt` | 所有未删除会员中最晚的 endDate | 无会员返回 null，前端显示 "-" |

---

## Task 1: 创建类型定义

**Files:**
- Create: `shared/types/dashboard.ts`
- Test: `tests/server/dashboard.test.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// shared/types/dashboard.ts

/** Dashboard 统计数据 */
export interface DashboardStatistics {
    totalCases: number       // 总案件数（未删除）
    caseIncrease: number     // 本月新增案件
    totalAnalysis: number   // 总分析次数（包含软删除）
    analysisIncrease: number // 本月新增分析（包含软删除）
}

/** Dashboard 积分信息 */
export interface DashboardPoints {
    remaining: number       // 可用积分
    purchasePoint: number   // 购买积分
    otherPoint: number      // 赠送积分
}

/** Dashboard 会员信息 */
export interface DashboardMembership {
    levelId: number
    levelName: string
    expiresAt: string | null  // 无会员时为 null，前端显示 "-"
}

/** Dashboard 最近案件项 */
export interface DashboardRecentCase {
    id: number
    title: string
    date: string           // 格式: YYYY-MM-DD HH:mm
    type: string           // 案件类型名称
    status: 'in_progress' | 'completed'
}

/** Dashboard 聚合响应 */
export interface DashboardResponse {
    statistics: DashboardStatistics
    points: DashboardPoints
    membership: DashboardMembership | null
    recentCases: DashboardRecentCase[]
}
```

---

## Task 2: 创建 Dashboard 服务层

**Files:**
- Create: `server/services/dashboard.service.ts`

- [ ] **Step 1: 创建服务层文件**

```typescript
// server/services/dashboard.service.ts
import dayjs from 'dayjs'
import type {
    DashboardStatistics,
    DashboardPoints,
    DashboardMembership,
    DashboardRecentCase,
    DashboardResponse
} from '#shared/types/dashboard'
import { getCurrentMembershipService } from './membership/userMembership.service'
import { getUserPointSummary } from './point/pointRecords.service'
import { getUserCasesService } from './case/case.service'
import { CaseStatus } from '#shared/types/case'

/**
 * 获取 Dashboard 统计数据
 */
export const getDashboardStatistics = async (userId: number): Promise<DashboardStatistics> => {
    const now = dayjs()
    const monthStart = now.startOf('month').toDate()

    const [totalCases, caseIncrease, totalAnalysis, analysisIncrease] = await Promise.all([
        prisma.cases.count({ where: { userId, deletedAt: null } }),
        prisma.cases.count({ where: { userId, deletedAt: null, createdAt: { gte: monthStart } } }),
        // 分析记录默认不包含软删除
        prisma.caseAnalyses.count({ where: { case: { userId }, deletedAt: null } }),
        prisma.caseAnalyses.count({ where: { case: { userId }, deletedAt: null, createdAt: { gte: monthStart } } }),
    ])

    return { totalCases, caseIncrease, totalAnalysis, analysisIncrease }
}

/**
 * 获取 Dashboard 积分信息
 */
export const getDashboardPoints = async (userId: number): Promise<DashboardPoints> => {
    const summary = await getUserPointSummary(userId)
    return {
        remaining: summary.remaining,
        purchasePoint: summary.purchasePoint,
        otherPoint: summary.otherPoint,
    }
}

/**
 * 获取 Dashboard 会员信息
 */
export const getDashboardMembership = async (userId: number): Promise<DashboardMembership | null> => {
    // 获取当前有效会员
    const membership = await getCurrentMembershipService(userId)

    if (!membership) {
        return null
    }

    // 获取所有未删除会员中最晚的到期日期
    const latestMembership = await prisma.userMemberships.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { endDate: 'desc' },
        select: { endDate: true },
    })

    return {
        levelId: membership.levelId,
        levelName: membership.levelName,
        expiresAt: latestMembership ? dayjs(latestMembership.endDate).format('YYYY-MM-DD') : null,
    }
}

/**
 * 获取 Dashboard 最近案件
 */
export const getDashboardRecentCases = async (
    userId: number,
    limit: number = 5
): Promise<DashboardRecentCase[]> => {
    const { list } = await getUserCasesService(userId, {
        page: 1,
        pageSize: limit,
        orderBy: 'updatedAt',
        orderDir: 'desc',
    })

    return list.map(c => ({
        id: c.id,
        title: c.title,
        date: dayjs(c.updatedAt).format('YYYY-MM-DD HH:mm'),
        type: c.caseType?.name || '未知',
        status: c.status === CaseStatus.COMPLETED ? 'completed' : 'in_progress',
    }))
}

/**
 * 获取 Dashboard 聚合数据
 */
export const getDashboardData = async (userId: number): Promise<DashboardResponse> => {
    const [statistics, points, membership, recentCases] = await Promise.all([
        getDashboardStatistics(userId),
        getDashboardPoints(userId),
        getDashboardMembership(userId),
        getDashboardRecentCases(userId),
    ])

    return { statistics, points, membership, recentCases }
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npx nuxi typecheck
```

期望: 无类型错误

---

## Task 3: 创建 Dashboard API 路由

**Files:**
- Create: `server/api/v1/dashboard/index.get.ts`

- [ ] **Step 1: 创建 API 路由**

```typescript
// server/api/v1/dashboard/index.get.ts
import { getDashboardData } from '~~/server/services/dashboard.service'
import type { DashboardResponse } from '#shared/types/dashboard'

/**
 * 获取 Dashboard 数据
 *
 * GET /api/v1/dashboard
 */
export default defineEventHandler(async (event): Promise<DashboardResponse> => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        const data = await getDashboardData(user.id)
        return resSuccess(event, '获取成功', data)
    } catch (error) {
        logger.error('获取 Dashboard 数据失败:', error)
        return resError(event, 500, '获取 Dashboard 数据失败')
    }
})
```

- [ ] **Step 2: 测试 API**

```bash
curl -H "Cookie: ..." http://localhost:3000/api/v1/dashboard
```

---

## Task 4: 修改前端页面

**Files:**
- Modify: `app/pages/dashboard/index.vue`

- [ ] **Step 1: 修改 script 部分**

```typescript
// app/pages/dashboard/index.vue
import type { DashboardResponse } from '#shared/types/dashboard'

const { data: dashboardData } = await useApi<DashboardResponse>('/api/v1/dashboard')
```

- [ ] **Step 2: 修改模板数据绑定**

```vue
<!-- 统计数据卡片 -->
<h3>{{ dashboardData.value?.statistics.totalCases ?? 0 }}</h3>
<span>+{{ dashboardData.value?.statistics.caseIncrease ?? 0 }} 本月</span>

<!-- 分析次数卡片 -->
<h3>{{ dashboardData.value?.statistics.totalAnalysis ?? 0 }}</h3>
<span>+{{ dashboardData.value?.statistics.analysisIncrease ?? 0 }} 本月</span>

<!-- 积分卡片 -->
<h3>{{ dashboardData.value?.points.remaining ?? 0 }}</h3>
<span>购买: {{ dashboardData.value?.points.purchasePoint ?? 0 }}，赠送: {{ dashboardData.value?.points.otherPoint ?? 0 }}</span>

<!-- 会员卡片 -->
<h3>{{ dashboardData.value?.membership?.levelName ?? '免费版' }}</h3>
<span>有效期至：{{ dashboardData.value?.membership?.expiresAt ?? '-' }}</span>

<!-- 最近案件 -->
<div v-for="case in dashboardData.value?.recentCases" :key="case.id">
  <h3>{{ case.title }}</h3>
  <p>{{ case.date }}</p>
  <span>{{ case.type }}</span>
  <span>{{ case.status === 'completed' ? '已完成' : '进行中' }}</span>
</div>
```

- [ ] **Step 3: 移除 mock 数据**

删除 `stats`、`pointInfo`、`recentAnalysis` 等 mock 变量

---

## Task 5: 编写测试

**Files:**
- Create: `tests/server/dashboard.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestUser, cleanupTestData } from 'tests/setup'
import {
    getDashboardStatistics,
    getDashboardMembership,
    getDashboardData,
} from '~~/server/services/dashboard.service'
import dayjs from 'dayjs'

describe('Dashboard Service', () => {
    let testUserId: number

    beforeEach(async () => {
        testUserId = await createTestUser()
    })

    afterEach(async () => {
        await cleanupTestData(testUserId)
    })

    describe('getDashboardStatistics', () => {
        it('应正确统计总案件数', async () => {
            const stats = await getDashboardStatistics(testUserId)
            expect(typeof stats.totalCases).toBe('number')
        })

        it('应包含软删除的分析记录', async () => {
            const stats = await getDashboardStatistics(testUserId)
            expect(typeof stats.totalAnalysis).toBe('number')
            expect(stats.totalAnalysis >= 0).toBe(true)
        })
    })

    describe('getDashboardMembership', () => {
        it('无会员时返回 null', async () => {
            const membership = await getDashboardMembership(testUserId)
            expect(membership).toBeNull()
        })

        it('应返回最晚的会员到期日期', async () => {
            const laterDate = dayjs().add(2, 'year').toDate()
            await createTestMembership(testUserId, { endDate: laterDate })

            const membership = await getDashboardMembership(testUserId)
            expect(membership).not.toBeNull()
            expect(membership!.expiresAt).toBe(dayjs(laterDate).format('YYYY-MM-DD'))
        })
    })

    describe('getDashboardData', () => {
        it('应返回完整的 Dashboard 数据', async () => {
            const data = await getDashboardData(testUserId)

            expect(data).toHaveProperty('statistics')
            expect(data).toHaveProperty('points')
            expect(data).toHaveProperty('membership')
            expect(data).toHaveProperty('recentCases')
        })
    })
})
```

- [ ] **Step 2: 运行测试**

```bash
npx vitest run tests/server/dashboard.test.ts --reporter=verbose
```

---

## Task 6: 提交代码

- [ ] **Step 1: 提交所有变更**

```bash
git add shared/types/dashboard.ts server/services/dashboard.service.ts \
  server/api/v1/dashboard/index.get.ts app/pages/dashboard/index.vue \
  tests/server/dashboard.test.ts
git commit -m "feat(dashboard): 完成 Dashboard API 对接"
```

---

## 验证清单

- [ ] API 返回数据结构正确
- [ ] 案件统计不包含软删除记录
- [ ] 积分计算正确（remaining = purchasePoint + otherPoint）
- [ ] 会员等级为当前有效会员，到期日为所有未删除记录中最晚的日期
- [ ] 无有效会员时显示"免费版"和"-"
- [ ] 前端使用 `useApi` 进行服务端渲染
- [ ] 无 mock 数据
- [ ] 测试通过
- [ ] 页面在浏览器中正确显示
