# 实现计划：管理后台兑换码管理

## 概述

实现管理后台兑换码管理功能，包括兑换码列表查询、批量生成、作废、兑换记录查询和导出功能。

## 任务

- [x] 1. 扩展类型定义
  - [x] 1.1 在 `shared/types/redemption.ts` 中添加管理员视角的类型定义
    - 添加 `RedemptionCodeAdminInfo` 接口（扩展 `RedemptionCodeInfo`）
    - 添加 `RedemptionRecordAdminInfo` 接口（扩展 `RedemptionRecordInfo`）
    - 添加 `GenerateCodesParams` 和 `GenerateCodesResult` 接口
    - 添加类型名称和状态名称的辅助函数
    - _Requirements: 1.1, 4.1_

- [x] 2. 扩展数据访问层
  - [x] 2.1 在 `redemptionCode.dao.ts` 中添加批量创建和筛选查询方法
    - 实现 `bulkCreateRedemptionCodesDao` 批量创建兑换码
    - 扩展 `findAllRedemptionCodesDao` 支持类型和码值筛选
    - _Requirements: 2.7, 2.8, 1.2, 1.3, 1.4_
  - [x] 2.2 在 `redemptionRecord.dao.ts` 中添加管理员查询方法
    - 实现 `findRedemptionRecordsAdminDao` 包含用户信息的查询
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. 实现管理员服务层
  - [x] 3.1 创建 `server/services/redemption/redemptionCode.admin.service.ts`
    - 实现 `generateRedemptionCodesService` 批量生成兑换码
    - 实现 `getRedemptionCodesAdminService` 获取兑换码列表
    - 实现 `invalidateRedemptionCodeService` 作废兑换码
    - 实现 `getRedemptionRecordsAdminService` 获取兑换记录
    - 实现 `exportRedemptionCodesService` 导出兑换码
    - _Requirements: 2.1-2.8, 3.1-3.3, 5.1-5.3_
  - [x] 3.2 编写属性测试：兑换码唯一性
    - **Property 1: 兑换码唯一性**
    - **Validates: Requirements 2.8**
  - [x] 3.3 编写属性测试：生成数量一致性
    - **Property 2: 生成数量一致性**
    - **Validates: Requirements 2.7**
  - [x] 3.4 编写属性测试：类型参数完整性
    - **Property 3: 类型参数完整性**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [x] 3.5 编写属性测试：作废状态转换
    - **Property 4: 作废状态转换**
    - **Validates: Requirements 3.1, 3.2**

- [x] 4. 检查点 - 确保服务层测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 5. 实现 API 接口
  - [x] 5.1 创建 `server/api/v1/admin/redemption-codes/index.get.ts`
    - 实现获取兑换码列表接口
    - 支持分页、状态筛选、类型筛选、码值搜索
    - _Requirements: 1.1-1.5_
  - [x] 5.2 创建 `server/api/v1/admin/redemption-codes/index.post.ts`
    - 实现批量生成兑换码接口
    - 使用 Zod 验证参数
    - _Requirements: 2.1-2.8_
  - [x] 5.3 创建 `server/api/v1/admin/redemption-codes/[id]/invalidate.put.ts`
    - 实现作废兑换码接口
    - _Requirements: 3.1-3.4_
  - [x] 5.4 创建 `server/api/v1/admin/redemption-codes/records.get.ts`
    - 实现获取兑换记录列表接口
    - 支持分页、用户筛选、码值搜索
    - _Requirements: 4.1-4.4_
  - [x] 5.5 创建 `server/api/v1/admin/redemption-codes/export.get.ts`
    - 实现导出兑换码 CSV 接口
    - _Requirements: 5.1-5.4_
  - [x] 5.6 编写属性测试：分页数据完整性
    - **Property 5: 分页数据完整性**
    - **Validates: Requirements 1.5, 4.4**
  - [x] 5.7 编写属性测试：导出数量限制
    - **Property 6: 导出数量限制**
    - **Validates: Requirements 5.3**

- [x] 6. 检查点 - 确保 API 测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 7. 实现前端页面
  - [x] 7.1 创建 `app/pages/admin/redemption-codes/index.vue`
    - 实现兑换码列表页面
    - 包含筛选区域、数据表格、分页组件
    - 实现生成兑换码对话框
    - 实现作废功能
    - 实现导出功能
    - _Requirements: 1.1-1.5, 2.1-2.8, 3.1-3.4, 5.1-5.4_
  - [x] 7.2 创建 `app/pages/admin/redemption-codes/records.vue`
    - 实现兑换记录列表页面
    - 包含筛选区域、数据表格、分页组件
    - _Requirements: 4.1-4.4_

- [x] 8. 注册权限路由
  - [x] 8.1 在 `scripts/seed-rbac.ts` 中添加兑换码管理相关的 API 权限
    - 添加兑换码列表、生成、作废、记录、导出的 API 权限
    - _Requirements: 6.1-6.4_

- [x] 9. 最终检查点 - 确保所有功能正常
  - 确保所有测试通过，如有问题请询问用户

## 备注

- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 属性测试验证通用正确性属性
- 所有任务都必须完成
