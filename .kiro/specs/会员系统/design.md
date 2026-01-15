# 设计文档

## 概述

本设计文档描述了 LexSeek 会员系统的技术架构和实现方案。系统基于 Nuxt.js 4 全栈框架，采用 Prisma ORM 进行数据库操作，遵循项目现有的分层架构（API 层、Service 层、DAO 层）。

## 架构

### 整体架构

```mermaid
graph TB
    subgraph "前端层"
        A[会员页面] --> B[会员 Store]
        C[权益页面] --> D[权益 Store]
    end
    
    subgraph "API 层"
        E[/api/v1/memberships/*]
        F[/api/v1/users/benefits/*]
    end
    
    subgraph "Service 层"
        G[MembershipService]
        H[BenefitService]
        I[MembershipUpgradeService]
    end
    
    subgraph "DAO 层"
        J[MembershipLevelDAO]
        K[UserMembershipDAO]
        L[BenefitDAO]
        M[UserBenefitDAO]
    end
    
    subgraph "数据库"
        N[(PostgreSQL)]
    end
    
    B --> E
    D --> F
    E --> G & I
    F --> H
    G --> J & K
    H --> L & M
    I --> K & G
    J & K & L & M --> N
```

### 目录结构

```
server/
├── api/v1/
│   ├── memberships/           # 会员相关 API
│   │   ├── levels/            # 会员级别
│   │   ├── me/                # 当前用户会员信息
│   │   ├── history/           # 会员历史
│   │   ├── benefits/          # 权益
│   │   └── upgrade/           # 会员升级
│   └── users/
│       └── benefits/          # 用户权益 API
├── services/
│   └── membership/            # 会员服务
│       ├── membershipLevel.dao.ts
│       ├── userMembership.dao.ts
│       ├── userMembership.service.ts
│       ├── benefit.dao.ts
│       ├── userBenefit.dao.ts
│       ├── benefit.service.ts
│       └── membershipUpgrade.service.ts
prisma/models/
└── membership.prisma          # 会员相关模型
shared/types/
└── membership.ts              # 会员类型定义
```

## 组件和接口

### 会员服务接口

```typescript
// server/services/membership/userMembership.service.ts
export interface UserMembershipService {
  getCurrentMembership(userId: number): Promise<UserMembership | null>;
  getMembershipHistory(userId: number): Promise<UserMembership[]>;
  createMembership(params: CreateMembershipParams): Promise<UserMembership>;
  getUserBenefits(userId: number): Promise<UserBenefit[]>;
  calculateUpgradePrice(membershipId: number, targetLevelId: number): Promise<UpgradePriceResult>;
  upgradeMembership(membershipId: number, targetLevelId: number, paymentOrderId: number): Promise<UserMembership>;
}
```

### 权益服务接口

```typescript
// server/services/membership/benefit.service.ts
export interface BenefitService {
  getUserBenefits(userId: number): Promise<UserBenefitSummary[]>;
  getUserBenefitByCode(userId: number, benefitCode: string): Promise<UserBenefitDetail>;
  grantMembershipBenefits(userId: number, membershipId: number): Promise<void>;
  checkStorageQuota(userId: number, fileSize: number): Promise<StorageQuotaResult>;
}
```

## 数据模型

### 会员级别表 (membershipLevels)

```prisma
model membershipLevels {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(50)
    description String?   @db.VarChar(255)
    sortOrder   Int       @default(0) @map("sort_order")
    status      Int       @default(1)
    createdAt   DateTime  @default(now()) @map("created_at")
    updatedAt   DateTime  @default(now()) @map("updated_at")
    deletedAt   DateTime? @map("deleted_at")
    
    userMemberships userMemberships[]
    membershipBenefits membershipBenefits[]
    
    @@map("membership_levels")
}
```

### 用户会员记录表 (userMemberships)

```prisma
model userMemberships {
    id          Int       @id @default(autoincrement())
    userId      Int       @map("user_id")
    levelId     Int       @map("level_id")
    startDate   DateTime  @map("start_date")
    endDate     DateTime  @map("end_date")
    autoRenew   Boolean   @default(false) @map("auto_renew")
    status      Int       @default(1)
    sourceType  Int       @map("source_type")
    sourceId    Int?      @map("source_id")
    remark      String?   @db.VarChar(255)
    createdAt   DateTime  @default(now()) @map("created_at")
    updatedAt   DateTime  @default(now()) @map("updated_at")
    deletedAt   DateTime? @map("deleted_at")
    
    user users @relation(fields: [userId], references: [id])
    level membershipLevels @relation(fields: [levelId], references: [id])
    
    @@map("user_memberships")
}
```

### 权益表 (benefits)

