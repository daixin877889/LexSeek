# 设计文档

## 概述

本设计文档描述了 LexSeek 会员系统的技术架构和实现方案。系统基于 Nuxt.js 4 全栈框架，采用 Prisma ORM 进行数据库操作，遵循项目现有的分层架构（API 层、Service 层、DAO 层）。

系统核心功能包括：
- 会员级别和权益管理
- 用户会员记录管理
- 营销活动管理（注册赠送、邀请奖励等）
- 兑换码管理
- 商品和支付管理
- 会员升级
- 与现有积分系统的深度集成

## 架构

### 整体架构

```mermaid
graph TB
    subgraph "前端层"
        A[会员页面] --> B[会员 Store]
        C[支付页面] --> D[支付 Store]
    end
    
    subgraph "API 层"
        E[/api/v1/memberships/*]
        F[/api/v1/products/*]
        G[/api/v1/payments/*]
        H[/api/v1/redemption-codes/*]
        I[/api/v1/campaigns/*]
    end
    
    subgraph "Service 层"
        J[MembershipService]
        K[ProductService]
        L[PaymentService]
        M[RedemptionService]
        N[CampaignService]
    end
    
    subgraph "DAO 层"
        O[MembershipLevelDAO]
        P[UserMembershipDAO]
        Q[BenefitDAO]
        R[ProductDAO]
        S[OrderDAO]
        S2[PaymentTransactionDAO]
        T[RedemptionCodeDAO]
        U[CampaignDAO]
    end
    
    subgraph "支付适配器"
        V[PaymentAdapter Interface]
        W[WechatPayAdapter]
        X[其他支付适配器...]
    end
    
    subgraph "数据库"
        Y[(PostgreSQL)]
    end
    
    B --> E
    D --> G
    E --> J
    F --> K
    G --> L
    H --> M
    I --> N
    J --> O & P & Q
    K --> R
    L --> S & S2 & V
    M --> T
    N --> U
    V --> W & X
    O & P & Q & R & S & S2 & T & U --> Y
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
│   ├── products/              # 商品 API
│   ├── payments/              # 支付 API
│   │   ├── create/            # 创建订单
│   │   ├── query/             # 查询订单
│   │   └── callback/          # 支付回调
│   ├── redemption-codes/      # 兑换码 API
│   └── campaigns/             # 营销活动 API
├── services/
│   ├── membership/            # 会员服务
│   │   ├── membershipLevel.dao.ts
│   │   ├── userMembership.dao.ts
│   │   ├── userMembership.service.ts
│   │   ├── benefit.dao.ts
│   │   ├── membershipBenefit.dao.ts
│   │   └── membershipUpgrade.service.ts
│   ├── product/               # 商品服务
│   │   └── product.dao.ts
│   ├── payment/               # 支付服务
│   │   ├── order.dao.ts
│   │   ├── order.service.ts
│   │   ├── paymentTransaction.dao.ts
│   │   ├── payment.service.ts
│   │   └── handlers/          # 支付成功处理器
│   │       ├── membershipHandler.ts
│   │       └── pointsHandler.ts
│   ├── redemption/            # 兑换码服务
│   │   ├── redemptionCode.dao.ts
│   │   ├── redemptionRecord.dao.ts
│   │   └── redemption.service.ts
│   └── campaign/              # 营销活动服务
│       ├── campaign.dao.ts
│       └── campaign.service.ts
├── lib/
│   └── payment/               # 支付适配器
│       ├── types.ts           # 类型定义
│       ├── base.ts            # 基类
│       ├── factory.ts         # 工厂
│       └── adapters/
│           └── wechat-pay.ts  # 微信支付适配器
prisma/models/
├── membership.prisma          # 会员相关模型
├── product.prisma             # 商品模型
├── payment.prisma             # 支付模型
├── redemption.prisma          # 兑换码模型
└── campaign.prisma            # 营销活动模型
shared/types/
├── membership.ts              # 会员类型定义
├── product.ts                 # 商品类型定义
├── payment.ts                 # 支付类型定义
├── redemption.ts              # 兑换码类型定义
└── campaign.ts                # 营销活动类型定义
```

## 组件和接口

### 支付适配器接口

