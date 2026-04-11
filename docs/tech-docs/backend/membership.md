# 会员体系模块

会员体系模块提供会员级别管理、用户会员记录、权益定义与分配、会员升级逻辑，以及与支付和积分模块的协作。

## 模块架构

```
server/services/membership/
├── membershipLevel.dao.ts          # 会员级别 DAO
├── benefit.dao.ts                  # 权益定义 DAO
├── benefit.service.ts              # 权益查询 Service
├── membershipBenefit.dao.ts        # 会员级别-权益关联 DAO
├── userMembership.dao.ts           # 用户会员记录 DAO
├── userMembership.service.ts       # 用户会员 Service
├── userBenefit.dao.ts              # 用户权益记录 DAO
├── userBenefit.service.ts          # 用户权益 Service
├── membershipUpgrade.dao.ts        # 升级记录 DAO
└── membershipUpgrade.service.ts    # 升级逻辑 Service
```

## 数据模型关系

```
membershipLevels (1) ──→ (N) membershipBenefits ←── (1) benefits
membershipLevels (1) ──→ (N) userMemberships
userMemberships (1)  ──→ (N) userBenefits
membershipUpgradeRecords: fromMembership → toMembership + order
```

## 1. 等级管理

### membershipLevel.dao.ts

| 方法 | 说明 |
|------|------|
| `createMembershipLevelDao` | 创建会员级别 |
| `findMembershipLevelByIdDao` | 按 ID 查询 |
| `findAllActiveMembershipLevelsDao` | 查询所有启用的级别（按 sortOrder 升序） |
| `findManyMembershipLevelsDao` | 分页列表 |
| `updateMembershipLevelDao` | 更新 |
| `softDeleteMembershipLevelDao` | 软删除 |

**关键字段**：
- `name` — 级别名称（如"基础版"、"专业版"）
- `sortOrder` — 排序权重，**数值越大级别越高**，用于升级比较
- `status` — 状态：1 启用 / 0 停用

## 2. 权益定义

### benefit.dao.ts

| 方法 | 说明 |
|------|------|
| `createBenefitDao` | 创建权益 |
| `findBenefitByIdDao` | 按 ID 查询 |
| `findAllActiveBenefitsDao` | 查询所有启用的权益 |

**权益字段**：
- `name` — 权益名称
- `code` — 权益标识码（如 `STORAGE_SPACE`、`AI_ANALYSIS`）
- `unitType` — 单位类型（次数/容量/天数等）
- `consumptionMode` — 消耗模式（叠加/覆盖）
- `defaultValue` — 默认值（未开通会员时的权益值）

### membershipBenefit.dao.ts

会员级别与权益的多对多关联：

| 方法 | 说明 |
|------|------|
| `createMembershipBenefitDao` | 创建关联（指定 benefitValue） |
| `findBenefitsByLevelIdDao` | 查询级别的所有权益（include benefit，只返回 status=1 的） |
| `updateMembershipBenefitDao` | 更新权益值 |
| `deleteMembershipBenefitDao` | 软删除 |

**benefitValue**：使用 `BigInt` 存储，表示该级别下该权益的具体数值。

### benefit.service.ts

| 方法 | 说明 |
|------|------|
| `getUserBenefitsService` | 获取用户当前会员的权益列表（用户 → 当前会员 → 级别 → 权益） |
| `getBenefitsByLevelIdService` | 获取指定级别的权益列表 |

## 3. 用户会员

### userMembership.dao.ts

| 方法 | 说明 |
|------|------|
| `createUserMembershipDao` | 创建会员记录 |
| `findUserMembershipByIdDao` | 按 ID 查询（include level） |
| `findCurrentUserMembershipDao` | 查询当前有效会员（startDate <= now AND endDate > now AND status=ACTIVE） |
| `findUserMembershipHistoryDao` | 会员记录历史列表 |
| `findAllActiveUserMembershipsDao` | 查询所有用户的活跃会员（定时任务用） |
| `updateUserMembershipDao` | 更新状态/日期 |

### userMembership.service.ts

| 方法 | 说明 |
|------|------|
| `getCurrentMembershipService` | 获取当前有效会员信息（格式化输出） |
| `createMembershipService` | 创建会员记录 + **自动授予权益** |
| `getMembershipHistoryService` | 会员历史记录 |

**创建会员流程**（`createMembershipService`）：

```
1. 验证级别存在
2. 计算开始日期和结束日期（根据 duration + durationUnit）
3. 创建 userMemberships 记录（状态 ACTIVE）
4. 调用 grantMembershipBenefitsService 授予该级别的所有权益
5. 返回创建的会员记录
```

**来源类型**（`UserMembershipSourceType`）：
- 兑换码兑换 / 直接购买 / 管理员赠送 / 活动奖励 / 试用 / 注册赠送 / 邀请注册 / 会员升级

## 4. 用户权益

### userBenefit.dao.ts

