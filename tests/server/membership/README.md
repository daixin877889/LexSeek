# 会员系统测试模块

本模块包含会员系统相关的所有集成测试用例，涵盖会员级别管理、用户会员记录、积分系统、兑换码、营销活动、会员升级等功能。

**所有测试均使用真实数据库操作，确保测试结果的可靠性。**

## 测试文件列表

### 基础设施文件

| 文件 | 说明 |
|------|------|
| `test-db-helper.ts` | 测试数据库辅助模块，提供真实数据库操作的测试数据管理功能 |
| `test-generators.ts` | fast-check 数据生成器，用于属性测试的随机数据生成 |
| `test-setup.ts` | 测试环境设置，模拟 Nuxt 自动导入的全局变量 |

### 测试文件

| 文件 | 说明 | 测试数量 |
|------|------|----------|
| `membership-level.test.ts` | 会员级别管理测试 | 17 |
| `user-membership.test.ts` | 用户会员记录测试 | 11 |
| `membership-upgrade.test.ts` | 会员升级测试 | 44 |
| `membership-upgrade-settlement.test.ts` | 会员升级结算测试 | 10 |
| `point-system.test.ts` | 积分系统测试 | 12 |
| `redemption.test.ts` | 兑换码测试 | 31 |
| `campaign.test.ts` | 营销活动测试 | 19 |

**总计：144 个测试用例**

## 运行测试命令

```bash
# 运行所有会员模块测试
bun run test:membership

# 运行单个测试文件
npx vitest run tests/server/membership/membership-level.test.ts --reporter=verbose
npx vitest run tests/server/membership/user-membership.test.ts --reporter=verbose
npx vitest run tests/server/membership/membership-upgrade.test.ts --reporter=verbose
npx vitest run tests/server/membership/membership-upgrade-settlement.test.ts --reporter=verbose
npx vitest run tests/server/membership/point-system.test.ts --reporter=verbose
npx vitest run tests/server/membership/redemption.test.ts --reporter=verbose
npx vitest run tests/server/membership/campaign.test.ts --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/server/membership --coverage
```

## 测试用例详情

### membership-level.test.ts - 会员级别管理（17 个测试）

**createMembershipLevelDao 测试**
- 应成功创建会员级别
- Property: 创建后立即查询应返回等价数据

**findMembershipLevelByIdDao 测试**
- 应成功通过 ID 查询会员级别
- 查询不存在的 ID 应返回 null
- 查询已删除的记录应返回 null

**updateMembershipLevelDao 测试**
- 应成功更新会员级别
- 更新后查询应返回新数据

**deleteMembershipLevelDao 测试**
- 应成功软删除会员级别

**findAllActiveMembershipLevelsDao 测试**
- 应只返回启用状态的会员级别
- 结果应按 sortOrder 升序排列
- 不应返回已删除的会员级别

**findAllMembershipLevelsDao 测试**
- 应正确返回分页结果
- 应正确按状态筛选

**findHigherMembershipLevelsDao 测试**
- 应返回比指定级别更高的级别
- 最高级别应没有更高的级别

**Property: 级别比较传递性**
- 如果 A > B 且 B > C，则 A > C

**数据库连接检查**
- 检查数据库是否可用

---

### user-membership.test.ts - 用户会员记录（11 个测试）

**createUserMembershipDao 测试**
- 应成功创建用户会员记录

**findUserMembershipByIdDao 测试**
- 应成功通过 ID 查询用户会员记录

**findCurrentUserMembershipDao 测试**
- 应返回用户当前有效会员
- Property: 只返回 ACTIVE 状态且未过期的记录

**updateUserMembershipDao 测试**
- 应成功更新用户会员记录

**invalidateUserMembershipDao 测试**
- 应成功使用户会员记录失效

**findUserMembershipHistoryDao 测试**
- 应正确返回分页结果

**findAllActiveUserMembershipsDao 测试**
- 应返回用户所有有效的会员记录

**Property: startDate 应小于 endDate**
- 创建的会员记录时间范围正确

**软删除**
- 软删除后不应被查询到

**数据库连接检查**
- 检查数据库是否可用

---

### membership-upgrade.test.ts - 会员升级（44 个测试）

**会员级别 DAO 函数测试**
- findMembershipLevelByIdDao 应正确查询会员级别
- findAllActiveMembershipLevelsDao 应返回所有启用的会员级别
- findHigherMembershipLevelsDao 应返回比指定级别更高的级别

**用户会员 DAO 函数测试**
- findCurrentUserMembershipDao 应返回用户当前有效会员
- findCurrentUserMembershipDao 不应返回已过期的会员
- findUserMembershipByIdDao 应正确查询会员记录

