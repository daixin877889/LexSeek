# 商品价格显示修复说明

## 修复内容

### 1. 数据库 Schema 更新
已添加以下字段到 `products` 表：
- `description` - 商品描述
- `category` - 商品分类
- `defaultDuration` - 默认售卖时长（1=月，2=年）
- `originalPriceMonthly` - 月度原价
- `originalPriceYearly` - 年度原价
- `originalUnitPrice` - 积分单价原价
- `minQuantity` - 最小购买数量（默认1）
- `maxQuantity` - 最大购买数量

### 2. 前端组件更新

#### 会员套餐页面 (`/dashboard/membership/level`)
- 修复了原价字段映射
- 原价会从 `originalPriceMonthly` 和 `originalPriceYearly` 读取
- 如果没有设置原价，会回退使用现价

#### 会员套餐列表组件
- 只有当原价 > 现价时才显示划线价格
- 添加了货币符号 `¥`
- 优化了布局，赠送积分单独显示

#### 积分购买页面 (`/dashboard/membership/point`)
- 添加了原价支持
- 显示积分数量
- 只有当原价 > 现价时才显示划线价格

### 3. 后端服务更新
- 商品服务层已支持所有新字段
- API 返回包含所有价格相关字段

## 使用说明

### 更新现有商品的原价

1. 连接到数据库
2. 执行 SQL 脚本：
```bash
psql -U your_user -d ls_new -f scripts/update-product-prices.sql
```

或者手动更新：
```sql
-- 更新会员商品原价（示例：设置为现价的1.2倍）
UPDATE products
SET 
    original_price_monthly = price_monthly * 1.2,
    original_price_yearly = price_yearly * 1.2
WHERE type = 1 AND deleted_at IS NULL;

-- 更新积分商品原价
UPDATE products
SET original_unit_price = unit_price * 1.2
WHERE type = 2 AND deleted_at IS NULL;
```

### 创建新商品时设置原价

在插入新商品时，记得设置原价字段：

```sql
INSERT INTO products (
    name, type, level_id,
    price_monthly, original_price_monthly,
    price_yearly, original_price_yearly,
    gift_point, status, sort_order
) VALUES (
    '专业版会员', 1, 2,
    149.00, 199.00,  -- 月度价格和原价
    680.00, 899.00,  -- 年度价格和原价
    6800, 1, 3
);
```

## 价格显示逻辑

### 会员商品
- 根据 `defaultDuration` 字段决定显示月付还是年付价格
- `defaultDuration = 1` 显示月付价格
- `defaultDuration = 2` 显示年付价格（默认）
- 只有当 `originalPrice > currentPrice` 时才显示划线原价

### 积分商品
- 显示 `unitPrice` 作为售价
- 显示 `pointAmount` 作为积分数量
- 只有当 `originalUnitPrice > unitPrice` 时才显示划线原价

## 注意事项

1. **原价必须大于现价**：只有当原价大于现价时，前端才会显示划线价格
2. **默认值**：如果没有设置原价，前端会使用现价作为回退值，但不会显示划线
3. **数据一致性**：确保原价和现价的数据类型一致（都是 Decimal(10,2)）
4. **重启服务**：修改数据库后，需要重启开发服务器以重新生成 Prisma 客户端类型

## 测试

1. 访问 `/dashboard/membership/level` 查看会员套餐价格
2. 访问 `/dashboard/membership/point` 查看积分商品价格
3. 确认原价显示正确（只有当原价 > 现价时才显示）
4. 确认赠送积分数量显示正确
