---
inclusion: manual
---

# 类型定义规范

## 类型定义决策流程

```
需要定义新类型？
    │
    ├─ 是数据库实体？ → 使用 Prisma 生成的类型
    │   └─ 通过 `#shared/types/prisma` 或 `~~/generated/prisma/client` 导入
    │
    ├─ 双端共用？ → 放入 `shared/types/`
    │   └─ 按业务领域组织文件（case.ts、material.ts 等）
    │
    ├─ server/lib 模块内部类型？ → 放入模块内 types.ts
    │   └─ 通过 index.ts 导出
    │
    ├─ 客户端专用？ → 放入 composables 或组件文件
    │
    └─ 服务端专用？ → 放入 server/services 对应文件
```

## 类型文件组织

### shared/types 目录结构

```
shared/types/
├── prisma.ts           # 重新导出 Prisma 类型
├── case.ts             # 案件相关类型（状态、SSE、工作流）
├── material.ts         # 材料相关类型
├── payment.ts          # 支付相关类型
├── membership.ts       # 会员相关类型
├── file.ts             # 文件相关类型
├── user.ts             # 用户相关类型
├── rbac.ts             # 权限相关类型
├── oss.ts              # OSS 相关类型
├── legal.ts            # 法律相关类型
└── tools.ts            # 工具计算相关类型
```

## 导入规范

### 类型导入（必须手动导入）

```typescript
// ✅ 正确：使用 import type 和 #shared 别名
import type { CaseStatus, PartyInfo } from '#shared/types/case'
import type { MaterialType, MaterialStatus } from '#shared/types/material'

// ✅ 正确：导入枚举值（需要运行时使用）
import { CaseStatus, SSEMessageType } from '#shared/types/case'

// ❌ 错误：不要从服务文件导入类型
import { CaseStatus } from '~/server/services/case/case.dao'
```

### Prisma 类型导入

```typescript
// ✅ 正确：从 generated 目录导入
import type { cases, caseSessions, Prisma } from '~~/generated/prisma/client'

// ✅ 正确：从 shared/types/prisma 导入（如果有重新导出）
import type { cases } from '#shared/types/prisma'
```

## 枚举定义规范

### 数字枚举（与数据库一致）

```typescript
/** 案件状态枚举 */
export enum CaseStatus {
    /** 进行中 */
    IN_PROGRESS = 1,
    /** 已完成 */
    COMPLETED = 2,
    /** 已关闭 */
    CLOSED = 3,
}

/** 状态文本映射 */
export const CaseStatusText: Record<CaseStatus, string> = {
    [CaseStatus.IN_PROGRESS]: '进行中',
    [CaseStatus.COMPLETED]: '已完成',
    [CaseStatus.CLOSED]: '已关闭',
}
```

### 字符串枚举（用于 API 通信）

```typescript
/** SSE 消息类型 */
export enum SSEMessageType {
    CONNECTED = 'connected',
    HEARTBEAT = 'heartbeat',
    WORKFLOW_START = 'workflow:start',
    // ...
}
```

### 字符串字面量联合类型（简单状态）

```typescript
/** 前端 UI 状态 */
export type MaterialUIStatus = 'pending' | 'processing' | 'ready' | 'error' | 'uploaded'
```

## 接口定义规范

### 基于 Prisma 类型派生

```typescript
import type { cases } from '~~/generated/prisma/client'

// 创建输入（排除自动生成的字段）
export type CreateCaseInput = Omit<cases, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>

// 更新输入（部分字段可选）
export type UpdateCaseInput = Partial<Pick<cases, 'title' | 'content' | 'status'>>

// 包含关联数据
export interface CaseWithRelations extends cases {
    caseType?: { id: number; name: string }
    caseSessions?: caseSessions[]
}
```

### API 请求/响应类型

```typescript
/** 创建案件请求 */
export interface CreateCaseRequest {
    title: string
    content?: string
    caseTypeId: number
    plaintiff?: PartyInfo[]
    defendant?: PartyInfo[]
}

/** 案件列表查询参数 */
export interface CaseListParams {
    page?: number
    pageSize?: number
    status?: CaseStatus
    keyword?: string
}
```

## 重新导出规范

当服务文件需要使用共享类型时，可以重新导出以保持向后兼容：

```typescript
// server/services/case/case.dao.ts
import {
    CaseStatus,
    SessionStatus,
    type PartyInfo,
    type CreateCaseInput,
} from '#shared/types/case'

// 重新导出，保持向后兼容
export { CaseStatus, SessionStatus }
export type { PartyInfo, CreateCaseInput }
```

## 常见场景

### 场景 1：添加新的业务状态

1. 在 `shared/types/` 对应文件中定义枚举
2. 添加状态文本映射
3. 更新相关服务文件的导入

### 场景 2：添加 API 请求类型

1. 在 `shared/types/` 对应文件中定义接口
2. 服务端和客户端都从 `#shared/types/xxx` 导入

### 场景 3：添加客户端专用状态

1. 在 composable 或组件文件中定义
2. 如果多个组件共用，考虑迁移到 `shared/types/`

## 禁止事项

- ❌ 在多个文件中定义相同的枚举
- ❌ 在服务文件中定义双端共用的类型
- ❌ 使用 `any` 类型（除非确实无法确定类型）
- ❌ 忽略 TypeScript 类型错误
