# Dashboard API 对接设计

**日期:** 2026-04-04
**状态:** 已对齐

---

## 1. 概述

**目标:** 完成 Dashboard 首页 API 对接，将硬编码的 mock 数据替换为真实 API 数据

**背景:** 当前 `/dashboard` 页面使用硬编码的 mock 数据，需要对接真实后端 API

---

## 2. 数据逻辑

| 数据项 | 来源 | 口径 |
|--------|------|------|
| `totalCases` | `prisma.cases.count` | 未删除 |
| `caseIncrease` | `prisma.cases.count` | 本月新增，未删除 |
| `totalAnalysis` | `prisma.caseAnalyses.count` | 默认不包含软删除，可通过参数控制 |
| `analysisIncrease` | `prisma.caseAnalyses.count` | 本月新增，默认不包含软删除 |
| `points.remaining` | `getUserPointSummary` | 已生效未过期 |
| `points.purchasePoint` | 同上，按 sourceType 分类 | 已生效未过期 |
| `points.otherPoint` | 同上，按 sourceType 分类 | 已生效未过期 |
| `membership.levelName` | 当前有效会员的 levelName | 无有效会员显示"免费版" |
| `membership.expiresAt` | 当前有效会员的 endDate | 无有效会员显示 null（前端显示"-"） |

**会员有效性判断**: `endDate >= today` 且 `deletedAt = null`

---

## 3. API 设计

### 3.1 端点

```
GET /api/v1/dashboard
```

### 3.2 认证

需要用户登录，通过 `event.context.auth?.user` 获取

### 3.3 响应结构

```json
{
  "code": 200,
  "message": "获取成功",
  "data": {
    "statistics": {
      "totalCases": 38,
      "caseIncrease": 2,
      "totalAnalysis": 329,
      "analysisIncrease": 4
    },
    "points": {
      "remaining": 6236,
      "purchasePoint": 0,
      "otherPoint": 6236
    },
    "membership": {
      "levelId": 1,
      "levelName": "旗舰版",
      "expiresAt": "2029-06-15"
    },
    "recentCases": [
      {
        "id": 1,
        "title": "王某月诉薛某亮案",
        "date": "2026-03-20 14:22",
        "type": "民商事案件",
        "status": "completed"
      }
    ]
  }
}
```

---

## 4. 类型定义

### 4.1 DashboardStatistics

```typescript
interface DashboardStatistics {
  totalCases: number       // 总案件数（未删除）
  caseIncrease: number     // 本月新增案件
  totalAnalysis: number   // 总分析次数（默认不包含软删除）
  analysisIncrease: number // 本月新增分析（默认不包含软删除）
}
```

### 4.2 DashboardPoints

```typescript
interface DashboardPoints {
  remaining: number    // 可用积分
  purchasePoint: number // 购买积分
  otherPoint: number    // 赠送积分
}
```

### 4.3 DashboardMembership

```typescript
interface DashboardMembership {
  levelId: number
  levelName: string       // 无有效会员时显示 "免费版"
  expiresAt: string | null  // 无有效会员时为 null，前端显示 "-"
}
```

**注意**: `levelName` 和 `expiresAt` 均来自"当前有效会员"（`endDate >= today` 且 `deletedAt = null`）

### 4.4 DashboardRecentCase

```typescript
interface DashboardRecentCase {
  id: number
  title: string
  date: string           // YYYY-MM-DD HH:mm
  type: string
  status: 'in_progress' | 'completed'
}
```

### 4.5 DashboardResponse

```typescript
interface DashboardResponse {
  statistics: DashboardStatistics
  points: DashboardPoints
  membership: DashboardMembership | null
  recentCases: DashboardRecentCase[]
}
```

---

## 5. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `shared/types/dashboard.ts` | 新建 | 类型定义 |
| `server/services/dashboard.service.ts` | 新建 | 服务层 |
| `server/api/v1/dashboard/index.get.ts` | 新建 | API 路由 |
| `app/pages/dashboard/index.vue` | 修改 | 前端对接 |
| `tests/server/dashboard.test.ts` | 新建 | 测试 |

---

## 6. 前端对接

### 6.1 渲染方式

使用 `useApi` 进行服务端渲染（SSR）

### 6.2 模板修改

将 mock 数据替换为 API 返回数据，绑定到 `dashboardData` 变量

### 6.3 空值处理

| 字段 | 空值显示 |
|------|----------|
| `statistics.totalCases` | 0 |
| `membership.levelName` | "免费版" |
| `membership.expiresAt` | "-" |
| `recentCases` | 空数组 |

---

## 7. 实现计划

详见: `docs/superpowers/plans/2026-04-04-dashboard-api.md`
