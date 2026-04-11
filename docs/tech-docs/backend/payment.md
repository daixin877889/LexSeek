# 支付系统模块

支付系统模块提供订单生命周期管理（创建→支付→回调→履约）、支付适配器抽象层、微信支付 V3 集成，以及支付成功后的业务履约处理器链。

## 模块架构

```
server/services/payment/
├── order.dao.ts                    # 订单 DAO
├── order.service.ts                # 订单 Service
├── paymentTransaction.dao.ts       # 支付单 DAO
├── payment.service.ts              # 支付 Service（核心：创建支付、处理回调）
└── handlers/
    ├── types.ts                    # 处理器接口定义
    ├── index.ts                    # 处理器注册与分发
    ├── membershipHandler.ts        # 会员新购处理器
    ├── pointsHandler.ts            # 积分购买处理器
    └── upgradeHandler.ts           # 会员升级处理器

server/lib/payment/
├── types.ts                        # 支付适配器类型定义
├── base.ts                         # 适配器基类 + 接口
├── errors.ts                       # 支付错误类型
├── factory.ts                      # 适配器工厂（缓存 + 配置读取）
├── index.ts                        # 导出入口
└── adapters/
    └── wechat-pay.ts               # 微信支付 V3 适配器
```

## 1. 订单生命周期

### 订单状态流转

```
PENDING（待支付） → PAID（已支付） → [履约完成]
PENDING → CANCELLED（已取消：用户主动 / 过期自动取消）
```

**订单类型**（`OrderType`）：
- `PURCHASE` — 新购
- `UPGRADE` — 升级
- `RENEWAL` — 续费

**时长单位**（`DurationUnit`）：
- `day` — 天
- `month` — 月
- `year` — 年

### order.dao.ts

| 方法 | 说明 |
|------|------|
| `generateOrderNo` | 生成订单号：`LSD` + 年月日时分秒 + 6 位随机数 |
| `createOrderDao` | 创建订单 |
| `findOrderByIdDao` | 按 ID 查询（include product + user） |
| `findOrderByOrderNoDao` | 按订单号查询 |
| `findUserOrdersDao` | 用户订单列表（分页） |
| `updateOrderStatusDao` | 更新状态 + paidAt |
| `findExpiredPendingOrdersDao` | 查询过期未支付订单 |
| `cancelExpiredOrdersDao` | 批量取消过期订单 |
| `countUserProductOrdersDao` | 统计用户购买某商品次数（**只统计 PURCHASE 类型**，升级不计入限购） |

### order.service.ts

| 方法 | 说明 |
|------|------|
| `createOrderService` | 创建订单：验证商品状态 → 检查限购 → 计算金额 → 创建（过期时间 30 分钟） |
| `getUserOrdersService` | 用户订单列表 |
| `cancelOrderService` | 取消订单（验证权限 + 状态） |
| `handleExpiredOrdersService` | 定时任务：批量取消过期订单 |
| `checkOrderPayableService` | 检查订单是否可支付 |

**金额计算逻辑**：
- `customAmount`（升级场景）：直接使用
- 会员套餐（`product.type=1`）：按 durationUnit 选月价/年价 × duration
- 积分包：unitPrice × duration（数量）

## 2. 支付服务

### paymentTransaction.dao.ts

| 方法 | 说明 |
|------|------|
| `generateTransactionNo` | 生成支付单号：`PAY` + 年月日时分秒 + 6 位随机数 |
| `createPaymentTransactionDao` | 创建支付单 |
| `findPendingTransactionByOrderIdDao` | 查询订单的待支付支付单（未过期） |
| `updatePaymentTransactionDao` | 更新状态/outTradeNo/callbackData |
| `findExpiredPendingTransactionsDao` | 查询过期待支付支付单 |
| `expirePaymentTransactionsDao` | 批量标记为过期 |

### payment.service.ts

**创建支付 — `createPaymentService`**：

```
1. 验证订单存在 + 状态为 PENDING + 未过期
2. 检查是否有未过期的待支付支付单
   - 同渠道同方式 → 重新获取支付参数（复用支付单）
   - 不同渠道/方式 → 旧支付单标记过期
3. 创建新支付单（过期时间 30 分钟）
4. 调用支付适配器创建支付（金额转为分）
5. 返回支付参数（paymentParams / codeUrl / h5Url）
```

**处理回调 — `handlePaymentCallbackService`**：

```
1. 验证回调签名（adapter.verifyCallback）
2. 通过 orderNo 查找订单
3. 查找订单的待支付支付单
4. 幂等检查（已成功则跳过）
5. 验证金额匹配
6. 事务处理：
   a. 事务内再次检查状态（防并发）
   b. 更新支付单状态 → SUCCESS
   c. 更新订单状态 → PAID
   d. 调用 handlePaymentSuccess 执行履约
```

**主动查询 — `queryPaymentResultService`**：

客户端轮询场景，调用 `adapter.queryOrder` 查询支付状态，如果已支付则触发与回调相同的事务处理流程。

## 3. 支付适配器