**会员升级价格计算测试**
- calculateUpgradePrice 应正确计算升级价格
- calculateUpgradePriceService 应验证目标级别必须高于当前级别
- calculateUpgradePriceService 应验证用户必须有有效会员

**会员升级记录 DAO 函数测试**
- createMembershipUpgradeRecordDao 应正确创建升级记录
- findMembershipUpgradeRecordByIdDao 应正确查询升级记录
- findUserUpgradeRecordsDao 应正确分页查询用户升级记录

**Property: 会员升级级别验证**
- 只能升级到更高级别（sortOrder 更小）

**Property: 会员升级有效期计算正确性**
- 升级后会员有效期应继承原会员的结束时间

**Property: 会员升级积分补偿正确性**
- 积分补偿应等于升级价格乘以10

**升级价格计算**
- 升级价格应等于目标级别剩余价值减去原级别剩余价值
- 剩余天数为0时升级价格应为0

**会员升级状态转换**
- 升级后原会员状态应变为 INACTIVE
- 新会员应继承原会员的结束时间

**积分转移**
- 升级后积分记录应转移到新会员
- 转移后积分数量应保持不变

**升级资格验证**
- 没有有效会员时不能升级
- 会员已过期时不能升级
- 目标级别不高于当前级别时不能升级
- 满足所有条件时可以升级

**executeMembershipUpgradeService 完整流程测试**
- 完整升级流程应正确执行
- 升级后应创建升级记录
- 升级后积分应正确转移

**Property: 升级后用户应只有一个有效会员**
**Property: 升级记录应保持完整的历史**

---

### membership-upgrade-settlement.test.ts - 会员升级结算（10 个测试）

**Property 1: 会员记录结算正确性**
- 旧会员 endDate 应等于结算日期，status 应为 2（已结算）
- 新会员 startDate 应等于结算日期，endDate 应等于旧会员原 endDate

**Property 2: 积分记录结算正确性**
- 旧积分记录 status 应为 2，remaining 应为 0，transferOut 应等于结算前的 remaining

**Property 3: 转入积分记录正确性**
- 转入积分记录 pointAmount 应等于旧积分 remaining 之和

**Property 4: 补偿积分记录正确性**
- 补偿积分记录 remark 应包含订单号

**Property 5: 升级记录正确性**
- 升级记录应包含正确的 transferPoints 和 details JSON

**Property 6: 积分总量守恒**
- 旧积分记录的 transferOut 之和应等于转入积分记录的 pointAmount

**Property 7: 状态过滤正确性**
- 查询有效积分时应只返回 status = 1 的记录

**边界情况测试**
- 旧会员没有积分记录时应正常升级
- 积分 remaining 为 0 的记录不应被转移

---

### point-system.test.ts - 积分系统（12 个测试）

**createPointRecordDao 测试**
- 应成功创建积分记录
- Property: 新创建的积分记录 remaining 应等于 pointAmount

**findPointRecordByIdDao 测试**
- 应成功通过 ID 查询积分记录

**findPointRecordsByUserIdDao 测试**
- 应正确返回分页结果

**findValidPointRecordsByUserIdDao 测试**
- 应按 expiredAt 升序排列（FIFO 消耗）
- 不应返回已过期的积分记录

**updatePointRecordDao 测试**
- 应成功更新积分记录

**sumUserValidPointsDao 测试**
- 应正确统计用户有效积分汇总

**findPointRecordsByMembershipIdDao 测试**
- 应正确查询会员关联的积分记录

**transferPointRecordsDao 测试**
- 应正确转移积分记录到新会员

**积分数据一致性**
- Property: remaining 应始终等于 pointAmount - used

**数据库连接检查**
- 检查数据库是否可用

---

### redemption.test.ts - 兑换码（31 个测试）

**createRedemptionCodeDao 测试**
- 应成功创建兑换码

**findRedemptionCodeByCodeDao 测试**
- 应成功通过兑换码查询
- 查询不存在的兑换码应返回 null

**findRedemptionCodeByIdDao 测试**
- 应成功通过 ID 查询兑换码

**updateRedemptionCodeStatusDao 测试**
- 应成功更新兑换码状态

**findAllRedemptionCodesDao 测试**
- 应正确返回分页结果
- 应正确按状态筛选

**createRedemptionRecordDao 测试**
- 应成功创建兑换记录

**findRedemptionRecordsByUserIdDao 测试**
- 应正确返回用户兑换记录

**checkUserRedemptionRecordExistsDao 测试**
- 用户已使用过的兑换码应返回 true
- 用户未使用过的兑换码应返回 false

**validateRedemptionCodeService 测试**
- 有效兑换码应返回 valid: true
- 不存在的兑换码应返回错误
- 已使用的兑换码应返回错误
- 已过期的兑换码应返回错误
- 已作废的兑换码应返回错误

