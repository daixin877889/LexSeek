# 设计文档

## 概述

本设计文档描述了会员升级价格计算的修复方案，将剩余价值计算方式从"套餐比例"改为"实际剩余天数"。

## 架构

### 问题分析

**当前逻辑**：
```
剩余比例 = 剩余天数 / 总天数
当前剩余价值 = 实付金额 × 剩余比例
目标剩余价值 = 目标年价 × 剩余比例
升级价格 = 目标剩余价值 - 当前剩余价值
```

**问题**：这种计算方式虽然数学上等价，但概念上不够直观，且在某些边界情况下可能产生精度问题。

**新逻辑**：
```
日均价值 = 实付金额 / 总天数
当前剩余价值 = 日均价值 × 剩余天数
目标日均价值 = 目标年价 / 365
目标剩余价值 = 目标日均价值 × 剩余天数
升级价格 = 目标剩余价值 - 当前剩余价值
```

### 修复方案

修改 `server/services/membership/membershipUpgrade.service.ts` 中的 `calculateUpgradePrice` 函数：

```typescript
/**
 * 计算升级价格
 * 
 * 计算逻辑（按实际剩余天数）：
 * 1. 日均价值 = 实付金额 / 套餐总天数
 * 2. 当前剩余价值 = 日均价值 × 剩余天数
 * 3. 目标日均价值 = 目标级别年价 / 365
 * 4. 目标剩余价值 = 目标日均价值 × 剩余天数
 * 5. 升级价格 = 目标剩余价值 - 当前剩余价值
 * 
 * 举例：用户花 365 元购买基础版（365天），剩余 100 天，升级到专业版（680元/年）
 * - 日均价值 = 365 / 365 = 1 元/天
 * - 当前剩余价值 = 1 × 100 = 100 元
 * - 目标日均价值 = 680 / 365 ≈ 1.863 元/天
 * - 目标剩余价值 = 1.863 × 100 ≈ 186.30 元
 * - 升级价格 = 186.30 - 100 = 86.30 元
 */
export const calculateUpgradePrice = (
    currentMembership: userMemberships & { level: membershipLevels },
    targetLevel: membershipLevels,
    currentProduct: products | null,
    targetProduct: products,
    remainingDays: number,
    paidAmount: number = 0
): UpgradePriceResult => {
    // 计算当前会员记录的总时长（天数）
    const totalDays = dayjs(currentMembership.endDate).diff(dayjs(currentMembership.startDate), 'day')

    // 计算实际剩余天数：确保不超过总天数，且不为负数
    const actualRemainingDays = Math.max(0, Math.min(remainingDays, totalDays))

    // 计算日均价值（实付金额 / 总天数）
    const dailyValue = totalDays > 0 ? paidAmount / totalDays : 0

    // 当前剩余价值 = 日均价值 × 实际剩余天数
    const originalRemainingValue = dailyValue * actualRemainingDays

    // 获取目标级别的年价
    let targetYearlyPrice = 0
    if (targetProduct.priceYearly !== null && targetProduct.priceYearly !== undefined) {
        targetYearlyPrice = decimalToNumberUtils(targetProduct.priceYearly)
    } else if (targetProduct.priceMonthly !== null && targetProduct.priceMonthly !== undefined) {
        targetYearlyPrice = decimalToNumberUtils(targetProduct.priceMonthly) * 12
    }

    // 目标日均价值 = 目标年价 / 365
    const targetDailyValue = targetYearlyPrice / 365

    // 目标剩余价值 = 目标日均价值 × 实际剩余天数
    const targetRemainingValue = targetDailyValue * actualRemainingDays

    // 升级价格 = 目标剩余价值 - 当前剩余价值（不能为负数，四舍五入到分）
    const upgradePrice = Math.max(0, Math.round((targetRemainingValue - originalRemainingValue) * 100) / 100)

    // 积分补偿 = 升级价格 × 10
    const pointCompensation = Math.round(upgradePrice * 10)

    // 调试日志
    logger.debug(`升级价格计算: 实付金额=${paidAmount}, 总天数=${totalDays}, 剩余天数=${remainingDays}, 实际剩余天数=${actualRemainingDays}, 日均价值=${dailyValue.toFixed(4)}, 当前剩余价值=${originalRemainingValue.toFixed(2)}, 目标年价=${targetYearlyPrice}, 目标日均价值=${targetDailyValue.toFixed(4)}, 目标剩余价值=${targetRemainingValue.toFixed(2)}, 升级价格=${upgradePrice}`)

    return {
        originalRemainingValue: Math.round(originalRemainingValue * 100) / 100,
        targetRemainingValue: Math.round(targetRemainingValue * 100) / 100,
        upgradePrice,
        pointCompensation,
    }
}
```