### 适配器接口（base.ts）

```typescript
interface IPaymentAdapter {
    getChannel(): PaymentChannel
    getSupportedMethods(): PaymentMethod[]
    createPayment(params): Promise<PaymentResult>
    verifyCallback(data): Promise<CallbackVerifyResult>
    queryOrder(params): Promise<QueryOrderResult>
    closeOrder(params): Promise<CloseOrderResult>
}
```

### 适配器工厂（factory.ts）

`getPaymentAdapter(channel)` — 按渠道获取适配器实例，**使用 Map 缓存**。

配置来源：`useRuntimeConfig().wechatPay`（mchId / apiV3Key / serialNo / privateKey）。

### 微信支付适配器（wechat-pay.ts）

实现微信支付 V3 API，支持四种支付方式：

| PaymentMethod | 对应 API | 说明 |
|---------------|---------|------|
| `MINI_PROGRAM` | JSAPI | 小程序/公众号支付，需要 openid |
| `SCAN_CODE` | Native | 扫码支付，返回 codeUrl |
| `WAP` | H5 | 手机浏览器支付，返回 h5Url |
| `APP` | APP | APP 支付 |

**安全机制**：
- 请求签名：SHA256WithRSA，使用商户私钥
- 回调验签：SHA256WithRSA，使用微信平台证书公钥
- 回调数据解密：AES-256-GCM，使用 APIv3 密钥
- 商品描述截断：限制 127 字节（微信限制）

**微信支付配置来源**（`useRuntimeConfig().wechatPay`）：

| 配置项 | 说明 |
|--------|------|
| `public.wechatAppId` | 微信应用 AppID |
| `wechatPay.mchId` | 商户号 |
| `wechatPay.apiV3Key` | API v3 密钥 |
| `wechatPay.serialNo` | 商户证书序列号 |
| `wechatPay.privateKey` | 商户私钥（PEM 格式） |
| `wechatPay.platformCert` | 微信支付平台证书（PEM 格式） |

## 4. 支付成功处理器

### 处理器模式

```typescript
interface IPaymentSuccessHandler {
    name: string
    canHandle(order: OrderWithProduct): boolean
    handle(order: OrderWithProduct, tx: unknown): Promise<void>
}
```

处理器列表按优先级排序（`handlers/index.ts`），`handlePaymentSuccess` 找到第一个 `canHandle` 返回 true 的处理器执行。

### 处理器注册顺序

1. **upgradeHandler**（最高优先级）：`product.type === MEMBERSHIP && orderType === UPGRADE`
2. **membershipHandler**：`product.type === MEMBERSHIP && orderType !== UPGRADE`
3. **pointsHandler**：`product.type === POINTS`

### membershipHandler（会员新购）

```
1. 验证商品关联了会员级别（product.levelId）
2. 调用 createMembershipService 创建会员记录
3. 如果商品有赠送积分（product.giftPoint）：
   调用 createPointRecordService 创建积分记录
   积分生效/过期时间跟随会员日期
```

### pointsHandler（积分购买）

```
1. 验证商品设置了积分数量（product.pointAmount）
2. 计算总积分：pointAmount × duration
3. 调用 createPointRecordService 创建积分记录
```

### upgradeHandler（会员升级）

```
1. 验证商品关联了会员级别
2. 从订单备注（remark）中解析 membershipId（JSON 格式）
3. 调用 executeMembershipUpgradeService 执行升级逻辑
```

## 支付单状态流转

```
PENDING（待支付） → SUCCESS（支付成功）
PENDING → FAILED（创建支付失败）
PENDING → EXPIRED（超时未支付）
```

**支付单号格式**：`PAY` + 14 位时间戳 + 6 位随机数（如 `PAY20260411153022123456`）
**订单号格式**：`LSD` + 14 位时间戳 + 6 位随机数（如 `LSD20260411153022789012`）

## 定时任务

| 任务 | 方法 | 说明 |
|------|------|------|
| 过期订单处理 | `handleExpiredOrdersService` | 查找 `expiredAt < now` 且 `status=PENDING` 的订单，批量更新为 `CANCELLED` |
| 过期支付单处理 | `handleExpiredPaymentTransactionsService` | 查找 `expiredAt < now` 且 `status=PENDING` 的支付单，批量更新为 `EXPIRED` |

## 注意事项

1. **金额单位**：数据库存元（Decimal），微信 API 使用分，需要 `Math.round(amount * 100)` 转换
2. **Decimal 精度**：使用 `decimalToNumberUtils` 转换 Prisma Decimal
3. **幂等处理**：回调和主动查询都有事务内二次状态检查，防止并发重复处理
4. **订单号传递**：微信支付使用 `orderNo`（LSD 开头）作为 `out_trade_no`，方便排查
5. **限购统计**：只统计 `orderType=purchase` 的已支付订单，升级订单不计入

## 相关文档

- [tech-docs/backend/membership.md](./membership.md) — 会员创建和升级逻辑
- [tech-docs/backend/point.md](./point.md) — 积分记录创建