```typescript
// server/lib/payment/types.ts

/** 支付渠道类型 */
export enum PaymentChannel {
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
}

/** 支付方式 */
export enum PaymentMethod {
  MINI_PROGRAM = 'mini_program',  // 小程序支付（微信JSAPI/支付宝小程序）
  SCAN_CODE = 'scan_code',        // 扫码支付（微信Native/支付宝当面付）
  WAP = 'wap',                    // 手机网页支付（微信H5/支付宝手机网站）
  APP = 'app',                    // APP支付
  PC = 'pc',                      // PC网页支付
}

/** 创建支付参数 */
export interface CreatePaymentParams {
  orderNo: string;           // 订单号
  amount: number;            // 金额（分）
  description: string;       // 商品描述
  method: PaymentMethod;     // 支付方式
  openid?: string;           // 用户 openid（JSAPI 必填）
  notifyUrl: string;         // 回调地址
}

/** 支付结果 */
export interface PaymentResult {
  success: boolean;
  paymentParams?: Record<string, any>;  // 前端支付参数
  errorMessage?: string;
}

/** 回调验证结果 */
export interface CallbackVerifyResult {
  success: boolean;
  orderNo?: string;
  transactionId?: string;
  amount?: number;
  errorMessage?: string;
}

/** 支付适配器接口 */
export interface PaymentAdapter {
  /** 获取支付渠道 */
  getChannel(): PaymentChannel;
  
  /** 创建支付 */
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;
  
  /** 验证回调 */
  verifyCallback(body: string, headers: Record<string, string>): Promise<CallbackVerifyResult>;
  
  /** 查询订单 */
  queryOrder(orderNo: string): Promise<CallbackVerifyResult>;
}
```

### 支付成功处理器接口

```typescript
// server/services/payment/handlers/types.ts

import type { PrismaClient } from '@prisma/client';
import type { paymentOrders } from '@prisma/client';

/** 支付成功处理器接口 */
export interface PaymentSuccessHandler {
  /** 获取处理的商品类型 */
  getProductType(): ProductType;
  
  /** 处理支付成功 */
  handle(order: paymentOrders, tx: PrismaClient): Promise<void>;
}
```

### 会员服务接口

```typescript
// server/services/membership/userMembership.service.ts

export interface UserMembershipService {
  /** 获取用户当前有效会员 */
  getCurrentMembership(userId: number): Promise<UserMembership | null>;
  
  /** 获取用户会员历史 */
  getMembershipHistory(userId: number): Promise<UserMembership[]>;
  
  /** 创建会员记录 */
  createMembership(params: CreateMembershipParams): Promise<UserMembership>;
  
  /** 获取用户权益 */
  getUserBenefits(userId: number): Promise<UserBenefit[]>;
  
  /** 计算升级价格 */
  calculateUpgradePrice(membershipId: number, targetLevelId: number): Promise<UpgradePriceResult>;
  
  /** 执行会员升级 */
  upgradeMembership(membershipId: number, targetLevelId: number, paymentOrderId: number): Promise<UserMembership>;
}
```

### 营销活动服务接口

```typescript
// server/services/campaign/campaign.service.ts

export interface CampaignService {
  /** 获取有效的营销活动 */
  getActiveCampaign(type: CampaignType): Promise<Campaign | null>;
  
  /** 执行注册赠送 */
  executeRegisterGift(userId: number): Promise<void>;
  
  /** 执行邀请奖励 */
  executeInvitationReward(inviterId: number, inviteeId: number): Promise<void>;
}
```

## 数据模型

### 会员级别表 (membershipLevels)

```prisma
model membershipLevels {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(50)           // 级别名称
    description String?   @db.VarChar(255)          // 级别描述
    sortOrder   Int       @default(0) @map("sort_order")  // 排序，数字越小级别越高
    status      Int       @default(1)               // 状态：1-启用，0-禁用
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    userMemberships userMemberships[]
    membershipBenefits membershipBenefits[]
    products products[]
    redemptionCodes redemptionCodes[]
    campaigns campaigns[]
    
    @@index([sortOrder], map: "idx_membership_levels_sort_order")
    @@index([status], map: "idx_membership_levels_status")
    @@index([deletedAt], map: "idx_membership_levels_deleted_at")
    @@map("membership_levels")
}
```

### 用户会员记录表 (userMemberships)