## 组件和接口

### 升级价格计算结果接口

```typescript
interface UpgradePriceResult {
    originalRemainingValue: number  // 当前剩余价值
    targetRemainingValue: number    // 目标剩余价值
    upgradePrice: number            // 升级价格
    pointCompensation: number       // 积分补偿
}
```

### 计算公式

| 变量 | 公式 | 说明 |
|------|------|------|
| 日均价值 | 实付金额 / 总天数 | 当前会员每天的价值 |
| 当前剩余价值 | 日均价值 × 剩余天数 | 当前会员剩余时间的价值 |
| 目标日均价值 | 目标年价 / 365 | 目标级别每天的价值 |
| 目标剩余价值 | 目标日均价值 × 剩余天数 | 目标级别剩余时间的价值 |
| 升级价格 | max(0, 目标剩余价值 - 当前剩余价值) | 需要支付的差价 |

## 数据模型

无需修改数据模型，仅修改计算逻辑。

## 正确性属性

*正确性属性是系统在所有有效执行中应保持为真的特征或行为——本质上是关于系统应该做什么的形式化陈述。属性作为人类可读规范和机器可验证正确性保证之间的桥梁。*

### Property 1: 当前剩余价值计算正确性

*For any* 有效的实付金额、总天数和剩余天数，当前剩余价值 SHALL 等于 (实付金额 / 总天数) × 剩余天数，精度保留两位小数。

**Validates: Requirements 1.1, 1.2**

### Property 2: 目标剩余价值计算正确性

*For any* 有效的目标年价和剩余天数，目标剩余价值 SHALL 等于 (目标年价 / 365) × 剩余天数，精度保留两位小数。

**Validates: Requirements 2.1, 2.2**

### Property 3: 升级价格计算正确性

*For any* 有效的当前剩余价值和目标剩余价值，升级价格 SHALL 等于 max(0, 目标剩余价值 - 当前剩余价值)，精度保留两位小数。

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 4: 剩余天数约束

*For any* 计算过程中使用的剩余天数，SHALL 满足 0 ≤ 剩余天数 ≤ 总天数。

**Validates: Requirements 1.4**

### Property 5: 升级后结束时间不变

*For any* 会员升级操作，升级后的会员结束时间 SHALL 等于升级前的会员结束时间。

**Validates: Requirements 2.4**

## 错误处理

### 边界情况

1. **实付金额为 0**：日均价值为 0，当前剩余价值为 0，升级价格等于目标剩余价值
2. **总天数为 0**：日均价值为 0，当前剩余价值为 0
3. **剩余天数为负数**：实际剩余天数设为 0
4. **剩余天数超过总天数**：实际剩余天数设为总天数
5. **目标级别只有月价**：使用月价 × 12 作为年价

## 测试策略

### 单元测试

1. **计算示例测试**：
   - 测试需求 4.1 的示例：365 元/365 天，剩余 100 天，升级到 680 元/年
   - 测试需求 4.2 的示例：兑换码会员（实付 0 元），剩余 100 天，升级到 680 元/年

2. **边界条件测试**：
   - 实付金额为 0
   - 剩余天数为 0
   - 剩余天数等于总天数
   - 只有月价没有年价

### 属性测试

使用 `fast-check` 进行属性测试，每个测试至少运行 100 次：

1. **Property 1 测试**: 验证当前剩余价值计算公式
2. **Property 2 测试**: 验证目标剩余价值计算公式
3. **Property 3 测试**: 验证升级价格计算公式
4. **Property 4 测试**: 验证剩余天数约束
5. **Property 5 测试**: 验证升级后结束时间不变
