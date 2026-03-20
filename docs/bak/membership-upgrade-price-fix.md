# 会员升级价格显示修复说明

## 问题描述

升级弹框中显示的价格为"¥"（没有数字），无法看到实际的升级价格和当前价格。

## 根本原因

### 1. 缺少 currentPrice 字段

后端返回的 `UpgradeOption` 类型中没有 `currentPrice` 字段，但前端升级弹框期望显示当前价格。

**后端类型定义**（修改前）：
```typescript
export interface UpgradeOption {
    levelId: number
    levelName: string
    productId: number
    productName: string
    priceMonthly: number | null
    priceYearly: number | null
    upgradePrice: number  // 只有升级价格
    pointCompensation: number
    remainingDays: number
}
```

**前端期望的类型**：
```typescript
interface UpgradeOption {
    levelId: number;
    levelName: string;
    upgradePrice: number;
    currentPrice: number;  // 前端需要这个字段
    pointCompensation: number;
}
```

### 2. 升级价格计算错误

`calculateUpgradePrice` 函数中，当前级别的日均价格被硬编码为 0，导致升级价格计算不正确。

**错误代码**：
```typescript
export const calculateUpgradePrice = (
    currentMembership: userMemberships & { level: membershipLevels },
    targetLevel: membershipLevels,
    targetProduct: products,
    remainingDays: number
): UpgradePriceResult => {
    // ❌ 错误：硬编码为 0
    const currentDailyPrice = 0 // 简化处理，实际应查询商品价格
    
    // 计算目标级别的日均价格
    const targetYearlyPrice = targetProduct.priceYearly
        ? Number(targetProduct.priceYearly)
        : (targetProduct.priceMonthly ? Number(targetProduct.priceMonthly) * 12 : 0)
    const targetDailyPrice = targetYearlyPrice / 365
    
    // 计算升级价格
    const originalRemainingValue = currentDailyPrice * remainingDays  // 始终为 0
    const targetRemainingValue = targetDailyPrice * remainingDays
    const upgradePrice = Math.max(0, targetRemainingValue - originalRemainingValue)
    
    // 结果：upgradePrice = targetRemainingValue（不正确）
}
```

## 解决方案

### 1. 添加 currentPrice 字段

在后端 `UpgradeOption` 类型中添加 `currentPrice` 字段，并在获取升级选项时查询当前级别的商品价格。

### 2. 修正升级价格计算

修改 `calculateUpgradePrice` 函数，接收当前商品作为参数，正确计算当前级别的日均价格。

## 修改内容

### 1. 更新 UpgradeOption 类型定义

**文件**：`lexseek/server/services/membership/membershipUpgrade.service.ts`

**修改位置**：第 24-35 行

```typescript
/** 升级选项 */
export interface UpgradeOption {
    levelId: number
    levelName: string
    productId: number
    productName: string
    priceMonthly: number | null
    priceYearly: number | null
    currentPrice: number // ✅ 新增：当前级别商品价格
    upgradePrice: number
    pointCompensation: number
    remainingDays: number
}
```

### 2. 修改 getUpgradeOptionsService 函数

**文件**：`lexseek/server/services/membership/membershipUpgrade.service.ts`

**修改位置**：第 65-110 行

```typescript
// 查找当前级别对应的商品（用于获取当前价格）
const currentProducts = await prisma.products.findMany({
    where: {
        levelId: currentMembership.levelId,
        type: ProductType.MEMBERSHIP,
        status: 1,
        deletedAt: null,
    },
    orderBy: { sortOrder: 'asc' },
})

// 获取当前级别的商品和年价
const currentProduct = currentProducts.length > 0 ? currentProducts[0] : null
const currentYearlyPrice = currentProduct?.priceYearly
    ? Number(currentProduct.priceYearly)
    : 0

// 为每个更高级别计算升级价格
for (const level of higherLevels) {
    // ... 查找目标商品
    
    // 计算升级价格（传入当前商品）
    const priceResult = calculateUpgradePrice(
        currentMembership,
        level,
        currentProduct, // ✅ 传入当前商品
        product,
        remainingDays
    )
    
    options.push({
        // ...
        currentPrice: currentYearlyPrice, // ✅ 添加当前价格
        upgradePrice: priceResult.upgradePrice,
        // ...
    })
}
```

### 3. 修改 calculateUpgradePrice 函数

**文件**：`lexseek/server/services/membership/membershipUpgrade.service.ts`

**修改位置**：第 132-170 行

