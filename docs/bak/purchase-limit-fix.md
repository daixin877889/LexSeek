# 商品购买限制修复说明

## 问题描述

商品表中有 `purchase_limit` 字段用于限制用户购买次数，但在创建订单时没有进行校验，导致：

1. 限购 1 次的商品可以重复购买
2. 超过限购次数的商品仍然可以下单
3. 购买限制形同虚设

## 解决方案

在创建订单服务 (`createOrderService`) 中添加购买限制检查逻辑。

### 修改内容

**文件**：`lexseek/server/services/payment/order.service.ts`

#### 1. 添加导入

```typescript
import {
    // ... 其他导入
    countUserProductOrdersDao, // 新增：统计用户购买次数
} from './order.dao'
```

#### 2. 添加购买限制检查

在检查商品状态后，添加购买限制检查：

```typescript
// 检查商品状态
if (product.status !== 1) {
    return { success: false, errorMessage: '商品已下架' }
}

// 检查购买限制（0 表示不限制）
if (product.purchaseLimit && product.purchaseLimit > 0) {
    const purchasedCount = await countUserProductOrdersDao(userId, productId, tx)
    if (purchasedCount >= product.purchaseLimit) {
        return {
            success: false,
            errorMessage: `该商品限购 ${product.purchaseLimit} 次，您已达到购买上限`,
        }
    }
}
```

## 实现逻辑

### 1. 购买限制字段

商品表中的 `purchase_limit` 字段：
- **0**：不限制购买次数
- **> 0**：限制购买次数（例如：1 表示只能购买 1 次）

### 2. 购买次数统计

使用 `countUserProductOrdersDao` 函数统计用户已购买该商品的次数：
- 只统计**已支付**的订单（`status = OrderStatus.PAID`）
- 不包括待支付、已取消、已退款的订单

### 3. 检查时机

在创建订单时进行检查，而不是在支付时检查：
- ✅ 优点：提前拦截，避免创建无效订单
- ✅ 优点：用户体验更好，不会在支付时才发现无法购买
- ✅ 优点：减少无效订单数据

### 4. 错误提示

当用户达到购买上限时，返回明确的错误信息：
```
该商品限购 1 次，您已达到购买上限
```

## 测试场景

### 1. 限购 1 次的商品

**测试步骤**：
1. 设置商品 `purchase_limit = 1`
2. 用户首次购买该商品并支付成功
3. 用户再次尝试购买该商品
4. **预期结果**：返回错误 "该商品限购 1 次，您已达到购买上限"

### 2. 限购 3 次的商品

**测试步骤**：
1. 设置商品 `purchase_limit = 3`
2. 用户购买该商品 3 次并支付成功
3. 用户第 4 次尝试购买该商品
4. **预期结果**：返回错误 "该商品限购 3 次，您已达到购买上限"

### 3. 不限购的商品

**测试步骤**：
1. 设置商品 `purchase_limit = 0`
2. 用户多次购买该商品
3. **预期结果**：每次都能成功创建订单

### 4. 待支付订单不计入购买次数

**测试步骤**：
1. 设置商品 `purchase_limit = 1`
2. 用户创建订单但未支付（订单状态为待支付）
3. 用户再次尝试购买该商品
4. **预期结果**：可以成功创建订单（待支付订单不计入购买次数）

### 5. 已取消订单不计入购买次数

**测试步骤**：
1. 设置商品 `purchase_limit = 1`
2. 用户购买该商品并支付成功
3. 订单被取消或退款
4. 用户再次尝试购买该商品
5. **预期结果**：可以成功创建订单（已取消/退款订单不计入购买次数）

## 前端优化建议

虽然后端已经添加了购买限制检查，但前端也可以进行优化以提升用户体验：

### ✅ 已实现：自动过滤已达购买上限的商品

**实现位置**：
- `lexseek/server/api/v1/products/index.get.ts` - 商品列表 API
- `lexseek/server/services/product/product.service.ts` - 商品服务层

**实现逻辑**：
1. 商品列表 API 检测用户是否已登录
2. 如果用户已登录，调用 `filterProductsByPurchaseLimitService` 过滤商品
3. 该函数会批量查询用户购买次数，过滤掉已达购买上限的商品
4. 前端接收到的商品列表已经不包含已达上限的商品

**代码示例**：

```typescript
// API 层 (lexseek/server/api/v1/products/index.get.ts)
export default defineEventHandler(async (event) => {
    // 获取当前登录用户（可选）
    const user = event.context.auth?.user

    // 获取商品列表
    let products = await getActiveProductsService(type as ProductType)

    // 如果用户已登录，过滤掉已达购买限制的商品
    if (user) {
        products = await filterProductsByPurchaseLimitService(user.id, products)
    }

    return resSuccess(event, '获取商品列表成功', products)
})
```

