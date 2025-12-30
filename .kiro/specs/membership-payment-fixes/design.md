# 设计文档

## 概述

本设计文档描述了会员支付系统修复的技术方案,主要解决以下问题:
1. 会员有效期在前端页面不显示
2. 按月购买会员时创建的订单错误地使用按年计费
3. 订单号格式需要改为 LSD 开头以与老系统保持一致
4. 微信商户后台查不到订单号

## 架构

### 问题分析

#### 问题 1: 会员有效期不显示

**根本原因**: 
- API 返回的会员信息可能缺少 `expiresAt` 字段
- 或者前端组件没有正确显示该字段

**影响范围**:
- `server/api/v1/memberships/me.get.ts` - 会员信息 API
- `app/pages/dashboard/membership/level.vue` - 会员页面组件
- `app/components/membership/MembershipCurrentInfo.vue` - 会员信息展示组件

#### 问题 2: 按月购买生成按年订单

**根本原因**:
- 前端在调用支付 API 时,可能没有正确传递 `durationUnit` 参数
- 或者后端在创建订单时没有正确使用前端传递的 `durationUnit`
- 商品的 `defaultDuration` 字段可能配置错误

**影响范围**:
- `app/pages/dashboard/membership/level.vue` - 购买逻辑
- `server/api/v1/payments/create.post.ts` - 支付创建 API
- `server/services/payment/order.service.ts` - 订单服务
- `prisma/models/product.prisma` - 商品模型

#### 问题 3: 订单号格式

**根本原因**:
- 当前订单号生成函数使用 `ORD` 前缀
- 需要改为 `LSD` 前缀以与老系统保持一致

**影响范围**:
- `server/services/payment/order.dao.ts` - 订单号生成函数

#### 问题 4: 微信商户后台查不到订单

**根本原因**:
- 微信支付适配器在创建支付时,可能没有正确传递 `out_trade_no` 字段
- 或者传递的值不是系统订单号

**影响范围**:
- `server/lib/payment/adapters/wechat-pay.ts` - 微信支付适配器

### 修复方案

#### 方案 1: 修复会员有效期显示

**重要说明**: 用户可能拥有多段会员记录(历史记录和当前记录),页面应该显示的是**当前时段有效会员记录的有效期**,而不是所有会员记录。

**后端修复**:
```typescript
// server/api/v1/memberships/me.get.ts
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    // 获取当前有效的会员记录(status=1 且 endDate > 当前时间)
    const membership = await getCurrentUserMembershipDao(user.id)
    
    if (!membership) {
        return resSuccess(event, '查询成功', null)
    }

    return resSuccess(event, '查询成功', {
        levelId: membership.levelId,
        levelName: membership.level.name,
        expiresAt: membership.endDate.toISOString(), // 确保返回当前有效会员的到期时间
    })
})
```

**DAO 层确保查询当前有效会员**:
```typescript
// server/services/membership/userMembership.dao.ts
export const getCurrentUserMembershipDao = async (
    userId: number,
    tx?: PrismaClient
): Promise<(userMemberships & { level: membershipLevels }) | null> => {
    const now = new Date()
    
    const membership = await (tx || prisma).userMemberships.findFirst({
        where: {
            userId,
            status: 1, // 有效状态
            endDate: { gt: now }, // 未过期
            deletedAt: null,
        },
        include: {
            level: true,
        },
        orderBy: {
            endDate: 'desc', // 如果有多个有效会员,返回最晚到期的
        },
    })
    
    return membership
}
```

**前端修复**:
```vue
<!-- app/components/membership/MembershipCurrentInfo.vue -->
<template>
  <div class="membership-info">
    <div class="level">{{ membership.levelName }}</div>
    <div v-if="membership.expiresAt" class="expires">
      有效期至: {{ formatDate(membership.expiresAt) }}
    </div>
    <div v-else class="expires">
      暂无会员
    </div>
  </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'

const props = defineProps<{
  membership: {
    levelId: number
    levelName: string
    expiresAt?: string
  }
}>()

const formatDate = (dateStr: string) => {
  return dayjs(dateStr).format('YYYY-MM-DD')
}
</script>
```

#### 方案 2: 修复订单时长单位

**前端修复**:
```typescript
// app/pages/dashboard/membership/level.vue
const buy = async (plan: MembershipPlan) => {
  // 关闭续期弹框
  showRenewalDialog.value = false
  blurActiveElement()

  // 根据商品的 defaultDuration 确定购买周期
  const durationUnit = plan.defaultDuration === 1 ? DurationUnit.MONTH : DurationUnit.YEAR

  // 创建订单并发起支付
  const result = await useApiFetch<{
    orderNo: string;
    transactionNo: string;
    amount: number;
    codeUrl: string;
    h5Url: string;
  }>("/api/v1/payments/create", {
    method: "POST",
    body: {
      productId: plan.id,
      duration: 1, // 购买 1 个单位
      durationUnit, // 使用正确的时长单位
      paymentChannel: PaymentChannel.WECHAT,
      paymentMethod: PaymentMethod.SCAN_CODE,
    },
  });

  // ... 后续处理
}
```

