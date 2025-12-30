# 设计文档

## 概述

本设计文档描述了修复购买会员套餐时赠送积分生效日期问题的技术方案。核心问题是当用户购买的会员套餐生效日期在未来时，赠送的积分 `effectiveAt` 使用的是当前时间，而不是会员的开始时间。

## 架构

### 现有架构

```
支付成功 → PaymentSuccessHandler → membershipHandler → handleGiftPoints
                                                           ↓
                                                    创建积分记录
                                                    (effectiveAt: new Date()) ← 问题所在
```

### 修复后架构

```
支付成功 → PaymentSuccessHandler → membershipHandler → handleGiftPoints
                                                           ↓
                                                    创建积分记录
                                                    (effectiveAt: membership.startDate) ← 修复
```

## 组件和接口

### 需要修改的组件

#### 1. membershipHandler.ts

**文件路径：** `server/services/payment/handlers/membershipHandler.ts`

**修改内容：**
- `handleGiftPoints` 函数需要接收会员的 `startDate` 参数
- 将积分的 `effectiveAt` 从 `new Date()` 改为会员的 `startDate`

**修改前：**
```typescript
async function handleGiftPoints(
    userId: number,
    membershipId: number,
    points: number,
    expiredAt: Date,
    orderNo: string,
    tx: PrismaClient
): Promise<void> {
    await tx.pointRecords.create({
        data: {
            // ...
            effectiveAt: new Date(),  // 问题：使用当前时间
            expiredAt,
            // ...
        },
    })
}
```

**修改后：**
```typescript
async function handleGiftPoints(
    userId: number,
    membershipId: number,
    points: number,
    effectiveAt: Date,  // 新增：生效时间参数
    expiredAt: Date,
    orderNo: string,
    tx: PrismaClient
): Promise<void> {
    await tx.pointRecords.create({
        data: {
            // ...
            effectiveAt,  // 修复：使用传入的生效时间
            expiredAt,
            // ...
        },
    })
}
```

#### 2. membershipHandler 调用处修改

**修改前：**
```typescript
await handleGiftPoints(
    order.userId,
    membership.id,
    product.giftPoint,
    membership.endDate,
    order.orderNo,
    tx as PrismaClient
)
```

**修改后：**
```typescript
await handleGiftPoints(
    order.userId,
    membership.id,
    product.giftPoint,
    membership.startDate,  // 新增：传入会员开始时间
    membership.endDate,
    order.orderNo,
    tx as PrismaClient
)
```

## 数据模型

### Point_Record 数据模型（无变化）

| 字段 | 类型 | 说明 |
|------|------|------|
| effectiveAt | DateTime | 积分生效时间 |
| expiredAt | DateTime | 积分过期时间 |

### 数据一致性规则

对于会员购买赠送的积分：
- `effectiveAt` = 关联会员的 `startDate`
- `expiredAt` = 关联会员的 `endDate`

## 正确性属性

*正确性属性是一种特征或行为，应该在系统的所有有效执行中保持为真——本质上是关于系统应该做什么的正式声明。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 积分有效期与会员有效期同步

*对于任意* 会员购买赠送的积分记录，其 `effectiveAt` 应等于关联会员的 `startDate`，其 `expiredAt` 应等于关联会员的 `endDate`。

**Validates: Requirements 1.1, 1.2, 1.3, 2.2**

### Property 2: 未来生效积分状态标识

*对于任意* 积分记录，当 `effectiveAt` 大于当前时间时，系统查询应正确标识该积分为"未生效"状态。

**Validates: Requirements 2.3**

## 错误处理

### 现有错误处理（保持不变）

- 如果创建积分记录失败，记录错误日志并抛出异常
- 事务会自动回滚，确保数据一致性

## 测试策略

### 单元测试

1. **测试会员开始日期为当前日期的场景**
   - 验证积分的 `effectiveAt` 等于会员的 `startDate`
   - 验证积分的 `expiredAt` 等于会员的 `endDate`

2. **测试会员开始日期为未来日期的场景**
   - 模拟用户已有有效会员的情况
   - 验证新购买会员的赠送积分 `effectiveAt` 等于新会员的 `startDate`（未来日期）

### 属性测试

使用 fast-check 进行属性测试，验证：

1. **Property 1 测试**：生成随机的会员购买场景，验证积分有效期与会员有效期同步
   - 生成器：随机用户 ID、会员级别、购买时长、是否已有会员
   - 断言：积分的 effectiveAt === 会员的 startDate，积分的 expiredAt === 会员的 endDate

2. **Property 2 测试**：生成随机的积分记录，验证未生效积分的状态标识
   - 生成器：随机积分记录，部分 effectiveAt 在未来
   - 断言：查询结果正确标识未生效积分

### 测试配置

- 属性测试运行次数：100 次
- 测试框架：vitest + fast-check
