# 会员系统测试模块

本模块包含会员系统相关的所有测试用例，涵盖会员级别管理、用户会员记录、积分系统、兑换码、营销活动等功能。

## 测试文件列表

### 基础设施文件

| 文件 | 说明 |
|------|------|
| `membership-test-fixtures.ts` | 测试数据工厂，包含状态常量、类型定义、数据生成方法和 fast-check 生成器 |
| `membership-test-helpers.ts` | 测试辅助函数，包含日期处理、会员验证、升级计算、积分消耗等模拟逻辑 |

### 单元测试

| 文件 | 说明 | 测试用例 |
|------|------|----------|
| `membership-level.test.ts` | 会员级别管理 | 级别排序一致性、级别比较逻辑、状态过滤 |
| `user-membership.test.ts` | 用户会员记录 | 会员状态管理、有效期验证 |
| `membership-upgrade.test.ts` | 会员升级 | 升级价格计算、状态转换、资格验证 |
| `point-system.test.ts` | 积分系统 | 积分记录管理、消耗逻辑 |
| `redemption.test.ts` | 兑换码 | 兑换码验证、兑换流程 |
| `campaign.test.ts` | 营销活动 | 活动有效期控制、注册赠送、邀请奖励 |

### 集成测试

| 文件 | 说明 | 测试用例 |
|------|------|----------|
| `membership-level-integration.test.ts` | 会员级别管理集成测试 | 级别创建、排序、状态管理、获取更高级别 |
| `user-membership-integration.test.ts` | 用户会员记录集成测试 | 会员创建、状态转换、有效期管理 |
| `membership-upgrade-integration.test.ts` | 会员升级集成测试 | 升级目标查询、价格计算、资格验证、升级执行 |
| `point-integration.test.ts` | 积分系统集成测试 | 积分创建、转移、消耗顺序 |
| `redemption-integration.test.ts` | 兑换码兑换集成测试 | 兑换流程、状态更新 |
| `register-gift-integration.test.ts` | 注册赠送集成测试 | 新用户注册赠送会员和积分 |
| `invitation-reward-integration.test.ts` | 邀请奖励集成测试 | 邀请人奖励发放、来源类型验证 |
| `product-purchase-integration.test.ts` | 商品购买集成测试 | 购买会员、购买积分 |

## 测试用例详情

### membership-level.test.ts - 会员级别管理

- 查询结果应按 sortOrder 升序排列
- sortOrder 值越小的级别应排在前面（级别越高）
- 只返回启用状态的会员级别
- 不返回已删除的会员级别
- 相同 sortOrder 的级别应保持稳定排序
- sortOrder 更小的级别应该更高
- 相同 sortOrder 的级别应该相等
- 级别比较应满足传递性

### membership-upgrade.test.ts - 会员升级

- 升级价格应等于目标级别剩余价值减去原级别剩余价值
- 积分补偿应等于升级价格乘以10
- 升级价格不应为负数
- 剩余天数为0时升级价格应为0
- 升级后原会员状态应变为 INACTIVE
- 升级后应创建新的会员记录
- 新会员应继承原会员的结束时间
- 升级后积分记录应转移到新会员
- 转移后积分数量应保持不变
- 没有有效会员时不能升级
- 会员已过期时不能升级
- 目标级别不高于当前级别时不能升级
- 满足所有条件时可以升级

### campaign.test.ts - 营销活动

- 活动未开始时不应返回有效活动
- 活动已结束时不应返回有效活动
- 活动禁用时不应返回有效活动
- 活动在有效期内且启用时应返回有效
- 有效活动配置了会员时应创建会员记录
- 有效活动配置了积分时应创建积分记录
- 仅积分赠送时积分有效期应为1年
- 会员+积分赠送时积分有效期应等于会员有效期
- 邀请奖励应发放给邀请人而非被邀请人
- 邀请奖励来源类型应为邀请注册赠送
- 无有效活动时不应创建任何记录

### invitation-reward-integration.test.ts - 邀请奖励集成测试

- 有邀请人且活动有效时邀请人应获得奖励
- 活动未开始时不应创建奖励
- 活动已结束时不应创建奖励
- 活动禁用时不应创建奖励
- 邀请奖励创建的会员记录来源类型应为邀请注册赠送
- 有效活动且有邀请人时应为邀请人创建会员和积分记录
- 只配置会员时只创建会员记录
- 只配置积分时只创建积分记录

### membership-level-integration.test.ts - 会员级别管理集成测试

- 创建的会员级别应包含所有必要字段
- 新创建的会员级别默认状态应为启用
- 查询结果应按 sortOrder 升序排列
- sortOrder 越小的级别越高
- 禁用级别后 isLevelActive 应返回 false
- 软删除级别后 isLevelActive 应返回 false
- 启用且未删除的级别 isLevelActive 应返回 true
- 应返回 sortOrder 更小的级别
- 最高级别应没有更高的级别
- 应排除禁用的级别
- 应排除已删除的级别
- 任意数量的级别排序后顺序应保持一致
- 排序不应改变原数组

### membership-upgrade-integration.test.ts - 会员升级集成测试

- 应返回比当前级别高的级别
- 最高级别应没有可升级目标
- 升级价格应等于目标级别剩余价值减去原级别剩余价值
- 积分补偿应等于升级价格乘以10
- 升级价格不应为负数
- 没有有效会员时不允许升级
- 会员已过期时不允许升级
- 会员状态无效时不允许升级
- 目标级别不高于当前级别时不允许升级
- 满足所有条件时允许升级
- 升级后原会员状态应变为 INACTIVE
- 升级后应创建新会员记录
- 新会员应继承原会员的结束时间
- 升级后积分记录应转移到新会员
- 转移后积分数量应保持不变
- 升级价格计算应符合公式
- 升级后状态转换应正确

## 运行测试

```bash
# 运行会员模块所有测试
npx vitest run tests/server/membership --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/membership/membership-level.test.ts --reporter=verbose
```