**后端验证**:
```typescript
// server/api/v1/payments/create.post.ts
// 确保正确使用前端传递的 durationUnit
const { productId, duration, durationUnit, paymentChannel, paymentMethod, openid } = parseResult.data

// 创建订单时使用正确的 durationUnit
const orderResult = await createOrderService({
    userId: user.id,
    productId,
    duration,
    durationUnit, // 直接使用前端传递的值
})
```

#### 方案 3: 修复订单号格式

**订单号生成函数修复**:
```typescript
// server/services/payment/order.dao.ts
/**
 * 生成订单号
 * @returns 订单号(格式: LSD + 年月日时分秒 + 6位随机数)
 */
export const generateOrderNo = (): string => {
    const now = new Date()
    const dateStr = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
    return `LSD${dateStr}${random}` // 改为 LSD 前缀
}
```

#### 方案 4: 修复微信支付商户订单号

**微信支付适配器修复**:
```typescript
// server/lib/payment/adapters/wechat-pay.ts
private async createNativePayment(params: CreatePaymentParams): Promise<PaymentResult> {
    const { orderNo, amount, description, notifyUrl, attach, expireMinutes = 30 } = params

    const truncatedDesc = this.truncateDescription(description)

    const requestBody: Record<string, unknown> = {
        appid: String(this.config.appId),
        mchid: String(this.config.mchId),
        description: truncatedDesc,
        out_trade_no: orderNo, // 确保传递系统订单号
        notify_url: notifyUrl,
        time_expire: this.getExpireTime(expireMinutes),
        amount: { total: amount, currency: 'CNY' },
    }

    // 添加调试日志
    logger.info('创建微信支付订单', {
        orderNo,
        out_trade_no: orderNo,
        amount,
    })

    // ... 后续处理
}
```

## 组件和接口

### 会员信息 API 响应格式

```typescript
interface MembershipInfoResponse {
    levelId: number
    levelName: string
    expiresAt: string // ISO 8601 格式,如 "2024-12-31T23:59:59.000Z"
}
```

### 订单创建参数

```typescript
interface CreateOrderParams {
    userId: number
    productId: number
    duration: number
    durationUnit: DurationUnit // 'month' | 'year'
}
```

### 订单号格式

```
格式: LSD + YYYYMMDDHHMMSS + NNNNNN
示例: LSD20241229153045123456
长度: 23 位
```

## 数据模型

### 商品表更新

```prisma
model products {
    // ... 其他字段
    defaultDuration Int @default(2) @map("default_duration") // 默认购买周期: 1-按月, 2-按年
    // ... 其他字段
}
```

## 正确性属性

*正确性属性是系统在所有有效执行中应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 会员信息 API 响应完整性

*For any* 有效会员记录,API 响应 SHALL 包含 levelId、levelName 和 expiresAt 字段,且 expiresAt 为有效的 ISO 8601 格式字符串。

**Validates: Requirements 1.4, 1.5**

### Property 2: 订单时长单位一致性

*For any* 订单创建请求,创建的订单的 durationUnit SHALL 等于请求参数中的 durationUnit。

**Validates: Requirements 2.1, 2.2, 2.4, 2.5**

### Property 3: 订单号格式正确性

*For any* 生成的订单号,SHALL 以 "LSD" 开头,后跟 14 位时间戳和 6 位随机数,总长度为 23 位。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 4: 微信支付订单号传递正确性

*For any* 微信支付请求,传递给微信支付的 out_trade_no SHALL 等于系统订单号。

**Validates: Requirements 4.1, 4.2, 4.6**

### Property 5: 商品默认购买周期有效性

*For any* 会员商品,defaultDuration 字段 SHALL 为 1(按月) 或 2(按年)。

**Validates: Requirements 5.1, 5.2, 5.5**

## 错误处理

### 错误场景

1. **会员信息不存在**: 返回 null,前端显示"暂无会员"
2. **订单创建参数错误**: 返回 400 错误,提示参数验证失败
3. **微信支付请求失败**: 记录详细日志,返回错误信息给前端

### 日志记录

所有关键操作都需要记录日志:
- 订单号生成
- 微信支付请求参数
- 微信支付响应
- 订单创建结果

## 测试策略

### 单元测试

1. **订单号生成测试**:
   - 测试订单号格式是否正确
   - 测试订单号是否以 LSD 开头
   - 测试订单号长度是否为 23 位

2. **会员信息序列化测试**:
   - 测试 expiresAt 字段是否正确序列化为 ISO 8601 格式

3. **订单创建测试**:
   - 测试按月购买是否创建月度订单
   - 测试按年购买是否创建年度订单

### 属性测试

使用 `fast-check` 进行属性测试,每个测试至少运行 100 次:

1. **Property 1 测试**: 验证会员信息 API 响应格式
2. **Property 2 测试**: 验证订单时长单位一致性
3. **Property 3 测试**: 验证订单号格式
4. **Property 4 测试**: 验证微信支付订单号传递
5. **Property 5 测试**: 验证商品默认购买周期

### 集成测试

1. **端到端购买流程测试**:
   - 测试从选择商品到支付成功的完整流程
   - 验证订单号在微信商户后台可查询

2. **会员页面显示测试**:
   - 测试会员有效期是否正确显示
   - 测试免费用户是否显示"暂无会员"

