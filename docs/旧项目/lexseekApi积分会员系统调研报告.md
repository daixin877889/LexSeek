# lexseekApi 积分与会员系统调研报告

## 一、概述

lexseekApi 项目实现了一套完整的会员和积分管理系统，支持多种会员获取方式、积分获取与消耗机制，以及会员升级功能。

---

## 二、数据模型

### 2.1 核心数据表

| 表名 | 说明 |
|------|------|
| `users` | 用户表，包含邀请码、邀请人等字段 |
| `membership_levels` | 会员级别表 |
| `user_memberships` | 用户会员记录表 |
| `benefits` | 权益定义表 |
| `membership_benefits` | 会员级别权益关联表 |
| `user_benefits` | 用户权益表 |
| `point_records` | 积分记录表 |
| `point_consumption_items` | 积分消耗项目表 |
| `point_consumption_records` | 积分消耗记录表 |
| `redemption_codes` | 兑换码表 |
| `redemption_records` | 兑换记录表 |
| `products` | 商品表（会员商品、积分商品） |
| `payment_orders` | 支付订单表 |
| `payment_transactions` | 支付交易记录表 |
| `membership_upgrade_records` | 会员升级记录表 |

---

## 三、会员系统

### 3.1 会员级别 (membershipLevels)

会员级别定义了不同等级的会员，包含：
- 级别名称、描述
- 排序顺序（sortOrder，数字大）
- 状态（启用/禁用）

**注意**：价格字段（priceMonthly、priceYearly、giftPoint）已废弃，改用 `products` 表管理。

### 3.2 用户会员记录 (userMemberships)

记录用户的会员信息：

```typescript
interface UserMembership {
  userId: number;           // 用户ID
  levelId: number;          // 会员级别ID
  startDate: Date;          // 开始日期
  endDate: Date;            // 到期日期
  autoRenew: boolean;       // 是否自动续费
  status: 0 | 1;            // 状态：1-有效，0-无效
  sourceType: number;       // 来源类型
  sourceId?: number;        // 来源ID
}
```

### 3.3 会员来源类型 (UserMembershipSourceType)

```typescript
enum UserMembershipSourceType {
  REDEMPTION_CODE = 1,      // 兑换码兑换
  DIRECT_PURCHASE = 2,      // 直接购买
  ADMIN_GIFT = 3,           // 管理员赠送
  ACTIVITY_AWARD = 4,       // 活动奖励
  TRIAL = 5,                // 试用
  REGISTRATION_AWARD = 6,   // 注册赠送
  INVITATION_TO_REGISTER = 7, // 推荐新用户注册赠送
  MEMBERSHIP_UPGRADE = 8,   // 会员升级
  OTHER = 99,               // 其他
}
```

### 3.4 会员获取方式

#### 3.4.1 注册赠送
新用户注册时，系统根据 `systemConfigs` 表中的 `register.registerGift` 配置自动赠送会员：

```typescript
interface RegisterGiftConfig {
  enable: boolean;          // 是否启用
  membershipLevel: number;  // 赠送的会员级别ID
  duration: number;         // 赠送时长（天）
  giftPoint: number;        // 赠送积分
}
```

#### 3.4.2 邀请注册赠送
被邀请人注册成功后，邀请人获得会员和积分奖励：

```typescript
interface InvitationToRegisterConfig {
  enable: boolean;
  membershipLevel: number;
  duration: number;
  giftPoint: number;
}
```

#### 3.4.3 兑换码兑换
管理员生成兑换码，用户使用兑换码获取会员：

```typescript
interface RedemptionCode {
  code: string;             // 兑换码
  levelId: number;          // 会员级别ID
  duration: number;         // 有效期天数
  giftPoint: number;        // 赠送积分
  status: RedemptionCodeStatus; // 状态
}
```

兑换码状态：
- `ACTIVE = 1` - 有效
- `USED = 2` - 已使用
- `EXPIRED = 3` - 已过期
- `INVALID = 4` - 已作废

#### 3.4.4 直接购买
用户通过微信支付购买会员商品，支持：
- 按月付费
- 按年付费
- 购买时赠送积分

### 3.5 会员升级

支持用户从低级别会员升级到高级别会员：

**升级价格计算逻辑**：
```
升级价格 = 目标级别剩余价值 - 原级别剩余价值
积分补偿 = 升级价格 × 10
```

**升级流程**：
1. 计算升级价格
2. 创建支付订单
3. 用户支付
4. 支付成功后：
   - 创建新会员记录
   - 失效原会员记录
   - 转移原积分到新会员
   - 发放积分补偿

---

## 四、积分系统

### 4.1 积分记录 (pointRecords)

