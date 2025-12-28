# 需求文档

## 简介

本规范旨在重构现有的测试用例，将模拟测试（Mock Tests）转换为真正的集成测试（Real Integration Tests）。当前测试文件使用内存中的模拟对象和工厂函数，而非真实的数据库操作和网络请求，这违反了项目的测试规范。

## 术语表

- **Mock_Test**: 使用模拟对象和工厂函数创建假数据进行测试的方法
- **Integration_Test**: 使用真实数据库操作和网络请求进行测试的方法
- **Prisma_Client**: 项目使用的数据库 ORM 客户端
- **DAO_Layer**: 数据访问层，封装数据库 CRUD 操作
- **Service_Layer**: 服务层，封装业务逻辑
- **Property_Based_Test**: 使用 fast-check 库生成随机数据进行属性测试
- **Test_Fixture**: 测试数据工厂，用于生成测试所需的数据

## 需求

### 需求 1：会员级别测试重构

**用户故事：** 作为开发者，我希望会员级别测试能够真实操作数据库，以便验证 DAO 层和 Service 层的正确性。

#### 验收标准

1. WHEN 测试创建会员级别 THEN Test_Suite SHALL 调用真实的 `createMembershipLevelDao` 函数并验证数据库中存在该记录
2. WHEN 测试查询会员级别 THEN Test_Suite SHALL 从真实数据库中查询数据并验证返回结果
3. WHEN 测试更新会员级别 THEN Test_Suite SHALL 调用真实的 `updateMembershipLevelDao` 函数并验证数据库中的更新
4. WHEN 测试删除会员级别 THEN Test_Suite SHALL 调用真实的 `deleteMembershipLevelDao` 函数并验证软删除生效
5. WHEN 测试完成后 THEN Test_Suite SHALL 清理所有测试数据以保持数据库干净

### 需求 2：用户会员记录测试重构

**用户故事：** 作为开发者，我希望用户会员记录测试能够真实操作数据库，以便验证会员开通、续费、升级等业务逻辑。

#### 验收标准

1. WHEN 测试创建用户会员记录 THEN Test_Suite SHALL 调用真实的 `createUserMembershipDao` 函数并验证数据库中存在该记录
2. WHEN 测试查询当前有效会员 THEN Test_Suite SHALL 从真实数据库中查询并验证会员状态和有效期
3. WHEN 测试会员历史记录 THEN Test_Suite SHALL 从真实数据库中查询并验证分页和排序
4. WHEN 测试会员失效 THEN Test_Suite SHALL 调用真实的 `invalidateUserMembershipDao` 函数并验证状态变更
5. WHEN 测试完成后 THEN Test_Suite SHALL 清理所有测试数据

### 需求 3：积分系统测试重构

**用户故事：** 作为开发者，我希望积分系统测试能够真实操作数据库，以便验证积分发放、消费、过期等业务逻辑。

#### 验收标准

1. WHEN 测试创建积分记录 THEN Test_Suite SHALL 调用真实的积分 DAO 函数并验证数据库中存在该记录
2. WHEN 测试积分消费 THEN Test_Suite SHALL 验证积分扣减逻辑和剩余积分计算
3. WHEN 测试积分过期 THEN Test_Suite SHALL 验证过期积分的状态变更
4. WHEN 测试积分查询 THEN Test_Suite SHALL 从真实数据库中查询并验证按过期时间排序
5. WHEN 测试完成后 THEN Test_Suite SHALL 清理所有测试数据

### 需求 4：兑换码测试重构

**用户故事：** 作为开发者，我希望兑换码测试能够真实操作数据库，以便验证兑换码生成、使用、过期等业务逻辑。

#### 验收标准

1. WHEN 测试创建兑换码 THEN Test_Suite SHALL 调用真实的兑换码 DAO 函数并验证数据库中存在该记录
2. WHEN 测试兑换码使用 THEN Test_Suite SHALL 验证兑换码状态变更和会员/积分发放
3. WHEN 测试兑换码过期 THEN Test_Suite SHALL 验证过期兑换码无法使用
4. WHEN 测试兑换码查询 THEN Test_Suite SHALL 从真实数据库中查询并验证状态筛选
5. WHEN 测试完成后 THEN Test_Suite SHALL 清理所有测试数据

### 需求 5：营销活动测试重构

**用户故事：** 作为开发者，我希望营销活动测试能够真实操作数据库，以便验证活动创建、触发、奖励发放等业务逻辑。

#### 验收标准

1. WHEN 测试创建营销活动 THEN Test_Suite SHALL 调用真实的活动 DAO 函数并验证数据库中存在该记录
2. WHEN 测试活动触发 THEN Test_Suite SHALL 验证活动条件判断和奖励发放
3. WHEN 测试活动状态 THEN Test_Suite SHALL 验证活动启用/禁用状态变更
4. WHEN 测试活动时间范围 THEN Test_Suite SHALL 验证活动在有效期内才能触发
5. WHEN 测试完成后 THEN Test_Suite SHALL 清理所有测试数据

### 需求 6：测试数据管理

**用户故事：** 作为开发者，我希望有统一的测试数据管理机制，以便在测试前后正确设置和清理数据。

#### 验收标准

1. THE Test_Helper SHALL 提供创建测试用户的函数，返回真实的数据库记录
2. THE Test_Helper SHALL 提供创建测试会员级别的函数，返回真实的数据库记录
3. THE Test_Helper SHALL 提供清理测试数据的函数，按正确的外键顺序删除数据
4. WHEN 测试开始前 THEN Test_Suite SHALL 调用 `beforeAll` 或 `beforeEach` 设置测试数据
5. WHEN 测试结束后 THEN Test_Suite SHALL 调用 `afterAll` 或 `afterEach` 清理测试数据

### 需求 7：删除模拟测试文件

**用户故事：** 作为开发者，我希望删除所有模拟测试相关的文件，以避免混淆和维护负担。

#### 验收标准

1. THE Refactoring_Process SHALL 删除 `membership-test-fixtures.ts` 中的 Mock 接口和工厂函数
2. THE Refactoring_Process SHALL 删除 `membership-test-helpers.ts` 中的模拟业务逻辑函数
3. THE Refactoring_Process SHALL 更新所有测试文件，移除对模拟函数的依赖
4. THE Refactoring_Process SHALL 保留 fast-check 生成器，用于属性测试的随机数据生成

### 需求 8：属性测试保留与增强

**用户故事：** 作为开发者，我希望保留属性测试（Property-Based Testing）的能力，但使用真实数据库操作。

#### 验收标准

1. THE Property_Test SHALL 使用 fast-check 生成随机输入数据
2. WHEN 执行属性测试 THEN Test_Suite SHALL 将生成的数据写入真实数据库
3. WHEN 属性测试完成 THEN Test_Suite SHALL 验证数据库中的实际结果
4. THE Property_Test SHALL 配置 `{ numRuns: 100 }` 运行 100 次迭代
5. WHEN 属性测试结束 THEN Test_Suite SHALL 清理所有生成的测试数据
