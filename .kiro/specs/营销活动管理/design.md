# 设计文档

## 概述

本设计文档描述了 LexSeek 营销活动管理系统的技术架构和实现方案。

## 架构

### 目录结构

```
server/
├── api/v1/
│   ├── campaigns/             # 营销活动 API
│   └── redemption-codes/      # 兑换码 API
├── services/
│   ├── campaign/              # 营销活动服务
│   │   ├── campaign.dao.ts
│   │   └── campaign.service.ts
│   └── redemption/            # 兑换码服务
│       ├── redemptionCode.dao.ts
│       ├── redemptionRecord.dao.ts
│       └── redemption.service.ts
app/pages/admin/
├── campaigns/                 # 营销活动管理页面
└── redemption-codes/          # 兑换码管理页面
```

## 数据模型

### 营销活动表 (campaigns)

```prisma
model campaigns {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(100)
    type        Int                                 // 1-注册赠送，2-邀请奖励，3-活动奖励
    levelId     Int?      @map("level_id")
    duration    Int?
    giftPoint   Int?      @map("gift_point")
    startAt     DateTime  @map("start_at")
    endAt       DateTime  @map("end_at")
    status      Int       @default(1)
    
    @@map("campaigns")
}
```

### 兑换码表 (redemptionCodes)

```prisma
model redemptionCodes {
    id          Int       @id @default(autoincrement())
    code        String    @unique @db.VarChar(32)
    type        Int                                 // 1-仅会员，2-仅积分，3-会员和积分
    levelId     Int?      @map("level_id")
    duration    Int?
    pointAmount Int?      @map("point_amount")
    expiredAt   DateTime? @map("expired_at")
    status      Int       @default(1)               // 1-有效，2-已使用，3-已过期，4-已作废
    
    @@map("redemption_codes")
}
```

## 正确性属性

### Property 1: 营销活动有效期控制

*For any* 营销活动，当 startAt > 当前时间 或 endAt < 当前时间 或 status=0 时，SHALL 不执行任何奖励逻辑。

**Validates: Requirements 1.4, 1.5, 2.3, 3.3**

### Property 2: 兑换码兑换正确性

*For any* 有效兑换码兑换操作，兑换成功后兑换码状态 SHALL 变为已使用。

**Validates: Requirements 5.5**

### Property 3: 无效兑换码拒绝

*For any* 已使用、已过期或已作废的兑换码，兑换操作 SHALL 被拒绝。

**Validates: Requirements 5.6**

## 实现状态

所有组件已完成实现和测试。

### 相关文件

**服务层**:
- `server/services/campaign/campaign.dao.ts`
- `server/services/campaign/campaign.service.ts`
- `server/services/redemption/redemptionCode.dao.ts`
- `server/services/redemption/redemption.service.ts`

**API 层**:
- `server/api/v1/campaigns/*.ts`
- `server/api/v1/redemption-codes/*.ts`

**前端**:
- `app/pages/admin/campaigns/*.vue`
- `app/pages/admin/redemption-codes/*.vue`
