# 实现计划：会员权益管理系统

## 概述

本实现计划基于需求文档和设计文档，分阶段实现会员权益管理系统的云盘空间权益功能。

## 任务列表

- [x] 1. 数据库结构变更
  - [x] 1.1 修改 benefits 表结构
    - 添加 `code` 字段（唯一标识码）
    - 添加 `unitType` 字段（单位类型）
    - 添加 `consumptionMode` 字段（计算模式）
    - 添加 `defaultValue` 字段（默认值）
    - 删除原有的 `type` 和 `value` 字段
    - _需求: 1.1, 1.3, 1.4_
  - [x] 1.2 修改 membership_benefits 表结构
    - 添加 `benefitValue` 字段（权益值）
    - _需求: 2.1_
  - [x] 1.3 创建 user_benefits 表
    - 包含 userId、benefitId、benefitValue、sourceType、sourceId、effectiveAt、expiredAt、status 等字段
    - 添加必要的索引
    - _需求: 3.1, 3.4_
  - [x] 1.4 修改 users 表添加 userBenefits 关联
    - 在 users 模型中添加 userBenefits 关联字段
    - _需求: 3.1_
  - [x] 1.5 执行数据库迁移
    - 运行 `bunx prisma migrate dev` 生成并应用迁移
    - _需求: 1.1, 2.1, 3.1_

- [x] 2. 类型定义和常量
  - [x] 2.1 创建 shared/types/benefit.ts
    - 定义 BenefitCode 枚举
    - 定义 BenefitUnitType 枚举
    - 定义 BenefitConsumptionMode 枚举
    - 定义 BenefitSourceType 枚举
    - 定义 UserBenefitSummary 接口
    - 定义 StorageQuotaInfo 接口
    - 定义 StorageQuotaCheckResult 接口
    - _需求: 1.3, 3.4, 4.1_

- [x] 3. 检查点 - 确保数据库迁移成功
  - 运行 `bunx prisma generate` 确保类型生成正确
  - 确认所有表结构变更已应用

- [x] 4. 数据访问层实现
  - [x] 4.1 修改 benefit.dao.ts 添加新方法
    - 实现 `findBenefitByCodeDao` 根据 code 查询权益定义
    - _需求: 1.2, 4.2_
  - [x] 4.2 创建 userBenefit.dao.ts
    - 实现 `findUserActiveBenefitsDao` 查询用户生效中的权益记录
    - 实现 `sumUserBenefitValueDao` 汇总用户指定权益的总值
    - 实现 `createUserBenefitDao` 创建用户权益记录
    - 实现 `createUserBenefitsDao` 批量创建用户权益记录
    - 实现 `expireUserBenefitsBySourceDao` 过期用户权益记录
    - _需求: 3.2, 3.3, 4.1, 4.3_

- [x] 5. 服务层实现
  - [x] 5.1 创建 userBenefit.service.ts
    - 实现 `getUserBenefitSummaryService` 获取用户权益汇总
    - 实现 `getUserStorageQuotaService` 获取用户云盘空间配额
    - 实现 `checkStorageQuotaService` 校验云盘空间是否足够
    - 实现 `grantMembershipBenefitsService` 发放会员权益
    - _需求: 4.1, 4.2, 4.3, 4.4, 7.2, 7.3, 8.1, 8.2, 9.2_
  - [ ]* 5.2 编写权益计算属性测试
    - **Property P1: 权益值计算正确性**
    - **Validates: Requirements 4.1, 4.2**
  - [ ]* 5.3 编写云盘空间校验属性测试
    - **Property P3: 云盘空间校验正确性**
    - **Validates: Requirements 9.2, 9.3**

- [x] 6. 检查点 - 确保服务层测试通过
  - 运行测试确保权益计算逻辑正确
  - 确认所有服务层函数可正常调用

- [x] 7. API 接口实现
  - [x] 7.1 实现 GET /api/v1/users/benefits 接口
    - 返回当前用户的所有有效权益汇总
    - 使用 Zod 验证请求参数
    - _需求: 7.1, 7.2, 7.3_
  - [x] 7.2 实现 GET /api/v1/users/benefits/[benefitCode] 接口
    - 返回指定权益类型的详细信息
    - 包含权益记录列表
    - _需求: 7.4_
  - [x] 7.3 修改 POST /api/v1/storage/presigned-url 接口
    - 在生成签名前调用 `checkStorageQuotaService` 校验空间
    - 空间不足时返回详细错误信息
    - 错误信息使用 `formatByteSize` 格式化
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 8. 前端页面实现
  - [x] 8.1 修改 disk-space.vue 页面
    - 调用 `/api/v1/users/benefits/storage_space` 获取空间数据
    - 更新 storageInfo 和 storageQuota 响应式数据
    - 实现进度条颜色动态变化（正常/警告/危险）
    - _需求: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

- [x] 9. 检查点 - 确保前端页面正常显示
  - 确认云盘空间页面正确显示使用量和总容量
  - 确认进度条颜色根据使用率正确变化

- [x] 10. 初始化数据
  - [x] 10.1 创建云盘空间权益初始数据
    - 在 benefits 表中插入 storage_space 权益定义
    - 设置默认值（如 1GB = 1073741824 字节）
    - _需求: 1.3_
  - [x] 10.2 配置会员级别权益
    - 为各会员级别配置云盘空间权益值
    - _需求: 2.1, 2.2_

- [ ] 11. 会员权益发放集成（可选）
  - [ ]* 11.1 修改会员购买流程
    - 在会员购买成功后调用 `grantMembershipBenefitsService`
    - _需求: 8.1, 8.2_
  - [ ]* 11.2 修改兑换码兑换流程
    - 在兑换码兑换成功后调用 `grantMembershipBenefitsService`
    - _需求: 8.1, 8.2_

- [x] 12. 最终检查点
  - 确保所有测试通过
  - 确认云盘上传时空间校验正常工作
  - 确认云盘空间页面正确显示使用情况

## 备注

- 标记 `*` 的任务为可选任务，可根据实际情况决定是否实现
- 每个检查点用于验证阶段性成果，确保增量开发的正确性
- 属性测试使用 fast-check 库，配置 `{ numRuns: 100 }` 运行 100 次
- 所有 API 接口使用 Zod 进行参数验证
- 代码注释使用中文
