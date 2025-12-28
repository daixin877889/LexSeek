# 实现计划：测试重构

## 概述

将现有的模拟测试重构为真正的集成测试，使用真实数据库操作和网络请求。

## 任务

- [x] 1. 创建测试辅助模块
  - [x] 1.1 创建测试数据库辅助模块 (test-db-helper.ts)
    - 实现 createTestUser 函数
    - 实现 createTestMembershipLevel 函数
    - 实现 createTestUserMembership 函数
    - 实现 createTestPointRecord 函数
    - 实现 createTestRedemptionCode 函数
    - 实现 createTestCampaign 函数
    - 实现 cleanupTestData 函数
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 1.2 创建测试数据生成器模块 (test-generators.ts)
    - 保留并优化 fast-check 生成器
    - 添加会员升级相关的数据生成器
    - 添加兑换码类型相关的数据生成器
    - _Requirements: 8.1_

- [x] 2. 重构会员级别测试
  - [x] 2.1 重写 membership-level.test.ts
    - 使用真实的 createMembershipLevelDao 函数
    - 使用真实的 findMembershipLevelByIdDao 函数
    - 使用真实的 updateMembershipLevelDao 函数
    - 使用真实的 deleteMembershipLevelDao 函数
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 编写属性测试 - CRUD 往返一致性
    - **Property 1: CRUD 往返一致性**
    - **Validates: Requirements 1.1, 1.2**

- [x] 3. 重构用户会员测试
  - [x] 3.1 重写 user-membership.test.ts
    - 使用真实的 createUserMembershipDao 函数
    - 使用真实的 findCurrentUserMembershipDao 函数
    - 使用真实的 findUserMembershipHistoryDao 函数
    - 使用真实的 invalidateUserMembershipDao 函数
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 编写属性测试 - 查询筛选正确性
    - **Property 2: 查询筛选正确性**
    - **Validates: Requirements 2.2**

  - [x] 3.3 编写属性测试 - 会员状态一致性
    - **Property 13: 会员状态一致性**
    - **Validates: Requirements 2.2, 2.4**

- [x] 4. 重构会员升级测试 (membership-upgrade.test.ts)
  - [x] 4.0 在 test-db-helper.ts 中添加 createTestOrder 辅助函数
    - 创建测试订单的辅助函数
    - 添加 orderIds 到 TestIds 接口
    - 在 cleanupTestData 中添加订单清理逻辑
    - _Requirements: 6.1, 6.2_

  - [x] 4.1 修复模拟实现 - 订单创建
    - ❌ 错误: `await prisma.orders.create(...)` 直接创建订单
    - ✅ 修复: 使用 `createTestOrder` 辅助函数
    - 涉及行号: 约 340, 400, 460 行
    - _Requirements: 2.1_

  - [x] 4.2 修复模拟实现 - 会员状态更新
    - ❌ 错误: `await prisma.userMemberships.update({ data: { status: INACTIVE } })`
    - ✅ 修复: 使用 `invalidateUserMembershipDao` 函数
    - 涉及行号: 约 890, 1150, 1200 行
    - _Requirements: 2.2_

  - [x] 4.3 修复模拟实现 - 积分转移
    - ❌ 错误: `await prisma.pointRecords.updateMany({ data: { userMembershipId } })`
    - ✅ 修复: 使用 `transferPointRecordsDao` 函数
    - 涉及行号: 约 900, 960 行
    - _Requirements: 3.1, 3.2_

  - [x] 4.4 修复模拟实现 - 积分聚合查询
    - ❌ 错误: `await prisma.pointRecords.aggregate({ _sum: { remaining } })`
    - ✅ 修复: 使用 `sumUserValidPointsDao` 函数
    - 涉及行号: 约 950, 980 行
    - _Requirements: 3.2_

  - [x] 4.5 修复模拟实现 - 会员查询
    - ❌ 错误: `await prisma.userMemberships.findFirst/findMany(...)`
    - ✅ 修复: 使用 `findCurrentUserMembershipDao` 或 `findAllActiveUserMembershipsDao`
    - 涉及行号: 约 1050, 1100, 1200 行
    - _Requirements: 2.2_

  - [x] 4.6 添加 executeMembershipUpgradeService 完整流程测试
    - 测试完整的升级流程（调用实际的 Service 函数）
    - 验证原会员失效、新会员创建、积分转移、积分补偿
    - **Property 7: 会员升级有效期计算正确性**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 4.7 编写属性测试 - 会员升级积分转移正确性
    - 使用 `transferPointRecordsDao` 验证积分转移
    - **Property 8: 会员升级积分转移正确性**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 4.8 编写属性测试 - 会员升级价格计算正确性
    - 使用 `calculateUpgradePrice` 函数验证
    - **Property 9: 会员升级价格计算正确性**
    - **Validates: Requirements 2.1**

  - [x] 4.9 编写属性测试 - 会员升级级别验证
    - 使用 `calculateUpgradePriceService` 验证级别限制
    - **Property 10: 会员升级级别验证**
    - **Validates: Requirements 2.1**

  - [x] 4.10 编写属性测试 - 会员升级记录完整性
    - 使用 `findMembershipUpgradeRecordByIdDao` 验证记录
    - **Property 16: 会员升级记录完整性**
    - **Validates: Requirements 2.1**