```prisma
model userMemberships {
    id          Int       @id @default(autoincrement())
    userId      Int       @map("user_id")           // 用户ID
    levelId     Int       @map("level_id")          // 会员级别ID
    startDate   DateTime  @map("start_date") @db.Timestamptz(6)  // 开始日期
    endDate     DateTime  @map("end_date") @db.Timestamptz(6)    // 到期日期
    autoRenew   Boolean   @default(false) @map("auto_renew")     // 是否自动续费
    status      Int       @default(1)               // 状态：1-有效，0-无效
    sourceType  Int       @map("source_type")       // 来源类型
    sourceId    Int?      @map("source_id")         // 来源ID
    remark      String?   @db.VarChar(255)          // 备注
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    user users @relation(fields: [userId], references: [id])
    level membershipLevels @relation(fields: [levelId], references: [id])
    pointRecords pointRecords[]
    membershipUpgradeRecordsFrom membershipUpgradeRecords[] @relation("FromMembership")
    membershipUpgradeRecordsTo membershipUpgradeRecords[] @relation("ToMembership")
    
    @@index([userId], map: "idx_user_memberships_user_id")
    @@index([levelId], map: "idx_user_memberships_level_id")
    @@index([status], map: "idx_user_memberships_status")
    @@index([endDate], map: "idx_user_memberships_end_date")
    @@index([deletedAt], map: "idx_user_memberships_deleted_at")
    @@map("user_memberships")
}
```

### 权益表 (benefits)

```prisma
model benefits {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(100)          // 权益名称
    description String?   @db.VarChar(255)          // 权益描述
    type        String    @db.VarChar(50)           // 权益类型
    value       Json?                               // 权益值
    status      Int       @default(1)               // 状态：1-启用，0-禁用
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    membershipBenefits membershipBenefits[]
    
    @@index([type], map: "idx_benefits_type")
    @@index([status], map: "idx_benefits_status")
    @@index([deletedAt], map: "idx_benefits_deleted_at")
    @@map("benefits")
}
```

### 会员权益关联表 (membershipBenefits)

```prisma
model membershipBenefits {
    id        Int       @id @default(autoincrement())
    levelId   Int       @map("level_id")            // 会员级别ID
    benefitId Int       @map("benefit_id")          // 权益ID
    createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    level membershipLevels @relation(fields: [levelId], references: [id])
    benefit benefits @relation(fields: [benefitId], references: [id])
    
    @@unique([levelId, benefitId])
    @@index([levelId], map: "idx_membership_benefits_level_id")
    @@index([benefitId], map: "idx_membership_benefits_benefit_id")
    @@index([deletedAt], map: "idx_membership_benefits_deleted_at")
    @@map("membership_benefits")
}
```

### 营销活动表 (campaigns)

```prisma
model campaigns {
    id          Int       @id @default(autoincrement())
    name        String    @db.VarChar(100)          // 活动名称
    type        Int                                 // 活动类型：1-注册赠送，2-邀请奖励，3-活动奖励
    levelId     Int?      @map("level_id")          // 赠送会员级别ID
    duration    Int?                                // 赠送会员时长（天）
    giftPoint   Int?      @map("gift_point")        // 赠送积分
    startAt     DateTime  @map("start_at") @db.Timestamptz(6)  // 活动开始时间
    endAt       DateTime  @map("end_at") @db.Timestamptz(6)    // 活动结束时间
    status      Int       @default(1)               // 状态：1-启用，0-禁用
    remark      String?   @db.VarChar(255)          // 备注
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    level membershipLevels? @relation(fields: [levelId], references: [id])
    
    @@index([type], map: "idx_campaigns_type")
    @@index([status], map: "idx_campaigns_status")
    @@index([startAt], map: "idx_campaigns_start_at")
    @@index([endAt], map: "idx_campaigns_end_at")
    @@index([deletedAt], map: "idx_campaigns_deleted_at")
    @@map("campaigns")
}
```

### 兑换码表 (redemptionCodes)

```prisma
model redemptionCodes {
    id          Int       @id @default(autoincrement())
    code        String    @unique @db.VarChar(32)   // 兑换码
    type        Int                                 // 兑换类型：1-仅会员，2-仅积分，3-会员和积分
    levelId     Int?      @map("level_id")          // 会员级别ID
    duration    Int?                                // 会员时长（天）
    pointAmount Int?      @map("point_amount")      // 积分数量
    expiredAt   DateTime? @map("expired_at") @db.Timestamptz(6)  // 过期时间
    status      Int       @default(1)               // 状态：1-有效，2-已使用，3-已过期，4-已作废
    remark      String?   @db.VarChar(255)          // 备注
    createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt   DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    level membershipLevels? @relation(fields: [levelId], references: [id])
    redemptionRecords redemptionRecords[]
    
    @@index([code], map: "idx_redemption_codes_code")
    @@index([status], map: "idx_redemption_codes_status")
    @@index([expiredAt], map: "idx_redemption_codes_expired_at")
    @@index([deletedAt], map: "idx_redemption_codes_deleted_at")
    @@map("redemption_codes")
}
```

