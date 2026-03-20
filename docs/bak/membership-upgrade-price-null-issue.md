# 会员升级价格为 null 问题排查

## 问题描述

升级接口返回的数据中，所有价格字段都是 `null`：

```json
{
  "options": [
    {
      "levelId": 2,
      "levelName": "专业版",
      "productId": 2,
      "productName": "专业版会员",
      "priceMonthly": null,
      "priceYearly": null,
      "currentPrice": null,
      "upgradePrice": null,
      "pointCompensation": null,
      "remainingDays": 454
    }
  ]
}
```

## 根本原因

数据库中的商品数据没有设置 `price_yearly` 和 `price_monthly` 字段，导致：

1. `product.priceYearly` 为 `null`
2. `product.priceMonthly` 为 `null`
3. 无法计算升级价格
4. 所有价格相关字段都返回 `null`

## 排查步骤

### 1. 检查数据库商品数据

执行以下 SQL 查询，检查商品表中的价格数据：

```sql
SELECT 
    id,
    name,
    type,
    level_id,
    price_monthly,
    price_yearly,
    unit_price,
    status
FROM products
WHERE type = 1  -- 会员商品
  AND status = 1  -- 上架状态
  AND deleted_at IS NULL
ORDER BY level_id, sort_order;
```

**预期结果**：
- 基础版商品应该有 `price_yearly` 或 `price_monthly`
- 专业版商品应该有 `price_yearly` 或 `price_monthly`
- 旗舰版商品应该有 `price_yearly` 或 `price_monthly`

**实际结果**（如果价格为 null）：
```
id | name       | level_id | price_monthly | price_yearly | status
---|------------|----------|---------------|--------------|-------
1  | 基础版会员  | 1        | NULL          | NULL         | 1
2  | 专业版会员  | 2        | NULL          | NULL         | 1
10 | 新手旗舰套餐| 3        | NULL          | NULL         | 1
```

### 2. 查看服务端日志

添加了调试日志后，查看服务端输出：

```
当前会员级别 1 的商品信息：{
  productId: 1,
  productName: '基础版会员',
  priceYearly: null,
  priceMonthly: null,
  currentYearlyPrice: 0
}

目标级别 2 (专业版) 的商品信息：{
  productId: 2,
  productName: '专业版会员',
  priceYearly: null,
  priceMonthly: null
}
```

## 解决方案

### 方案 1：更新数据库商品价格（推荐）

执行以下 SQL 更新商品价格：

```sql
-- 更新基础版价格
UPDATE products
SET 
    price_yearly = 128.00,
    price_monthly = 12.80,
    original_price_yearly = 158.00,
    original_price_monthly = 15.80,
    updated_at = NOW()
WHERE id = 1 AND name = '基础版会员';

-- 更新专业版价格
UPDATE products
SET 
    price_yearly = 298.00,
    price_monthly = 29.80,
    original_price_yearly = 398.00,
    original_price_monthly = 39.80,
    updated_at = NOW()
WHERE id = 2 AND name = '专业版会员';

-- 更新旗舰版价格
UPDATE products
SET 
    price_yearly = 598.00,
    price_monthly = 59.80,
    original_price_yearly = 798.00,
    original_price_monthly = 79.80,
    updated_at = NOW()
WHERE id = 10 AND name LIKE '%旗舰%';
```

### 方案 2：通过管理后台设置价格

如果有商品管理后台，可以通过后台界面设置商品价格：

1. 登录管理后台
2. 进入商品管理页面
3. 编辑每个会员商品
4. 设置月度价格和年度价格
5. 保存

### 方案 3：检查商品创建逻辑

如果是新创建的商品，检查商品创建 API 是否正确设置了价格字段：

```typescript
// 创建商品时应该包含价格
await prisma.products.create({
    data: {
        name: '专业版会员',
        type: ProductType.MEMBERSHIP,
        levelId: 2,
        priceMonthly: 29.80,  // ✅ 必须设置
        priceYearly: 298.00,  // ✅ 必须设置
        defaultDuration: 2,   // 2-按年
        status: 1,
        // ...
    }
})
```