- [x] 5. 重构积分系统测试
  - [x] 5.1 重写 point-system.test.ts
    - 使用真实的 createPointRecordDao 函数
    - 使用真实的 findValidPointRecordsByUserIdDao 函数
    - 使用真实的 updatePointRecordDao 函数
    - 使用真实的 sumUserValidPointsDao 函数
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 5.2 编写属性测试 - 积分消费计算正确性
    - **Property 3: 积分消费计算正确性**
    - **Validates: Requirements 3.2**

  - [x] 5.3 编写属性测试 - 积分查询排序正确性
    - **Property 4: 积分查询排序正确性**
    - **Validates: Requirements 3.4**

- [x] 6. 重构兑换码测试
  - [x] 6.1 重写 redemption.test.ts
    - 使用真实的 createRedemptionCodeDao 函数
    - 使用真实的 findRedemptionCodeByCodeDao 函数
    - 使用真实的 updateRedemptionCodeStatusDao 函数
    - 使用真实的 validateRedemptionCodeService 函数
    - 使用真实的 redeemCodeService 函数
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 编写属性测试 - 兑换码状态变更正确性
    - **Property 5: 兑换码状态变更正确性**
    - **Validates: Requirements 4.2**

  - [x] 6.3 编写属性测试 - 兑换码类型处理 (仅会员)
    - **Property 5.1: 兑换码类型处理正确性 - 仅会员**
    - **Validates: Requirements 4.2**

  - [x] 6.4 编写属性测试 - 兑换码类型处理 (仅积分)
    - **Property 5.2: 兑换码类型处理正确性 - 仅积分**
    - **Validates: Requirements 4.2**

  - [x] 6.5 编写属性测试 - 兑换码类型处理 (会员和积分)
    - **Property 5.3: 兑换码类型处理正确性 - 会员和积分**
    - **Validates: Requirements 4.2**

  - [x] 6.6 编写属性测试 - 兑换码验证场景
    - **Property 5.4-5.7: 兑换码验证场景**
    - **Validates: Requirements 4.2, 4.3**

  - [x] 6.7 编写属性测试 - 兑换记录创建正确性
    - **Property 5.8: 兑换记录创建正确性**
    - **Validates: Requirements 4.2**

- [x] 7. 重构营销活动测试 (campaign.test.ts)
  - [x] 7.1 修复模拟实现 - 活动查询
    - ❌ 错误: `await testPrisma.campaigns.findUnique(...)` 直接查询
    - ✅ 修复: 导入并使用 `findCampaignByIdDao` 函数
    - 涉及行号: 约 100 行
    - _Requirements: 5.1_

  - [x] 7.2 修复模拟实现 - 活动更新
    - ❌ 错误: `await testPrisma.campaigns.update(...)` 直接更新
    - ✅ 修复: 导入并使用 `updateCampaignDao` 函数
    - 涉及行号: 约 120, 140 行
    - _Requirements: 5.3_

  - [x] 7.3 修复模拟实现 - 有效活动查询
    - ❌ 错误: `await testPrisma.campaigns.findFirst(...)` 直接查询
    - ✅ 修复: 导入并使用 `findActiveCampaignByTypeDao` 函数
    - 涉及行号: 约 180, 220, 260, 300 行
    - _Requirements: 5.4_

  - [x] 7.4 修复模拟实现 - 活动分页查询
    - ❌ 错误: `await testPrisma.campaigns.findMany(...)` 直接分页查询
    - ✅ 修复: 导入并使用 `findAllCampaignsDao` 函数
    - 涉及行号: 约 400, 430, 460 行
    - _Requirements: 5.2_

  - [x] 7.5 编写属性测试 - 活动时间范围验证
    - 使用实际的 DAO 函数验证活动时间范围
    - **Property 6: 活动时间范围验证**
    - **Validates: Requirements 5.4**