| 方法 | 说明 |
|------|------|
| `findUserActiveBenefitsDao` | 查询用户生效中的权益记录 |
| `createUserBenefitsDao` | 批量创建用户权益记录 |
| `expireUserBenefitsBySourceDao` | 按来源过期用户权益 |
| `sumUserBenefitValueDao` | 汇总用户某权益的总值 |

### userBenefit.service.ts

| 方法 | 说明 |
|------|------|
| `getUserBenefitSummaryService` | 用户权益汇总（总值 / 已用 / 剩余） |
| `grantMembershipBenefitsService` | 授予会员级别的所有权益 |
| `expireMembershipBenefitsService` | 过期会员的所有权益 |
| `checkStorageQuotaService` | 检查存储空间配额 |

**权益消耗模式**：
- **叠加模式**：多次获取的权益值累加（如存储空间）
- **覆盖模式**：以最新值为准

**权益汇总计算**（`getUserBenefitSummaryService`）：

```
1. 查询所有启用的权益类型定义
2. 对每个权益：
   a. 汇总用户该权益的总值（按消耗模式处理）
   b. 如果用户无记录，使用默认值
   c. 计算已使用量（目前仅存储空间通过 ossUsageDao 统计）
   d. 计算剩余量 = 总值 - 已使用量
3. 返回所有权益的汇总列表
```

**存储配额检查**（`checkStorageQuotaService`）：
- 查询用户 `STORAGE_SPACE` 权益的总额
- 通过 OSS 使用量统计已用空间
- 返回是否超额 + 详细信息

## 5. 升级逻辑

### membershipUpgrade.dao.ts

| 方法 | 说明 |
|------|------|
| `createMembershipUpgradeRecordDao` | 创建升级记录 |
| `findUserUpgradeRecordsDao` | 查询用户升级历史 |

### membershipUpgrade.service.ts

**获取可升级选项 — `getUpgradeOptionsService`**：

```
1. 获取用户当前有效会员
2. 查询所有比当前 sortOrder 更高的级别
3. 对每个目标级别：
   - 查找关联的商品（product.type=MEMBERSHIP, product.levelId）
   - 计算升级价格：targetRemainingValue - originalRemainingValue
   - 计算积分补偿
4. 返回升级选项列表
```

**执行升级 — `executeMembershipUpgradeService`**：

```
1. 获取当前会员记录
2. 验证目标级别比当前级别更高（比较 sortOrder）
3. 事务处理：
   a. 将当前会员标记为 UPGRADED
   b. 过期当前会员的权益
   c. 创建新会员记录（继承剩余天数）
   d. 授予新级别权益
   e. 处理积分迁移（旧积分记录关联到新会员）
   f. 创建升级记录
```

**升级价格计算**：

```
当前级别剩余价值 = 日均价值 × 剩余天数
目标级别剩余价值 = 目标日均价值 × 剩余天数
升级价格 = 目标级别剩余价值 - 当前级别剩余价值
```

其中日均价值 = 已支付金额 / 总天数

**升级记录**（`membershipUpgradeRecords`）存储：
- `fromMembershipId` / `toMembershipId` — 旧/新会员记录 ID
- `orderId` — 关联的升级订单
- `upgradePrice` — 升级差价
- `pointCompensation` — 积分补偿数量
- `transferPoints` — 迁移的积分数量
- `details` — 计算详情（JSON 格式）

**会员状态**（`MembershipStatus`）：
- `ACTIVE` — 活跃
- `EXPIRED` — 已过期
- `UPGRADED` — 已升级（被新会员记录替代）
- `CANCELLED` — 已取消

## 与 payment/point 的协作

- **payment → membership**：`membershipHandler` 在支付成功后调用 `createMembershipService` 创建会员
- **payment → membership**：`upgradeHandler` 在支付成功后调用 `executeMembershipUpgradeService` 执行升级
- **membership → point**：`membershipHandler` 在创建会员后调用 `createPointRecordService` 发放赠送积分
- **membership → point**：升级时迁移旧会员的剩余积分到新会员

## 注意事项

1. **Decimal 精度**：商品价格使用 Prisma Decimal，计算时必须通过 `decimalToNumberUtils` 转换为 number
2. **sortOrder 语义**：数值越大级别越高，升级是从低 sortOrder 到高 sortOrder
3. **benefitValue 类型**：使用 BigInt 存储，创建时 `BigInt(value)`
4. **时区处理**：日期计算使用 dayjs，确保 Asia/Shanghai 时区一致性
5. **权益授予时机**：创建会员记录后立即调用 `grantMembershipBenefitsService`，确保权益与会员同步生效
6. **升级幂等**：通过检查当前会员状态（非 ACTIVE 则跳过）保证幂等性

## 相关文档

- [tech-docs/backend/payment.md](./payment.md) — 支付成功后的会员/积分处理器
- [tech-docs/backend/point.md](./point.md) — 积分系统
- [tech-docs/backend/node.md](./node.md) — 会员级别与节点访问控制
