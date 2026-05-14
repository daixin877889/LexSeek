---
paths:
  - "shared/types/**"
  - "**/*.ts"
---

# 类型定义规范

## 类型决策流程

```
需要定义新类型？
    │
    ├─ 是数据库实体？ → 使用 Prisma 生成的类型
    │   └─ 通过 `#shared/types/prisma` 导入
    │
    ├─ 双端共用？ → 放入 `shared/types/`
    │   └─ 按业务领域组织文件（case.ts、payment.ts 等）
    │
    ├─ server/lib 模块内部类型？ → 放入模块内 types.ts
    │
    ├─ 客户端专用？ → 放入 composables 或组件文件
    │
    └─ 服务端专用？ → 放入 server/services 对应文件
```

## shared/types 目录结构

```
shared/types/
├── prisma.ts            # 重新导出 generated/prisma/client 中的所有类型
├── case.ts              # 案件相关类型
├── payment.ts           # 支付相关类型
├── membership.ts        # 会员相关类型
├── benefit.ts           # 会员权益类型
├── file.ts              # 文件相关类型
├── user.ts              # 用户相关类型
├── rbac.ts              # RBAC 角色/权限类型
├── oss.ts               # OSS 相关类型
├── memory.ts            # 案件记忆类型
├── agentEvent.ts        # Agent 事件 / Session Scope/Type 等
├── agentRun.ts          # Agent 任务运行类型
├── agentAudit.ts        # Agent 审计日志类型
├── assistant.ts         # 通用问答类型
├── contract.ts          # 合同审查类型
├── document.ts          # 文档起草类型
├── legal.ts、legal-search.ts、legal-parser.ts  # 法律法规
├── material.ts          # 案件素材类型
├── model.ts、node.ts    # 模型 / 节点
├── point.types.ts       # 积分类型
├── product.ts、redemption.ts、campaign.ts  # 商品 / 兑换 / 营销
├── prompt.ts            # 提示词类型
├── recognition.ts       # OCR/ASR 识别类型
├── skill.ts             # Agent skills 类型
├── sms.ts、captcha.ts、aliSms.d.ts           # 短信 / 验证码
├── system.ts、dashboard.ts、tools.ts         # 系统 / 看板 / 工具
└── …                   # 按业务领域继续扩展
```

## 导入规范

### 类型导入（必须手动导入）

```typescript
// ✅ 正确
import type { CaseStatus, PartyInfo } from '#shared/types/case'
import type { cases, users, orders } from '~~/generated/prisma/client'
// 通过 #shared 别名访问 prisma 类型也可以（shared/types/prisma.ts 重导出了 generated/prisma/client）
import type { cases } from '#shared/types/prisma'

// ❌ 错误
import { CaseStatus } from '~~/server/services/case/case.dao'   // 业务模块不应导出共用类型
```

### 枚举定义

**数字枚举**（与数据库一致）：
```typescript
export enum CaseStatus {
  IN_PROGRESS = 1,
  COMPLETED = 2,
  CLOSED = 3,
}

export const CaseStatusText: Record<CaseStatus, string> = {
  [CaseStatus.IN_PROGRESS]: '进行中',
  [CaseStatus.COMPLETED]: '已完成',
  [CaseStatus.CLOSED]: '已关闭',
}
```

**字符串枚举**（用于 API 通信）：
```typescript
export enum SSEMessageType {
  CONNECTED = 'connected',
  HEARTBEAT = 'heartbeat',
}
```

## 接口定义

### 基于 Prisma 类型派生
```typescript
import type { cases } from '~~/generated/prisma/client'

export type CreateCaseInput = Omit<cases, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
export type UpdateCaseInput = Partial<Pick<cases, 'title' | 'content' | 'status'>>
```

## 禁止事项

- ❌ 在多个文件中定义相同的枚举
- ❌ 在服务文件中定义双端共用的类型
- ❌ 使用 `any` 类型
- ❌ 忽略 TypeScript 类型错误