```typescript
interface PointRecord {
  userId: number;           // 用户ID
  pointAmount: number;      // 积分数量
  used: number;             // 已使用数量
  remaining: number;        // 剩余数量
  sourceType: PointRecordSourceType; // 来源类型
  sourceId?: number;        // 来源ID
  userMembershipId?: number; // 关联的会员记录ID
  effectiveAt: Date;        // 生效时间
  expiredAt: Date;          // 过期时间
  status: PointRecordStatus; // 状态
}
```

### 4.2 积分来源类型 (PointRecordSourceType)

```typescript
enum PointRecordSourceType {
  MEMBERSHIP_GIFT = 1,      // 购买会员赠送
  DIRECT_PURCHASE = 2,      // 直接购买
  EXCHANGE_CODE_GIFT = 3,   // 兑换码赠送
  POINT_EXCHANGE = 4,       // 积分兑换
  ACTIVITY_REWARD = 5,      // 活动奖励
  REFERRAL_REGISTER = 6,    // 推荐注册
  REGISTER_GIFT = 7,        // 注册赠送
  INVITATION_TO_REGISTER = 8, // 邀请注册赠送
  MEMBERSHIP_UPGRADE_COMPENSATION = 9, // 会员升级补偿
  OTHER = 99,               // 其他
}
```

### 4.3 积分状态 (PointRecordStatus)

```typescript
enum PointRecordStatus {
  VALID = 1,                // 有效
  MEMBERSHIP_UPGRADE_SETTLEMENT = 2, // 会员升级结算
  CANCELLED = 3,            // 已作废
}
```

### 4.4 积分消耗项目 (pointConsumptionItems)

定义可消耗积分的项目：

```typescript
interface PointConsumptionItem {
  group: string;            // 分组
  name: string;             // 项目名称
  description?: string;     // 描述
  unit: string;             // 计量单位
  pointAmount: number;      // 消耗积分数量
  discount?: Decimal;       // 折扣
  status: PointConsumptionItemStatus; // 状态
}
```

### 4.5 积分消耗逻辑

积分消耗采用 **先到期先消耗** 策略：

```typescript
// 消耗流程
1. 检查用户积分是否足够
2. 检查消耗项目是否有效
3. 查询用户积分记录（按过期时间升序）
4. 依次从积分记录中扣除，直到完全抵扣
5. 更新积分记录的 used 和 remaining 字段
6. 创建积分消耗记录
```

### 4.6 积分查询

```typescript
// 获取用户可用积分
async function getMembershipAvailablePoint(userId: number) {
  return {
    pointAmount: number,    // 总积分
    used: number,           // 已使用
    remaining: number,      // 剩余
    purchasePoint: number,  // 购买获得的积分
    otherPoint: number,     // 其他来源积分
  }
}
```

---

## 五、商品系统

### 5.1 商品类型 (ProductType)

```typescript
enum ProductType {
  MEMBERSHIP = 1,           // 会员商品
  POINTS = 2,               // 积分商品
}
```

### 5.2 商品结构

```typescript
interface Product {
  name: string;             // 商品名称
  type: ProductType;        // 商品类型
  // 会员商品专用
  priceMonthly?: number;    // 月度价格
  priceYearly?: number;     // 年度价格
  levelId?: number;         // 关联会员级别ID
  giftPoint?: number;       // 赠送积分
  // 积分商品专用
  unitPrice?: number;       // 单价
  pointAmount?: number;     // 积分数量
  // 通用
  purchaseLimit?: number;   // 购买次数限制（0-不限制）
  status: ProductStatus;    // 状态
}
```

---

## 六、支付系统

### 6.1 支付订单 (paymentOrders)

```typescript
interface PaymentOrder {
  orderNo: string;          // 订单号
  userId: number;           // 用户ID
  productId?: number;       // 商品ID（新架构）
  levelId?: number;         // 会员级别ID（旧架构兼容）
  amount: number;           // 支付金额
  paymentType: PaymentType; // 支付类型
  paymentWay: PaymentWay;   // 支付方式
  status: PaymentStatus;    // 订单状态
  duration: number;         // 购买时长
  paymentUnit: PaymentUnit; // 时间单位
}
```

### 6.2 支付状态

```typescript
enum PaymentStatus {
  UNPAID = 0,               // 未支付
  PAID = 1,                 // 已支付
  CANCELED = 2,             // 已取消
}
```

### 6.3 支付成功处理

采用 **策略模式** 处理不同商品类型的支付成功逻辑：

```typescript
// 会员商品处理器
class MembershipPaymentHandler {
  async handle(order, tx) {
    // 1. 计算会员有效期
    // 2. 创建会员记录
    // 3. 发放赠送积分
  }
}

// 积分商品处理器
class PointsPaymentHandler {
  async handle(order, tx) {
    // 1. 计算积分数量
    // 2. 创建积分记录（1年有效期）
  }
}
```

