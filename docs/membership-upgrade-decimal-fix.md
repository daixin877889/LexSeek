# 会员升级价格 Prisma Decimal 类型转换修复

## 问题描述

升级弹框显示的价格为"¥"（没有数字），接口返回所有价格字段都是 `null`。

## 根本原因

数据库中的商品价格字段（`price_yearly`、`price_monthly`）是 `Decimal(10, 2)` 类型，Prisma 查询返回的是 Prisma Decimal 对象，而不是普通的数字类型。

### Prisma Decimal 对象结构

```json
{
  "s": 1,      // 符号（1 表示正数，-1 表示负数）
  "e": 2,      // 指数
  "d": [365]   // 数字数组
}
```

例如：
- 基础版年价 365.00 元 → `{ s: 1, e: 2, d: [365] }`
- 专业版年价 680.00 元 → `{ s: 1, e: 2, d: [680] }`
- 旗舰版年价 1280.00 元 → `{ s: 1, e: 3, d: [1280] }`

### 错误的转换方式

```typescript
// ❌ 错误：直接使用 Number() 转换 Decimal 对象会返回 NaN
const price = Number(product.priceYearly)  // NaN
```

### 正确的转换方式

```typescript
// ✅ 正确：先转为字符串，再转为数字
const price = parseFloat(product.priceYearly.toString())  // 365
```

## 修复方案

### 1. 修改 `getUpgradeOptionsService` 函数

**文件**: `lexseek/server/services/membership/membershipUpgrade.service.ts`

```typescript
// 获取当前级别的商品和年价
const currentProduct = currentProducts.length > 0 ? currentProducts[0] : null
// Prisma Decimal 类型需要先转为字符串再转为数字
const currentYearlyPrice = currentProduct?.priceYearly
    ? parseFloat(currentProduct.priceYearly.toString())
    : 0

// 为每个更高级别计算升级价格
for (const level of higherLevels) {
    // ...
    const product = products[0]

    // Prisma Decimal 类型需要先转为字符串再转为数字
    const targetYearlyPrice = product.priceYearly
        ? parseFloat(product.priceYearly.toString())
        : 0

    // ...

    options.push({
        levelId: level.id,
        levelName: level.name,
        productId: product.id,
        productName: product.name,
        // Prisma Decimal 类型需要先转为字符串再转为数字
        priceMonthly: product.priceMonthly ? parseFloat(product.priceMonthly.toString()) : null,
        priceYearly: product.priceYearly ? parseFloat(product.priceYearly.toString()) : null,
        currentPrice: currentYearlyPrice,
        upgradePrice: priceResult.upgradePrice,
        pointCompensation: priceResult.pointCompensation,
        remainingDays,
    })
}
```

### 2. 修改 `calculateUpgradePrice` 函数

```typescript
export const calculateUpgradePrice = (
    currentMembership: userMemberships & { level: membershipLevels },
    targetLevel: membershipLevels,
    currentProduct: products | null,
    targetProduct: products,
    remainingDays: number
): UpgradePriceResult => {
    // 获取当前级别的日均价格（按年计算）
    // Prisma Decimal 类型需要先转为字符串再转为数字
    const currentYearlyPrice = currentProduct?.priceYearly
        ? parseFloat(currentProduct.priceYearly.toString())
        : (currentProduct?.priceMonthly ? parseFloat(currentProduct.priceMonthly.toString()) * 12 : 0)
    const currentDailyPrice = currentYearlyPrice / 365

    // 获取目标级别的日均价格
    const targetYearlyPrice = targetProduct.priceYearly
        ? parseFloat(targetProduct.priceYearly.toString())
        : (targetProduct.priceMonthly ? parseFloat(targetProduct.priceMonthly.toString()) * 12 : 0)
    const targetDailyPrice = targetYearlyPrice / 365

    // ... 其余计算逻辑保持不变
}
```

## 验证修复

### 1. 查询数据库商品数据

通过调试接口查询到的实际数据：

```json
{
  "products": [
    {
      "id": 1,
      "name": "基础版会员",
      "levelId": 1,
      "priceMonthly": { "s": 1, "e": 1, "d": [69] },
      "priceYearly": { "s": 1, "e": 2, "d": [365] }
    },
    {
      "id": 2,
      "name": "专业版会员",
      "levelId": 2,
      "priceMonthly": { "s": 1, "e": 2, "d": [149] },
      "priceYearly": { "s": 1, "e": 2, "d": [680] }
    },
    {
      "id": 10,
      "name": "新手旗舰套餐",
      "levelId": 3,
      "priceMonthly": { "s": 1, "e": 0, "d": [9, 9000000] },
      "priceYearly": { "s": 1, "e": 3, "d": [1280] }
    }
  ]
}
```

### 2. 测试升级接口

修复后，升级接口应该返回正确的价格数据：

```json
{
  "success": true,
  "data": {
    "currentMembership": {
      "id": 6,
      "levelId": 1,
      "levelName": "基础版",
      "remainingDays": 454
    },
    "options": [
      {
        "levelId": 2,
        "levelName": "专业版",
        "priceMonthly": 149,
        "priceYearly": 680,
        "currentPrice": 365,
        "upgradePrice": 391.78,
        "pointCompensation": 3918,
        "remainingDays": 454
      },
      {
        "levelId": 3,
        "levelName": "旗舰版",
        "priceMonthly": 9.9,
        "priceYearly": 1280,
        "currentPrice": 365,
        "upgradePrice": 1138.36,
        "pointCompensation": 11384,
        "remainingDays": 454
      }
    ]
  }
}
```

### 3. 前端显示验证

升级弹框应该正确显示：
- ✅ 当前价格：¥365
- ✅ 专业版升级价格：¥391.78
- ✅ 旗舰版升级价格：¥1138.36
- ✅ 积分补偿正确显示

## 价格计算示例

### 基础版升级到专业版

**数据**：
- 基础版年价：¥365
- 专业版年价：¥680
- 剩余天数：454 天

**计算过程**：
```
基础版日均价 = 365 / 365 = 1.00 元/天
专业版日均价 = 680 / 365 ≈ 1.863 元/天

基础版剩余价值 = 1.00 × 454 = 454.00 元
专业版剩余价值 = 1.863 × 454 ≈ 845.80 元

升级价格 = 845.80 - 454.00 = 391.80 元
积分补偿 = 391.80 × 10 = 3918 积分
```

## 相关文件

- `lexseek/server/services/membership/membershipUpgrade.service.ts` - 升级服务（已修复）
- `lexseek/docs/membership-upgrade-price-null-issue.md` - 问题排查文档
- `lexseek/docs/membership-upgrade-price-fix.md` - 价格计算修复文档

## 注意事项

1. **Prisma Decimal 类型处理**
   - 所有涉及 Decimal 类型的字段都需要先 `.toString()` 再 `parseFloat()`
   - 不能直接使用 `Number()` 转换，会返回 `NaN`

2. **其他可能需要修复的地方**
   - 所有查询商品价格的地方都需要检查是否正确转换
   - 订单金额、支付金额等涉及 Decimal 类型的字段

3. **数据库价格数据**
   - 确保数据库中商品价格字段有值
   - 价格单位为元（人民币），保留两位小数

## 修改日期

2025-01-29
