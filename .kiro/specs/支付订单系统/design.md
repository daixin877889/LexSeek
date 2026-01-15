# 设计文档

## 概述

本设计文档描述了 LexSeek 支付订单系统的技术架构和实现方案。系统采用适配器模式实现多支付渠道支持，策略模式处理不同商品类型的支付成功逻辑。

## 架构

### 整体架构

```mermaid
graph TB
    subgraph "前端层"
        A[购买页面] --> B[支付 Store]
    end
    
    subgraph "API 层"
        C[/api/v1/payments/create]
        D[/api/v1/payments/query]
        E[/api/v1/payments/callback/*]
    end
    
    subgraph "Service 层"
        F[OrderService]
        G[PaymentService]
    end
    
    subgraph "支付适配器"
        H[PaymentAdapter Interface]
        I[WechatPayAdapter]
        J[其他适配器...]
    end
    
    subgraph "支付成功处理器"
        K[PaymentSuccessHandler Interface]
        L[MembershipHandler]
        M[PointsHandler]
    end
    
    B --> C & D
    C --> F & G
    D --> G
    E --> G
    G --> H
    H --> I & J
    G --> K
    K --> L & M
```

### 目录结构

```
server/
├── api/v1/payments/
│   ├── create.post.ts
│   ├── query.get.ts
│   └── callback/
│       └── wechat.post.ts
├── services/payment/
│   ├── order.dao.ts
│   ├── order.service.ts
│   ├── paymentTransaction.dao.ts
│   ├── payment.service.ts
│   └── handlers/
│       ├── types.ts
│       ├── membershipHandler.ts
│       └── pointsHandler.ts
└── lib/payment/
    ├── types.ts
    ├── base.ts
    ├── factory.ts
    └── adapters/
        └── wechat-pay.ts
```

## 组件和接口

### 支付适配器接口

```typescript
// server/lib/payment/types.ts
export interface PaymentAdapter {
  getChannel(): PaymentChannel;
  createPayment(params: CreatePaymentParams): Promise<PaymentResult>;
  verifyCallback(body: string, headers: Record<string, string>): Promise<CallbackVerifyResult>;
  queryOrder(orderNo: string): Promise<CallbackVerifyResult>;
}
```

### 支付成功处理器接口

```typescript
// server/services/payment/handlers/types.ts
export interface PaymentSuccessHandler {
  getProductType(): ProductType;
  handle(order: PaymentOrder, tx: PrismaClient): Promise<void>;
}
```

## 数据模型

### 商品表 (products)

```prisma
model products {
    id            Int       @id @default(autoincrement())
    name          String    @db.VarChar(100)
    type          Int                               // 1-会员商品，2-积分商品
    levelId       Int?      @map("level_id")
    priceMonthly  Decimal?  @map("price_monthly")
    priceYearly   Decimal?  @map("price_yearly")
    giftPoint     Int?      @map("gift_point")
    unitPrice     Decimal?  @map("unit_price")
    pointAmount   Int?      @map("point_amount")
    status        Int       @default(1)
    sortOrder     Int       @default(0) @map("sort_order")
    
    @@map("products")
}
```

### 订单表 (paymentOrders)

```prisma
model paymentOrders {
    id            Int       @id @default(autoincrement())
    orderNo       String    @unique @map("order_no")
    userId        Int       @map("user_id")
    productId     Int       @map("product_id")
    amount        Decimal   @db.Decimal(10, 2)
    duration      Int
    durationUnit  String    @map("duration_unit")
    status        Int       @default(0)             // 0-待支付，1-已支付，2-已取消
    paidAt        DateTime? @map("paid_at")
    expiredAt     DateTime  @map("expired_at")
    
    @@map("payment_orders")
}
```

### 支付单表 (paymentTransactions)

```prisma
model paymentTransactions {
    id              Int       @id @default(autoincrement())
    transactionNo   String    @unique @map("transaction_no")
    orderId         Int       @map("order_id")
    amount          Decimal   @db.Decimal(10, 2)
    paymentChannel  String    @map("payment_channel")
    paymentMethod   String    @map("payment_method")
    outTradeNo      String?   @map("out_trade_no")
    prepayId        String?   @map("prepay_id")
    status          Int       @default(0)
    paidAt          DateTime? @map("paid_at")
    callbackData    Json?     @map("callback_data")
    
    @@map("payment_transactions")
}
```

## 正确性属性

### Property 1: 订单号唯一性

*For any* 创建的订单，订单号 SHALL 全局唯一。

**Validates: Requirements 2.2**

### Property 2: 支付回调幂等性

*For any* 支付回调，重复处理同一回调 SHALL 不会重复发放权益。

**Validates: Requirements 4.4**

### Property 3: 支付成功处理原子性

*For any* 支付成功处理，订单状态更新和权益发放 SHALL 在同一事务中完成。

**Validates: Requirements 5.4**

## 错误处理

| 错误码 | 错误名称 | 描述 |
|--------|----------|------|
| 40008 | PRODUCT_NOT_FOUND | 商品不存在 |
| 40009 | PRODUCT_OFF_SHELF | 商品已下架 |
| 40010 | ORDER_NOT_FOUND | 订单不存在 |
| 40011 | ORDER_EXPIRED | 订单已过期 |
| 40012 | ORDER_PAID | 订单已支付 |
| 40013 | PAYMENT_VERIFY_FAILED | 支付验证失败 |

## 测试策略

### 单元测试

- 支付适配器测试：测试支付参数生成和签名验证
- 订单服务测试：测试订单创建和状态更新

### 集成测试

- 支付流程测试：测试从创建订单到支付成功的完整流程
- 回调处理测试：测试支付回调的验证和处理

## 实现状态

所有组件已完成实现和测试。

### 相关文件

**服务层**:
- `server/services/payment/order.dao.ts`
- `server/services/payment/order.service.ts`
- `server/services/payment/payment.service.ts`
- `server/services/payment/handlers/*.ts`

**支付适配器**:
- `server/lib/payment/adapters/wechat-pay.ts`

**API 层**:
- `server/api/v1/payments/*.ts`