---

## 七、API 接口

### 7.1 会员相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/memberships/levels` | GET | 获取所有会员级别 |
| `/api/v1/memberships/levels/:id` | GET | 获取会员级别详情 |
| `/api/v1/memberships/me` | GET | 获取当前用户会员信息 |
| `/api/v1/memberships/history-list` | GET | 获取会员历史记录 |
| `/api/v1/memberships/getbenefits` | GET | 获取用户权益信息 |
| `/api/v1/memberships/:membershipId/upgrade-options` | GET | 获取升级选项 |
| `/api/v1/memberships/calculate-upgrade-price` | POST | 计算升级价格 |
| `/api/v1/memberships/upgrade` | POST | 执行会员升级 |
| `/api/v1/memberships/upgrade-records` | GET | 获取升级记录 |

### 7.2 积分相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/points/info` | GET | 获取用户积分信息 |
| `/api/v1/points/records` | GET | 获取积分记录 |
| `/api/v1/points/usage` | GET | 获取积分使用记录 |

### 7.3 兑换码相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/redemption-codes/info` | GET | 获取兑换码信息 |
| `/api/v1/redemption-codes/redeem` | POST | 兑换码兑换 |
| `/api/v1/redemption-codes/me` | GET | 获取用户兑换记录 |
| `/api/v1/redemption-codes/me/active` | GET | 获取有效兑换记录 |

---

## 八、关键业务流程

### 8.1 用户注册流程

```
用户注册
    ↓
检查注册赠送配置
    ↓
[启用] → 创建会员记录 → 创建积分记录
    ↓
检查邀请人
    ↓
[有邀请人] → 检查邀请奖励配置 → 为邀请人创建会员和积分
```

### 8.2 会员购买流程

```
用户选择商品
    ↓
创建支付订单
    ↓
获取微信支付参数
    ↓
用户支付
    ↓
微信回调/主动查询
    ↓
支付成功处理
    ↓
[会员商品] → 创建会员记录 → 发放赠送积分
[积分商品] → 创建积分记录
```

### 8.3 会员升级流程

```
用户选择升级目标
    ↓
计算升级价格
    ↓
创建升级订单
    ↓
用户支付
    ↓
支付成功
    ↓
创建新会员记录
    ↓
失效原会员记录
    ↓
转移原积分到新会员
    ↓
发放积分补偿
```

### 8.4 积分消耗流程

```
用户使用功能
    ↓
检查积分是否足够
    ↓
查询积分记录（按过期时间排序）
    ↓
依次扣除积分
    ↓
更新积分记录
    ↓
创建消耗记录
```

---

## 九、技术特点

1. **事务处理**：关键业务操作使用 Prisma 事务确保数据一致性
2. **策略模式**：支付成功处理采用策略模式，便于扩展新商品类型
3. **软删除**：所有表都有 `deletedAt` 字段支持软删除
4. **时间处理**：统一使用 dayjs 处理日期时间
5. **日志记录**：完善的日志记录便于问题排查
6. **类型安全**：使用 TypeScript 枚举和接口确保类型安全

---

## 十、配置项

系统配置存储在 `systemConfigs` 表中：

| 配置组 | 配置键 | 说明 |
|--------|--------|------|
| register | registerGift | 注册赠送会员配置 |
| register | invitationToRegister | 邀请注册奖励配置 |

---

## 十一、文件结构

```
src/
├── api/user/
│   ├── membership.ts       # 会员路由
│   ├── point.ts            # 积分路由
│   ├── redemption.ts       # 兑换码路由
│   └── payment.ts          # 支付路由
├── services/
│   ├── user/
│   │   ├── membership/     # 会员服务
│   │   │   ├── membershipLevel.*      # 会员级别
│   │   │   ├── userMembership.*       # 用户会员
│   │   │   ├── membershipUpgrade.*    # 会员升级
│   │   │   ├── pointRecords.*         # 积分记录
│   │   │   ├── pointConsumptionRecords.* # 积分消耗
│   │   │   ├── benefits.*             # 权益
│   │   │   └── userBenefits.*         # 用户权益
│   │   └── redemption/     # 兑换码服务
│   │       ├── redemptionCode.*       # 兑换码
│   │       └── redemptionRecord.*     # 兑换记录
│   ├── payment/            # 支付服务
│   │   ├── payment.service.ts         # 支付服务
│   │   ├── paymentHandlers.ts         # 支付处理器
│   │   └── wechatPay.service.ts       # 微信支付
│   └── product/            # 商品服务
│       └── product.service.ts         # 商品服务
└── prisma/
    └── schema.prisma       # 数据库模型
```