```prisma
model benefits {
    id           Int       @id @default(autoincrement())
    code         String    @unique @db.VarChar(50)
    name         String    @db.VarChar(100)
    description  String?   @db.VarChar(255)
    unitType     String    @map("unit_type") @db.VarChar(20)
    minUnit      String    @map("min_unit") @db.VarChar(20)
    consumeMode  String    @map("consume_mode") @db.VarChar(10)
    defaultValue BigInt    @default(0) @map("default_value")
    status       Int       @default(1)
    createdAt    DateTime  @default(now()) @map("created_at")
    updatedAt    DateTime  @default(now()) @map("updated_at")
    deletedAt    DateTime? @map("deleted_at")
    
    membershipBenefits membershipBenefits[]
    userBenefits userBenefits[]
    
    @@map("benefits")
}
```

### 用户权益表 (userBenefits)

```prisma
model userBenefits {
    id          Int       @id @default(autoincrement())
    userId      Int       @map("user_id")
    benefitId   Int       @map("benefit_id")
    value       BigInt
    sourceType  String    @map("source_type") @db.VarChar(30)
    sourceId    Int?      @map("source_id")
    effectiveAt DateTime  @map("effective_at")
    expiredAt   DateTime  @map("expired_at")
    status      Int       @default(1)
    createdAt   DateTime  @default(now()) @map("created_at")
    updatedAt   DateTime  @default(now()) @map("updated_at")
    deletedAt   DateTime? @map("deleted_at")
    
    user users @relation(fields: [userId], references: [id])
    benefit benefits @relation(fields: [benefitId], references: [id])
    
    @@map("user_benefits")
}
```

## 正确性属性

### Property 1: 会员级别排序一致性

*For any* 会员级别列表，查询返回的结果 SHALL 按 sortOrder 字段升序排列。

**Validates: Requirements 1.3, 1.4**

### Property 2: 有效会员查询正确性

*For any* 用户，查询当前有效会员时 SHALL 只返回 status=1 且 endDate > 当前时间 的会员记录。

**Validates: Requirements 2.2, 2.5**

### Property 3: 升级价格计算正确性

*For any* 会员升级操作，升级价格 SHALL 等于 (目标级别剩余价值 - 原级别剩余价值)。

**Validates: Requirements 3.2, 3.3**

### Property 4: 会员升级状态转换

*For any* 成功的会员升级操作，原会员记录 SHALL 被标记为无效，新会员记录 SHALL 被创建。

**Validates: Requirements 3.4, 3.5**

### Property 5: 权益累加计算

*For any* 用户的云盘空间权益计算，结果 SHALL 等于所有生效中权益记录的 value 之和。

**Validates: Requirements 7.1, 7.3**

### Property 6: 存储配额校验

*For any* 文件上传请求，当 已使用空间 + 文件大小 > 权益总额 时，SHALL 拒绝上传。

**Validates: Requirements 9.1, 9.3**

### Property 7: 数据序列化往返

*For any* 有效的会员数据对象，序列化为 JSON 后再反序列化 SHALL 产生等价的对象。

**Validates: Requirements 11.1, 11.2, 11.3**

## 错误处理

| 错误码 | 错误名称 | 描述 |
|--------|----------|------|
| 40001 | MEMBERSHIP_LEVEL_NOT_FOUND | 会员级别不存在 |
| 40002 | MEMBERSHIP_NOT_FOUND | 会员记录不存在 |
| 40003 | MEMBERSHIP_EXPIRED | 会员已过期 |
| 40014 | UPGRADE_NOT_ALLOWED | 不允许升级 |
| 40020 | STORAGE_QUOTA_EXCEEDED | 存储空间不足 |

## 测试策略

### 单元测试

- DAO 层测试：测试数据库操作的正确性
- Service 层测试：测试业务逻辑的正确性

### 属性测试

- 使用 `fast-check` 库进行属性测试
- 每个属性测试至少运行 100 次迭代

### 集成测试

- API 集成测试：测试完整的 API 请求响应流程
- 会员升级测试：测试会员升级的完整流程

## 实现状态

所有组件已完成实现和测试。

### 相关文件

**服务层**:
- `server/services/membership/membershipLevel.dao.ts`
- `server/services/membership/userMembership.dao.ts`
- `server/services/membership/userMembership.service.ts`
- `server/services/membership/benefit.dao.ts`
- `server/services/membership/benefit.service.ts`
- `server/services/membership/membershipUpgrade.service.ts`

**API 层**:
- `server/api/v1/memberships/*.ts`
- `server/api/v1/users/benefits/*.ts`

**前端**:
- `app/pages/dashboard/membership/*.vue`
- `app/pages/admin/benefits/*.vue`