## 验证修复

### 1. 重新查询商品数据

```sql
SELECT 
    id,
    name,
    level_id,
    price_monthly,
    price_yearly,
    status
FROM products
WHERE type = 1 AND status = 1 AND deleted_at IS NULL
ORDER BY level_id;
```

**预期结果**：
```
id | name       | level_id | price_monthly | price_yearly | status
---|------------|----------|---------------|--------------|-------
1  | 基础版会员  | 1        | 12.80         | 128.00       | 1
2  | 专业版会员  | 2        | 29.80         | 298.00       | 1
10 | 新手旗舰套餐| 3        | 59.80         | 598.00       | 1
```

### 2. 重新调用升级接口

```bash
curl -X GET 'http://localhost:3000/api/v1/memberships/upgrade/options' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

**预期返回**：
```json
{
  "success": true,
  "data": {
    "currentMembership": {
      "id": 6,
      "levelId": 1,
      "levelName": "基础版",
      "endDate": "2027-03-28T15:59:59.999Z",
      "remainingDays": 454
    },
    "options": [
      {
        "levelId": 2,
        "levelName": "专业版",
        "productId": 2,
        "productName": "专业版会员",
        "priceMonthly": 29.80,
        "priceYearly": 298.00,
        "currentPrice": 128.00,
        "upgradePrice": 211.47,
        "pointCompensation": 2115,
        "remainingDays": 454
      },
      {
        "levelId": 3,
        "levelName": "旗舰版",
        "productId": 10,
        "productName": "新手旗舰套餐",
        "priceMonthly": 59.80,
        "priceYearly": 598.00,
        "currentPrice": 128.00,
        "upgradePrice": 584.93,
        "pointCompensation": 5849,
        "remainingDays": 454
      }
    ]
  }
}
```

### 3. 检查前端显示

访问会员升级页面，应该能看到：
- ✅ 当前价格：¥128
- ✅ 专业版升级价格：¥211.47
- ✅ 旗舰版升级价格：¥584.93
- ✅ 积分补偿正确显示

## 价格计算说明

### 计算公式

```
当前级别日均价 = 当前级别年价 / 365
目标级别日均价 = 目标级别年价 / 365

当前级别剩余价值 = 当前级别日均价 × 剩余天数
目标级别剩余价值 = 目标级别日均价 × 剩余天数

升级价格 = 目标级别剩余价值 - 当前级别剩余价值
积分补偿 = 升级价格 × 10
```

### 示例计算（基础版升级到专业版）

**数据**：
- 基础版年价：¥128
- 专业版年价：¥298
- 剩余天数：454 天

**计算过程**：
```
基础版日均价 = 128 / 365 ≈ 0.3507 元/天
专业版日均价 = 298 / 365 ≈ 0.8164 元/天

基础版剩余价值 = 0.3507 × 454 ≈ 159.22 元
专业版剩余价值 = 0.8164 × 454 ≈ 370.65 元

升级价格 = 370.65 - 159.22 = 211.43 元
积分补偿 = 211.43 × 10 = 2114 积分
```

## 注意事项

1. **价格单位**
   - 数据库中价格字段类型为 `Decimal(10, 2)`
   - 单位为元（人民币）
   - 保留两位小数

2. **月价和年价关系**
   - 年价通常不等于月价 × 12（有折扣）
   - 升级价格计算优先使用年价
   - 如果只有月价，年价 = 月价 × 12

3. **默认售卖时长**
   - `default_duration = 1`：按月售卖
   - `default_duration = 2`：按年售卖
   - 影响前端显示的默认价格

4. **商品状态**
   - `status = 1`：上架（可购买）
   - `status = 0`：下架（不可购买）
   - 升级选项只显示上架商品

## 相关文件

- `lexseek/server/services/membership/membershipUpgrade.service.ts` - 升级服务（已添加调试日志）
- `lexseek/prisma/models/product.prisma` - 商品表结构
- `lexseek/docs/membership-upgrade-price-fix.md` - 价格计算修复文档

## 修改日期

2025-01-XX