### 兑换记录表 (redemptionRecords)

```prisma
model redemptionRecords {
    id        Int       @id @default(autoincrement())
    userId    Int       @map("user_id")             // 用户ID
    codeId    Int       @map("code_id")             // 兑换码ID
    createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    user users @relation(fields: [userId], references: [id])
    code redemptionCodes @relation(fields: [codeId], references: [id])
    
    @@index([userId], map: "idx_redemption_records_user_id")
    @@index([codeId], map: "idx_redemption_records_code_id")
    @@index([deletedAt], map: "idx_redemption_records_deleted_at")
    @@map("redemption_records")
}
```

### 商品表 (products)

```prisma
model products {
    id            Int       @id @default(autoincrement())
    name          String    @db.VarChar(100)        // 商品名称
    type          Int                               // 商品类型：1-会员商品，2-积分商品
    levelId       Int?      @map("level_id")        // 关联会员级别ID
    priceMonthly  Decimal?  @map("price_monthly") @db.Decimal(10, 2)  // 月度价格
    priceYearly   Decimal?  @map("price_yearly") @db.Decimal(10, 2)   // 年度价格
    giftPoint     Int?      @map("gift_point")      // 赠送积分
    unitPrice     Decimal?  @map("unit_price") @db.Decimal(10, 2)     // 积分单价
    pointAmount   Int?      @map("point_amount")    // 积分数量
    purchaseLimit Int?      @default(0) @map("purchase_limit")        // 购买次数限制
    status        Int       @default(1)             // 状态：1-上架，0-下架
    sortOrder     Int       @default(0) @map("sort_order")            // 排序
    createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt     DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    level membershipLevels? @relation(fields: [levelId], references: [id])
    paymentOrders paymentOrders[]
    
    @@index([type], map: "idx_products_type")
    @@index([levelId], map: "idx_products_level_id")
    @@index([status], map: "idx_products_status")
    @@index([sortOrder], map: "idx_products_sort_order")
    @@index([deletedAt], map: "idx_products_deleted_at")
    @@map("products")
}
```

### 订单表 (orders)

```prisma
model orders {
    id            Int       @id @default(autoincrement())
    orderNo       String    @unique @map("order_no") @db.VarChar(32)  // 订单号
    userId        Int       @map("user_id")         // 用户ID
    productId     Int       @map("product_id")      // 商品ID
    amount        Decimal   @db.Decimal(10, 2)      // 订单金额
    duration      Int                               // 购买时长
    durationUnit  String    @map("duration_unit") @db.VarChar(10)     // 时长单位：month/year
    status        Int       @default(0)             // 状态：0-待支付，1-已支付，2-已取消，3-已退款
    paidAt        DateTime? @map("paid_at") @db.Timestamptz(6)        // 支付时间
    expiredAt     DateTime  @map("expired_at") @db.Timestamptz(6)     // 订单过期时间
    remark        String?   @db.VarChar(255)        // 备注
    createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt     DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    user users @relation(fields: [userId], references: [id])
    product products @relation(fields: [productId], references: [id])
    paymentTransactions paymentTransactions[]
    membershipUpgradeRecords membershipUpgradeRecords[]
    
    @@index([orderNo], map: "idx_orders_order_no")
    @@index([userId], map: "idx_orders_user_id")
    @@index([productId], map: "idx_orders_product_id")
    @@index([status], map: "idx_orders_status")
    @@index([expiredAt], map: "idx_orders_expired_at")
    @@index([deletedAt], map: "idx_orders_deleted_at")
    @@map("orders")
}
```

### 支付单表 (paymentTransactions)

