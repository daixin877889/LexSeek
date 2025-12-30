# 支付订单号优化说明

## 问题描述

之前的实现中，创建支付时传给微信支付的 `out_trade_no` 使用的是 **PAY 开头的支付单号**，导致：

1. 用户在微信支付页面看到的是 PAY 开头的支付单号
2. 用户在系统订单列表中看到的是 LSD 开头的订单号
3. 客服在微信后台查询时需要使用 PAY 号，但用户只知道 LSD 号
4. 排查支付问题时需要额外的映射关系，增加了复杂度

## 解决方案

**将传给微信支付的订单号改为 LSD 开头的业务订单号**

### 优势

1. **用户体验更好**：用户只需要记住一个订单号（LSD）
2. **客服更方便**：用户发送支付截图时，截图中显示的订单号就是 LSD，客服可以直接在系统中查询
3. **统一标识**：整个业务流程中使用同一个订单号，避免混淆
4. **符合直觉**：用户下单时看到的订单号，在微信支付时也是同一个

## 修改内容

### 1. 修改支付创建逻辑

**文件**：`lexseek/server/services/payment/payment.service.ts`

**修改点**：
- 调用支付适配器时，传入 `order.orderNo`（LSD 订单号）而不是 `transaction.transactionNo`（PAY 支付单号）

```typescript
// 修改前
const paymentResult = await adapter.createPayment({
    orderNo: transaction.transactionNo, // PAY 开头
    // ...
})

// 修改后
const paymentResult = await adapter.createPayment({
    orderNo: order.orderNo, // LSD 开头
    // ...
})
```

### 2. 修改支付回调处理逻辑

**文件**：`lexseek/server/services/payment/payment.service.ts`

**修改点**：
- 微信回调返回的 `out_trade_no` 现在是 LSD 订单号
- 通过订单号查询订单，再查询该订单的待支付支付单

```typescript
// 修改前
const transaction = await findPaymentTransactionByNoDao(orderNo!) // 通过 PAY 号查询支付单

// 修改后
const order = await findOrderByOrderNoDao(orderNo!) // 通过 LSD 号查询订单
const transaction = await findPendingTransactionByOrderIdDao(order.id) // 查询待支付支付单
```

### 3. 修改主动查询逻辑

**文件**：`lexseek/server/services/payment/payment.service.ts`

**修改点**：
- 主动查询支付结果时，使用订单号而不是支付单号

```typescript
// 修改前
const queryResult = await adapter.queryOrder({ orderNo: transactionNo }) // 使用 PAY 号

// 修改后
const queryResult = await adapter.queryOrder({ orderNo: transaction.order.orderNo }) // 使用 LSD 号
```

## 数据流程

### 修改前

```
用户下单 → 创建订单(LSD) → 发起支付 → 创建支付单(PAY) → 调用微信支付API(传入PAY) 
→ 微信返回prepay_id → 用户支付(看到PAY) → 微信回调(返回PAY) → 更新支付单和订单
```

### 修改后

```
用户下单 → 创建订单(LSD) → 发起支付 → 创建支付单(PAY) → 调用微信支付API(传入LSD) 
→ 微信返回prepay_id → 用户支付(看到LSD) → 微信回调(返回LSD) → 更新支付单和订单
```

## 注意事项

1. **订单号唯一性**：LSD 订单号已有唯一索引，可以安全使用
2. **支付单号保留**：PAY 支付单号仍然保留，作为系统内部的支付记录标识
3. **向后兼容**：已有的 PAY 支付单号不受影响，只影响新创建的支付
4. **微信后台查询**：现在可以直接使用 LSD 订单号在微信后台查询

## 测试建议

1. 创建新订单并发起支付，检查微信支付页面显示的订单号是否为 LSD 开头
2. 完成支付后，检查微信回调是否正常处理
3. 在微信商户后台使用 LSD 订单号查询交易记录
4. 测试主动查询支付结果功能是否正常

## 相关文件

- `lexseek/server/services/payment/payment.service.ts` - 支付服务层
- `lexseek/server/services/payment/order.dao.ts` - 订单数据访问层
- `lexseek/server/services/payment/paymentTransaction.dao.ts` - 支付单数据访问层
- `lexseek/server/lib/payment/adapters/wechat-pay.ts` - 微信支付适配器

## 修改日期

2025-01-XX
