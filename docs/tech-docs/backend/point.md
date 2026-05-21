# 积分系统模块

积分系统模块提供积分记录管理、消耗项目定义、积分消耗记录，以及预扣→确认→回滚的三阶段消耗机制，支持与 workflow 中间件协作。

## 模块架构

```
server/services/point/
├── pointRecords.dao.ts                 # 积分变动记录 DAO
├── pointRecords.service.ts             # 积分变动记录 Service
├── pointConsumptionItems.dao.ts        # 消耗项目 DAO
├── pointConsumptionItems.service.ts    # 消耗项目 Service（CRUD）
├── pointConsumption.dao.ts             # 消耗核心 DAO（预扣/结算/回滚）
├── pointConsumption.service.ts         # 消耗核心 Service
├── pointConsumptionRecords.dao.ts      # 消耗记录 DAO
└── pointConsumptionRecords.service.ts  # 消耗记录 Service（查询）
```

## 数据模型关系

```
pointRecords（积分变动记录）
    ├── 来源：购买/赠送/注册/邀请等
    ├── 字段：pointAmount / usedAmount / status / effectiveAt / expiredAt
    └── 与 userMemberships 可选关联

pointConsumptionItems（消耗项目定义）
    ├── key：唯一标识符（如 ai_analysis、document_recognition）
    ├── pointAmount：每次消耗积分数
    └── discount：折扣系数

pointConsumptionRecords（消耗记录）
    ├── 关联 pointConsumptionItems
    ├── 关联 pointRecords（从哪条积分记录扣减）
    └── status：PRE_DEDUCTED / CONSUMED / ROLLED_BACK
```

## 1. 积分变动记录

### pointRecords.dao.ts

| 方法 | 说明 |
|------|------|
| `createPointRecordDao` | 创建积分记录 |
| `findPointRecordByIdDao` | 按 ID 查询 |
| `findPointRecordsByUserIdDao` | 用户积分记录列表（分页） |
| `sumUserValidPointsDao` | 汇总用户有效积分（已生效 + 未过期 + 状态正常） |
| `findValidPointRecordsByUserIdDao` | 查询可消耗的积分记录（按过期时间升序，优先消耗即将过期的） |
| `updatePointRecordDao` | 更新记录（usedAmount / status） |

### pointRecords.service.ts

| 方法 | 说明 |
|------|------|
| `getUserPointSummary` | 积分汇总：总量 / 已用 / 剩余 / 购买来源 / 其他来源 |
| `createPointRecordService` | **统一的积分创建入口** |
| `getUserPointRecords` | 用户积分记录列表 |

**createPointRecordService 参数**：

| 字段 | 说明 |
|------|------|
| `userId` | 用户 ID |
| `pointAmount` | 积分数量 |
| `sourceType` | 来源类型枚举 |
| `sourceId` | 来源 ID（订单 ID、会员 ID 等） |
| `userMembershipId` | 关联的会员记录 ID（会员赠送积分时使用） |
| `effectiveAt` | 生效时间（默认当天） |
| `expiredAt` | 过期时间（默认 1 年后，可通过 duration+durationUnit 计算） |

**来源类型**（`PointRecordSourceType`）：
- `DIRECT_PURCHASE` — 直接购买
- `MEMBERSHIP_GIFT` — 会员赠送
- `REGISTRATION_AWARD` — 注册奖励
- `INVITATION_AWARD` — 邀请奖励
- `ADMIN_GIFT` — 管理员赠送
- `ACTIVITY_AWARD` — 活动奖励
- `REDEMPTION_CODE` — 兑换码
- `MEMBERSHIP_UPGRADE_TRANSFER` — 会员升级迁移

## 2. 消耗项目

### pointConsumptionItems.dao.ts / pointConsumptionItems.service.ts

| 方法 | 说明 |
|------|------|
| `findPointConsumptionItemByIdDao` | 按 ID 查询 |
| `findEnabledPointConsumptionItemsDao` | 查询所有启用的消耗项目 |
| `createPointConsumptionItemService` | 创建（key 唯一性检查） |
| `updatePointConsumptionItemService` | 更新 |
| `deletePointConsumptionItemService` | 软删除 |
| `getPointConsumptionItemsService` | 分页列表 |

**消耗项目关键字段**：
- `key`：语义化标识符（如 `ai_analysis`），代码中通过 key 引用
- `group`：分组（如 `ai`、`document`）
- `pointAmount`：每次消耗积分数
- `discount`：折扣系数（默认 1.0）
- `unit`：计量单位（如"次"、"页"）