```prisma
model paymentTransactions {
    id              Int       @id @default(autoincrement())
    transactionNo   String    @unique @map("transaction_no") @db.VarChar(32)  // 支付单号
    orderId         Int       @map("order_id")          // 关联订单ID
    amount          Decimal   @db.Decimal(10, 2)        // 支付金额
    paymentChannel  String    @map("payment_channel") @db.VarChar(20)   // 支付渠道：wechat/alipay
    paymentMethod   String    @map("payment_method") @db.VarChar(20)    // 支付方式
    outTradeNo      String?   @map("out_trade_no") @db.VarChar(64)      // 第三方交易号
    prepayId        String?   @map("prepay_id") @db.VarChar(64)         // 预支付ID（微信）
    status          Int       @default(0)               // 状态：0-待支付，1-支付成功，2-支付失败，3-已过期，4-已退款
    paidAt          DateTime? @map("paid_at") @db.Timestamptz(6)        // 支付时间
    expiredAt       DateTime  @map("expired_at") @db.Timestamptz(6)     // 支付单过期时间
    callbackData    Json?     @map("callback_data")     // 回调原始数据
    errorMessage    String?   @map("error_message") @db.VarChar(255)    // 错误信息
    remark          String?   @db.VarChar(255)          // 备注
    createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt       DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    order orders @relation(fields: [orderId], references: [id])
    
    @@index([transactionNo], map: "idx_payment_transactions_transaction_no")
    @@index([orderId], map: "idx_payment_transactions_order_id")
    @@index([outTradeNo], map: "idx_payment_transactions_out_trade_no")
    @@index([status], map: "idx_payment_transactions_status")
    @@index([expiredAt], map: "idx_payment_transactions_expired_at")
    @@index([deletedAt], map: "idx_payment_transactions_deleted_at")
    @@map("payment_transactions")
}
```

### 会员升级记录表 (membershipUpgradeRecords)

```prisma
model membershipUpgradeRecords {
    id                Int       @id @default(autoincrement())
    userId            Int       @map("user_id")                 // 用户ID
    fromMembershipId  Int       @map("from_membership_id")      // 原会员记录ID
    toMembershipId    Int       @map("to_membership_id")        // 新会员记录ID
    orderId           Int       @map("order_id")                // 订单ID
    upgradePrice      Decimal   @map("upgrade_price") @db.Decimal(10, 2)  // 升级价格
    pointCompensation Int       @map("point_compensation")      // 积分补偿
    createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt         DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt         DateTime? @map("deleted_at") @db.Timestamptz(6)
    
    user users @relation(fields: [userId], references: [id])
    fromMembership userMemberships @relation("FromMembership", fields: [fromMembershipId], references: [id])
    toMembership userMemberships @relation("ToMembership", fields: [toMembershipId], references: [id])
    order orders @relation(fields: [orderId], references: [id])
    
    @@index([userId], map: "idx_membership_upgrade_records_user_id")
    @@index([fromMembershipId], map: "idx_membership_upgrade_records_from_membership_id")
    @@index([toMembershipId], map: "idx_membership_upgrade_records_to_membership_id")
    @@index([deletedAt], map: "idx_membership_upgrade_records_deleted_at")
    @@map("membership_upgrade_records")
}
```



## 正确性属性

*正确性属性是系统在所有有效执行中应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 会员级别排序一致性

*For any* 会员级别列表，查询返回的结果 SHALL 按 sortOrder 字段升序排列，且 sortOrder 值越小的级别越高。

**Validates: Requirements 1.3, 1.4**

### Property 2: 用户会员记录完整性

*For any* 创建的用户会员记录，SHALL 包含 userId、levelId、startDate、endDate、sourceType 等必要字段，且 startDate < endDate。

**Validates: Requirements 2.1**

### Property 3: 有效会员查询正确性

*For any* 用户，查询当前有效会员时 SHALL 只返回 status=1 且 endDate > 当前时间 的会员记录。

**Validates: Requirements 2.2, 2.5**

### Property 4: 营销活动有效期控制

*For any* 营销活动，当 startAt > 当前时间 或 endAt < 当前时间 或 status=0 时，SHALL 不执行任何奖励逻辑。

**Validates: Requirements 3.4, 3.5, 4.3, 5.3**

### Property 5: 注册赠送正确性

*For any* 新用户注册，当存在有效的注册赠送活动时，SHALL 创建会员记录（如配置了会员）和积分记录（如配置了积分），且记录的来源类型为注册赠送。

**Validates: Requirements 4.1, 4.2, 4.4**

### Property 6: 邀请奖励正确性

*For any* 被邀请用户注册成功，当存在有效的邀请奖励活动且用户有邀请人时，SHALL 为邀请人创建会员记录和积分记录，且记录的来源类型为邀请注册赠送。

**Validates: Requirements 5.1, 5.2, 5.4**

### Property 7: 兑换码兑换正确性

*For any* 有效兑换码兑换操作：
- 当兑换类型包含会员时，SHALL 创建会员记录
- 当兑换类型包含积分时，SHALL 创建积分记录
- 当兑换类型为会员和积分时，积分有效期 SHALL 等于会员有效期
- 当兑换类型为仅积分时，积分有效期 SHALL 为兑换时刻起1年
- 兑换成功后，兑换码状态 SHALL 变为已使用