```typescript
/**
 * 计算升级价格
 * @param currentMembership 当前会员记录
 * @param targetLevel 目标级别
 * @param currentProduct 当前级别商品 ✅ 新增参数
 * @param targetProduct 目标商品
 * @param remainingDays 剩余天数
 * @returns 升级价格计算结果
 */
export const calculateUpgradePrice = (
    currentMembership: userMemberships & { level: membershipLevels },
    targetLevel: membershipLevels,
    currentProduct: products | null, // ✅ 新增参数
    targetProduct: products,
    remainingDays: number
): UpgradePriceResult => {
    // ✅ 正确计算当前级别的日均价格
    const currentYearlyPrice = currentProduct?.priceYearly
        ? Number(currentProduct.priceYearly)
        : (currentProduct?.priceMonthly ? Number(currentProduct.priceMonthly) * 12 : 0)
    const currentDailyPrice = currentYearlyPrice / 365
    
    // 获取目标级别的日均价格
    const targetYearlyPrice = targetProduct.priceYearly
        ? Number(targetProduct.priceYearly)
        : (targetProduct.priceMonthly ? Number(targetProduct.priceMonthly) * 12 : 0)
    const targetDailyPrice = targetYearlyPrice / 365
    
    // 计算原级别剩余价值
    const originalRemainingValue = currentDailyPrice * remainingDays
    
    // 计算目标级别剩余价值
    const targetRemainingValue = targetDailyPrice * remainingDays
    
    // 升级价格 = 目标级别剩余价值 - 原级别剩余价值
    const upgradePrice = Math.max(0, Math.round((targetRemainingValue - originalRemainingValue) * 100) / 100)
    
    // 积分补偿 = 升级价格 × 10
    const pointCompensation = Math.round(upgradePrice * 10)
    
    return {
        originalRemainingValue: Math.round(originalRemainingValue * 100) / 100,
        targetRemainingValue: Math.round(targetRemainingValue * 100) / 100,
        upgradePrice,
        pointCompensation,
    }
}
```

### 4. 更新其他调用位置

同时更新了以下函数中对 `calculateUpgradePrice` 的调用：

1. **calculateUpgradePriceService**（第 220-240 行）
   - 查询当前级别商品
   - 传入当前商品参数

2. **executeMembershipUpgradeService**（第 300-320 行）
   - 查询当前级别商品
   - 传入当前商品参数

## 升级价格计算逻辑

### 计算公式

```
当前级别年价 = currentProduct.priceYearly
目标级别年价 = targetProduct.priceYearly

当前级别日均价 = 当前级别年价 / 365
目标级别日均价 = 目标级别年价 / 365

当前级别剩余价值 = 当前级别日均价 × 剩余天数
目标级别剩余价值 = 目标级别日均价 × 剩余天数

升级价格 = 目标级别剩余价值 - 当前级别剩余价值
积分补偿 = 升级价格 × 10
```

### 示例计算

**场景**：基础版升级到专业版

**数据**：
- 基础版年价：¥128
- 专业版年价：¥298
- 剩余天数：180 天

**计算过程**：
```
基础版日均价 = 128 / 365 ≈ 0.35 元/天
专业版日均价 = 298 / 365 ≈ 0.82 元/天

基础版剩余价值 = 0.35 × 180 = 63 元
专业版剩余价值 = 0.82 × 180 = 147.6 元

升级价格 = 147.6 - 63 = 84.6 元
积分补偿 = 84.6 × 10 = 846 积分
```

## 验证场景

### 场景 1：基础版升级到专业版

**前提条件**：
- 用户当前是基础版会员
- 基础版年价：¥128
- 专业版年价：¥298
- 会员剩余 180 天

**预期结果**：
- ✅ 显示当前价格：¥128
- ✅ 显示升级价格：约 ¥85
- ✅ 显示积分补偿：约 850 积分

### 场景 2：基础版升级到旗舰版

**前提条件**：
- 用户当前是基础版会员
- 基础版年价：¥128
- 旗舰版年价：¥598
- 会员剩余 180 天

**预期结果**：
- ✅ 显示当前价格：¥128
- ✅ 显示升级价格：约 ¥232
- ✅ 显示积分补偿：约 2320 积分

### 场景 3：专业版升级到旗舰版

**前提条件**：
- 用户当前是专业版会员
- 专业版年价：¥298
- 旗舰版年价：¥598
- 会员剩余 180 天

**预期结果**：
- ✅ 显示当前价格：¥298
- ✅ 显示升级价格：约 ¥148
- ✅ 显示积分补偿：约 1480 积分

### 场景 4：会员即将到期

**前提条件**：
- 用户当前是基础版会员
- 基础版年价：¥128
- 专业版年价：¥298
- 会员剩余 10 天

**预期结果**：
- ✅ 显示当前价格：¥128
- ✅ 显示升级价格：约 ¥5
- ✅ 显示积分补偿：约 50 积分

## 注意事项

1. **价格精度**
   - 所有价格计算保留两位小数
   - 使用 `Math.round(price * 100) / 100` 进行四舍五入

2. **月价转年价**
   - 如果商品只有月价，年价 = 月价 × 12
   - 如果商品既有月价又有年价，优先使用年价

3. **剩余天数计算**
   - 使用 dayjs 计算当前日期到会员结束日期的天数
   - 不足 1 天按 0 天计算

4. **积分补偿**
   - 积分补偿 = 升级价格 × 10
   - 向下取整（使用 `Math.round`）

5. **负数处理**
   - 升级价格不会为负数（使用 `Math.max(0, ...)` 确保）
   - 理论上不应该出现负数，因为只能升级到更高级别

## 相关文件

### 已修改
- ✅ `lexseek/server/services/membership/membershipUpgrade.service.ts` - 会员升级服务

### 相关组件
- `lexseek/app/components/membership/MembershipUpgradeDialog.vue` - 升级弹框组件
- `lexseek/app/pages/dashboard/membership/level.vue` - 会员级别页面

### 后端 API
- `GET /api/v1/memberships/upgrade/options` - 获取升级选项（已修复）
- `POST /api/v1/memberships/upgrade/calculate` - 计算升级价格（已修复）

## 修改日期

2025-01-XX