## 3. 积分消耗核心

### pointConsumption.dao.ts

| 方法 | 说明 |
|------|------|
| `findConsumptionItemByKeyDao` | 按 key 查询消耗项目 |
| `findAvailableConsumptionItemsDao` | 查询所有可用消耗项目 |
| `findValidPointRecordsForConsumeDao` | 查询可消耗积分（按过期时间升序） |
| `createConsumptionRecordDao` | 创建消耗记录 |
| `updatePointRecordUsageDao` | 更新积分记录的已用量 |
| `findPreDeductRecordsByBatchIdDao` | 按 batchId 查询预扣记录 |
| `updateConsumptionRecordStatusByBatchIdDao` | 按 batchId 批量更新消耗记录状态 |

### pointConsumption.service.ts

**核心接口类型**：

```typescript
interface PointCheckResult {
    sufficient: boolean    // 积分是否充足
    required: number       // 需要的积分数量
    available: number      // 用户可用积分
    itemId: number
    itemName: string
    itemUnit: string
}

interface PreDeductResult {
    batchId: string        // 预扣批次 ID
    preDeductAmount: number
}

interface SettleResult {
    consumedAmount: number
    consumptionRecords: pointConsumptionRecords[]
}
```

**三阶段消耗流程**：

### 阶段一：检查积分（checkPoints）

```
1. 通过 key 查询消耗项目
2. 计算需要的积分：pointAmount × quantity × discount
3. 查询用户可用积分总额
4. 返回 PointCheckResult
```

### 阶段二：预扣积分（preDeduct）

```
1. 生成 batchId（UUID）
2. 查询可消耗的积分记录（按过期时间升序 — 先到期先消耗）
3. 逐条扣减直到满足所需积分：
   a. 计算该记录可扣减量 = pointAmount - usedAmount
   b. 创建 PRE_DEDUCTED 状态的消耗记录
   c. 更新积分记录的 usedAmount（+= 实际扣减量）
4. 返回 PreDeductResult { batchId, preDeductAmount }
```

### 阶段三A：确认结算（settle）

```
1. 按 batchId 查询所有预扣记录
2. 批量更新状态为 CONSUMED
3. 返回 SettleResult
```

### 阶段三B：回滚（rollback）

```
1. 按 batchId 查询所有预扣记录
2. 逐条恢复积分记录的 usedAmount（-= 扣减量）
3. 批量更新消耗记录状态为 ROLLED_BACK
```

## 4. 消耗记录查询

### pointConsumptionRecords.dao.ts / pointConsumptionRecords.service.ts

| 方法 | 说明 |
|------|------|
| `findPointConsumptionRecordsByUserIdDao` | 用户消耗记录列表（分页，include 消耗项目） |
| `getUserConsumptionRecords` | 服务层封装 |

## 与 workflow 中间件的协作

workflow 执行过程中的积分消耗流程：

```
workflow 开始
    ↓
中间件：checkPoints(userId, itemKey, quantity)
    ↓ sufficient=true
中间件：preDeduct(userId, itemKey, quantity)
    ↓ 获得 batchId
workflow 执行（可能成功或失败）
    ↓
成功 → settle(batchId)     // 确认消耗
失败 → rollback(batchId)   // 回滚积分
```

**设计要点**：
- 预扣在 workflow 开始前执行，防止积分不足时浪费计算资源
- batchId 关联一次完整的预扣操作，方便批量结算或回滚
- 先到期先消耗策略，最大化积分利用率

## 注意事项

1. **先到期先消耗**：`findValidPointRecordsForConsumeDao` 按 `expiredAt` 升序排序
2. **Decimal 精度**：积分相关字段可能使用 Prisma Decimal，需要 `decimalToNumberUtils` 转换
3. **消耗记录状态**：PRE_DEDUCTED（预扣）→ CONSUMED（已消耗）或 ROLLED_BACK（已回滚）
4. **积分有效性**：effectiveAt <= now AND expiredAt > now AND status 正常
5. **事务支持**：所有 DAO 方法支持可选的 `tx` 参数，与上层事务集成

## 相关文档

- [tech-docs/backend/payment.md](./payment.md) — 支付成功后创建积分记录
- [tech-docs/backend/membership.md](./membership.md) — 会员赠送积分、升级积分迁移