- [x] 8. 清理模拟测试代码
  - [x] 8.1 删除 membership-test-fixtures.ts 中的 Mock 接口
    - 删除 MockMembershipLevel 等接口
    - 删除 createMembershipLevel 等工厂函数
    - 保留状态常量和 fast-check 生成器
    - _Requirements: 7.1, 7.4_

  - [x] 8.2 删除 membership-test-helpers.ts
    - 删除所有模拟业务逻辑函数
    - _Requirements: 7.2_

  - [x] 8.3 删除旧的集成测试文件
    - 删除 membership-level-integration.test.ts
    - 删除 user-membership-integration.test.ts
    - 删除 point-integration.test.ts
    - _Requirements: 7.3_

- [x] 9. 检查点 - 确保所有测试通过
  - ✅ 运行 `bun run test:membership` 验证所有测试通过（134 个测试）
  - ✅ 运行 `bun run test` 验证所有测试通过（950 个测试）
  - ✅ 修复了 `resetStore.test.ts` 中的 7 个失败测试（由于 Nuxt 自动导入限制，重构为测试核心逻辑）

- [x] 10. 更新测试文档
  - [x] 10.1 更新 tests/server/membership/README.md
    - 更新测试文件列表
    - 更新测试用例详情
    - 更新运行命令示例
    - _Requirements: 6.4, 6.5_

## 注意事项

- 所有任务都是必需的，确保测试覆盖率接近 100%
- 每个任务引用了具体的需求以便追溯
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界情况
- 所有测试必须使用真实数据库操作，禁止使用模拟

## 模拟实现修复原则

### ❌ 错误做法（模拟实现）

```typescript
// 测试文件中自己直接操作数据库
await prisma.userMemberships.update({
    where: { id: oldMembership.id },
    data: { status: MembershipStatus.INACTIVE },
})

// 测试文件中自己实现业务逻辑
const upgradePrice = (targetPrice - currentPrice) * remainingDays / 365
```

### ✅ 正确做法（调用实际业务函数）

```typescript
// 导入实际的业务函数
import { invalidateUserMembershipDao } from '../../../server/services/membership/userMembership.dao'
import { transferPointRecordsDao } from '../../../server/services/point/pointRecords.dao'
import { executeMembershipUpgradeService } from '../../../server/services/membership/membershipUpgrade.service'

// 调用实际的业务函数进行测试
await invalidateUserMembershipDao(oldMembership.id)
await transferPointRecordsDao(fromMembershipId, toMembershipId)
const result = await executeMembershipUpgradeService(userId, targetLevelId, orderId)
expect(result.success).toBe(true)
```

## 可用的业务函数清单

### 会员升级相关
- `executeMembershipUpgradeService(userId, targetLevelId, orderId)` - 执行完整升级流程
- `calculateUpgradePrice(currentMembership, targetLevel, targetProduct, remainingDays)` - 计算升级价格
- `calculateUpgradePriceService(userId, targetLevelId)` - 计算指定升级的价格
- `getUpgradeOptionsService(userId)` - 获取可升级的目标级别列表
- `getUserUpgradeRecordsService(userId, options)` - 获取用户升级记录列表

### 会员升级记录 DAO
- `createMembershipUpgradeRecordDao(data)` - 创建升级记录
- `findMembershipUpgradeRecordByIdDao(id)` - 通过 ID 查询升级记录
- `findUserUpgradeRecordsDao(userId, options)` - 查询用户升级记录列表

### 用户会员 DAO
- `invalidateUserMembershipDao(id)` - 使会员记录失效
- `findCurrentUserMembershipDao(userId)` - 查询当前有效会员
- `findAllActiveUserMembershipsDao(userId)` - 查询所有有效会员
- `findUserMembershipHistoryDao(userId, options)` - 查询会员历史记录

### 积分 DAO
- `transferPointRecordsDao(fromMembershipId, toMembershipId)` - 转移积分记录
- `sumUserValidPointsDao(userId)` - 统计用户有效积分
- `findPointRecordsByMembershipIdDao(membershipId)` - 查询会员关联的积分记录

### 营销活动 DAO
- `findCampaignByIdDao(id)` - 通过 ID 查询活动
- `updateCampaignDao(id, data)` - 更新活动
- `findActiveCampaignByTypeDao(type)` - 查询有效活动
- `findAllCampaignsDao(options)` - 分页查询活动列表