```typescript
// 服务层 (lexseek/server/services/product/product.service.ts)
export const filterProductsByPurchaseLimitService = async (
    userId: number,
    products: ProductInfo[]
): Promise<ProductInfo[]> => {
    // 提取所有有购买限制的商品ID（purchaseLimit > 0）
    const limitedProductIds = products
        .filter(p => p.purchaseLimit && p.purchaseLimit > 0)
        .map(p => p.id)

    // 如果没有有限制的商品，直接返回原列表
    if (limitedProductIds.length === 0) {
        return products
    }

    // 批量获取用户购买这些商品的次数
    const purchaseCountMap = await countUserProductsOrdersDao(userId, limitedProductIds)

    // 过滤掉已达到购买限制的商品
    return products.filter(product => {
        // 如果没有购买限制或限制为0，保留
        if (!product.purchaseLimit || product.purchaseLimit === 0) {
            return true
        }

        // 获取该商品的购买次数
        const purchaseCount = purchaseCountMap.get(product.id) || 0

        // 如果购买次数小于限制，保留
        return purchaseCount < product.purchaseLimit
    })
}
```

**优势**：
1. ✅ 用户看不到无法购买的商品，避免困惑
2. ✅ 批量查询购买次数，性能更好
3. ✅ 未登录用户仍然可以看到所有商品
4. ✅ 已登录用户只看到可购买的商品

### 可选：显示购买限制信息

如果需要显示购买限制信息（例如"限购 1 次"），可以在商品列表中添加：

### 可选：显示购买限制信息

如果需要显示购买限制信息（例如"限购 1 次"），可以在商品列表中添加：

```vue
<template>
  <div class="product-card">
    <h4>{{ product.name }}</h4>
    <p>¥{{ product.price }}</p>
    
    <!-- 显示购买限制 -->
    <p v-if="product.purchaseLimit > 0" class="text-sm text-muted-foreground">
      限购 {{ product.purchaseLimit }} 次
    </p>
    
    <Button @click="buy(product)">购买</Button>
  </div>
</template>
```

注意：由于后端已经过滤掉了已达上限的商品，前端显示的商品都是可以购买的，所以不需要显示"已达上限"的状态。

### 2. 获取用户购买次数（可选）

### 2. 获取用户购买次数（可选）

如果需要显示用户已购买次数（例如"已购买 1 次，还可购买 2 次"），需要修改 API 返回格式：

```typescript
// API 返回格式
interface ProductInfo {
  id: number
  name: string
  price: number
  purchaseLimit: number
  purchasedCount?: number // 用户已购买次数（可选）
}
```

但由于后端已经过滤掉了已达上限的商品，这个字段通常不是必需的。

### 3. 前端校验（可选）

## 数据库字段说明

### products 表

| 字段 | 类型 | 说明 |
|------|------|------|
| purchase_limit | Int | 购买次数限制（0-不限制） |

### orders 表

| 字段 | 类型 | 说明 |
|------|------|------|
| status | Int | 订单状态（0-待支付，1-已支付，2-已取消，3-已退款） |

## 相关文件

- `lexseek/server/services/payment/order.service.ts` - 订单服务层（添加购买限制检查）
- `lexseek/server/services/payment/order.dao.ts` - 订单数据访问层（购买次数统计）
- `lexseek/prisma/models/product.prisma` - 商品表结构

## 注意事项

1. **只统计已支付订单**：待支付、已取消、已退款的订单不计入购买次数
2. **0 表示不限制**：`purchase_limit = 0` 或 `null` 表示不限制购买次数
3. **事务支持**：购买次数统计支持事务，确保数据一致性
4. **错误提示清晰**：明确告知用户限购次数和当前状态

## 修改日期

2025-01-XX


由于后端已经过滤掉了已达上限的商品，前端通常不需要额外的校验。但如果需要双重保险，可以在创建订单时捕获后端返回的错误：

```typescript
const buy = async (product: ProductInfo) => {
  try {
    // 调用创建订单 API
    const result = await useApiFetch('/api/v1/orders/create', {
      method: 'POST',
      body: { productId: product.id, ... }
    })
    
    if (result) {
      // 订单创建成功，继续支付流程
      // ...
    }
  } catch (error) {
    // 后端会返回 "该商品限购 X 次，您已达到购买上限" 的错误
    // useApiFetch 会自动显示错误 toast
  }
}
```

## 实现总结

### 后端实现

1. ✅ **订单创建时检查**：在 `createOrderService` 中添加购买限制检查
2. ✅ **商品列表过滤**：在商品列表 API 中自动过滤已达上限的商品
3. ✅ **批量查询优化**：使用 `countUserProductsOrdersDao` 批量查询购买次数，避免 N+1 查询问题

### 前端体验

1. ✅ **自动隐藏**：用户看不到无法购买的商品
2. ✅ **未登录友好**：未登录用户仍然可以看到所有商品
3. ✅ **双重保险**：即使前端过滤失败，后端仍会拦截

### 性能优化

1. ✅ **批量查询**：一次查询获取所有商品的购买次数
2. ✅ **条件过滤**：只查询有购买限制的商品（`purchaseLimit > 0`）
3. ✅ **缓存友好**：商品列表可以正常缓存，过滤逻辑在服务端执行