**Validates: Requirements 6.3, 6.4, 6.5, 6.6, 6.7**

### Property 8: 无效兑换码拒绝

*For any* 已使用、已过期或已作废的兑换码，兑换操作 SHALL 被拒绝并返回相应错误。

**Validates: Requirements 6.8**

### Property 9: 支付成功处理正确性

*For any* 支付成功的订单：
- 会员商品 SHALL 创建会员记录并发放赠送积分
- 积分商品 SHALL 创建积分记录，有效期为1年

**Validates: Requirements 7.4, 7.5**

### Property 10: 升级价格计算正确性

*For any* 会员升级操作，升级价格 SHALL 等于 (目标级别剩余价值 - 原级别剩余价值)，积分补偿 SHALL 等于 (升级价格 × 10)。

**Validates: Requirements 8.2, 8.3**

### Property 11: 会员升级状态转换

*For any* 成功的会员升级操作，原会员记录 SHALL 被标记为无效，新会员记录 SHALL 被创建，原会员关联的积分记录 SHALL 转移到新会员。

**Validates: Requirements 8.4, 8.5, 10.2**

### Property 12: 积分消耗顺序

*For any* 积分消耗操作，SHALL 按积分记录的 expiredAt 字段升序消耗（先到期先消耗）。

**Validates: Requirements 10.4**

### Property 13: 数据序列化往返

*For any* 有效的会员级别或用户会员记录对象，序列化为 JSON 后再反序列化 SHALL 产生等价的对象。

**Validates: Requirements 12.1, 12.2, 12.3**

## 错误处理

### 错误码定义

| 错误码 | 错误名称 | 描述 |
|--------|----------|------|
| 40001 | MEMBERSHIP_LEVEL_NOT_FOUND | 会员级别不存在 |
| 40002 | MEMBERSHIP_NOT_FOUND | 会员记录不存在 |
| 40003 | MEMBERSHIP_EXPIRED | 会员已过期 |
| 40004 | REDEMPTION_CODE_NOT_FOUND | 兑换码不存在 |
| 40005 | REDEMPTION_CODE_USED | 兑换码已使用 |
| 40006 | REDEMPTION_CODE_EXPIRED | 兑换码已过期 |
| 40007 | REDEMPTION_CODE_INVALID | 兑换码已作废 |
| 40008 | PRODUCT_NOT_FOUND | 商品不存在 |
| 40009 | PRODUCT_OFF_SHELF | 商品已下架 |
| 40010 | ORDER_NOT_FOUND | 订单不存在 |
| 40011 | ORDER_EXPIRED | 订单已过期 |
| 40012 | ORDER_PAID | 订单已支付 |
| 40013 | PAYMENT_VERIFY_FAILED | 支付验证失败 |
| 40014 | UPGRADE_NOT_ALLOWED | 不允许升级 |
| 40015 | CAMPAIGN_NOT_FOUND | 营销活动不存在 |
| 40016 | CAMPAIGN_NOT_ACTIVE | 营销活动未生效 |
| 40017 | INSUFFICIENT_POINTS | 积分不足 |

### 错误处理策略

1. **参数验证错误**: 使用 Zod 进行参数验证，返回 400 错误码和详细的验证错误信息
2. **业务逻辑错误**: 返回对应的业务错误码和错误消息
3. **系统错误**: 记录错误日志，返回 500 错误码和通用错误消息
4. **支付回调错误**: 记录详细日志，返回支付平台要求的错误响应格式

## 测试策略

### 单元测试

单元测试用于验证具体示例和边界情况：

1. **DAO 层测试**: 测试数据库操作的正确性
2. **Service 层测试**: 测试业务逻辑的正确性
3. **支付适配器测试**: 测试支付参数生成和签名验证

### 属性测试

属性测试用于验证跨所有输入的通用属性：

- 使用 `fast-check` 库进行属性测试
- 每个属性测试至少运行 100 次迭代
- 每个测试需要标注对应的设计文档属性编号

**测试标注格式**: `**Feature: membership-system, Property {number}: {property_text}**`

### 集成测试

1. **API 集成测试**: 测试完整的 API 请求响应流程
2. **支付流程测试**: 测试从创建订单到支付成功的完整流程
3. **会员升级测试**: 测试会员升级的完整流程

### 测试覆盖要求

- 单元测试覆盖率 > 80%
- 所有正确性属性都有对应的属性测试
- 关键业务流程都有集成测试