**redeemCodeService 测试**
- 仅会员类型兑换码应创建会员记录
- 仅积分类型兑换码应创建积分记录
- 会员和积分类型兑换码应同时创建会员和积分记录
- 无效兑换码应返回失败

**Property 5: 兑换码状态变更正确性**
- 有效兑换码使用后状态应变为 USED

**Property 5.1: 兑换码类型处理正确性 - 仅会员**
- 仅会员类型兑换码应只创建会员记录

**Property 5.2: 兑换码类型处理正确性 - 仅积分**
- 仅积分类型兑换码应只创建积分记录

**Property 5.3: 兑换码类型处理正确性 - 会员和积分**
- 会员和积分类型兑换码应同时创建会员和积分记录

**Property 5.4-5.7: 兑换码验证场景**
- 已使用的兑换码验证应失败
- 已过期的兑换码验证应失败
- 已作废的兑换码验证应失败
- 不存在的兑换码验证应失败

**Property 5.8: 兑换记录创建正确性**
- 成功兑换后应创建兑换记录

**数据库连接检查**
- 检查数据库是否可用

---

### campaign.test.ts - 营销活动（19 个测试）

**createCampaignDao 测试**
- 应成功创建营销活动

**findCampaignByIdDao 测试**
- 应成功通过 ID 查询营销活动
- 查询不存在的 ID 应返回 null

**findActiveCampaignByTypeDao 测试**
- 应返回指定类型的有效营销活动
- 活动未开始时不应返回
- 活动已结束时不应返回
- 活动禁用时不应返回

**updateCampaignDao 测试**
- 应成功更新营销活动

**deleteCampaignDao 测试**
- 应成功软删除营销活动

**findAllCampaignsDao 测试**
- 应正确返回分页结果
- 应正确按类型筛选
- 应正确按状态筛选

**getActiveCampaignService 测试**
- 应正确返回有效活动信息

**Property 6: 活动时间范围验证**
- Property 6.1: 活动在有效期内且启用时应返回有效
- Property 6.2: 活动未开始时不应被查询到
- Property 6.3: 活动已结束时不应被查询到
- Property 6.4: 活动禁用时不应被查询到
- Property 6.5: 有效活动的时间范围验证

**数据库连接检查**
- 检查数据库是否可用

---

## 测试辅助模块说明

### test-db-helper.ts

提供测试数据的创建和清理功能，直接操作真实数据库。

**主要功能：**
- `createTestUser()` - 创建测试用户
- `createTestMembershipLevel()` - 创建测试会员级别
- `createTestUserMembership()` - 创建测试用户会员记录
- `createTestPointRecord()` - 创建测试积分记录
- `createTestRedemptionCode()` - 创建测试兑换码
- `createTestCampaign()` - 创建测试营销活动
- `createTestProduct()` - 创建测试产品
- `createTestOrder()` - 创建测试订单
- `cleanupTestData()` - 清理测试数据（按外键顺序删除）
- `cleanupAllTestData()` - 清理所有测试数据（使用测试标记前缀）

**测试数据标记前缀：**
- 测试用户手机号前缀：`199`
- 测试会员级别名称前缀：`测试级别_`
- 测试兑换码前缀：`TEST_`
- 测试营销活动名称前缀：`测试活动_`

### test-generators.ts

使用 fast-check 生成随机测试数据，用于属性测试。

**主要生成器：**
- `membershipLevelDataArb` - 会员级别数据生成器
- `userMembershipDataArb` - 用户会员记录数据生成器
- `pointRecordDataArb` - 积分记录数据生成器
- `redemptionCodeDataArb` - 兑换码数据生成器
- `campaignDataArb` - 营销活动数据生成器
- `membershipUpgradeScenarioArb` - 会员升级场景生成器

**属性测试配置：**
- `PBT_CONFIG` - 默认配置（100 次迭代）
- `PBT_CONFIG_FAST` - 快速配置（5 次迭代，用于耗时较长的测试）

### test-setup.ts

模拟 Nuxt 自动导入的全局变量，使 DAO/Service 函数能在测试环境中运行。

**模拟的全局变量：**
- `logger` - 日志工具
- `prisma` - Prisma 客户端实例
- 各种状态常量（MembershipStatus、RedemptionCodeStatus 等）

---

## 注意事项

1. **数据库连接**：运行测试前请确保数据库已启动并配置正确的 `DATABASE_URL` 环境变量
2. **测试数据清理**：每个测试用例执行后会自动清理创建的测试数据
3. **属性测试**：属性测试使用 fast-check 库，默认运行 100 次迭代（耗时较长的测试使用 5 次迭代）
4. **真实数据库操作**：所有测试均使用真实数据库操作，禁止使用模拟
