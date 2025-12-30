# Implementation Plan: Code Deduplication

## Overview

本实现计划将 lexseek 项目内的重复代码进行统一，创建通用的 Composables 和共享类型定义，然后重构现有组件使用新的实现。

## Tasks

- [x] 1. 创建通用格式化 Composable
  - [x] 1.1 创建 `app/composables/useFormatters.ts` 文件
    - 实现 `formatDate`、`formatDateOnly`、`formatDateChinese`、`formatAmount` 方法
    - 处理空值和无效日期的边界情况
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 1.2 编写 useFormatters 属性测试
    - **Property 1: 日期格式化一致性**
    - **Property 2: 金额格式化精度**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

- [x] 2. 创建订单状态 Composable
  - [x] 2.1 创建 `app/composables/useOrderStatus.ts` 文件
    - 实现 `getStatusText`、`getStatusClass`、`formatDuration` 方法
    - 从 `#shared/types/payment` 导入 `OrderStatus` 和 `DurationUnit`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 2.2 编写 useOrderStatus 属性测试
    - **Property 3: 订单状态映射完整性**
    - **Property 4: 时长格式化正确性**
    - **Validates: Requirements 3.2, 3.3, 3.4**

- [x] 3. 创建会员状态 Composable
  - [x] 3.1 创建 `app/composables/useMembershipStatus.ts` 文件
    - 实现 `isNotEffective`、`isHighestLevel` 方法
    - 定义 `MembershipLevel` 接口
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 3.2 编写 useMembershipStatus 属性测试
    - **Property 5: 会员未生效判断正确性**
    - **Property 6: 最高级别判断正确性**
    - **Validates: Requirements 4.2, 4.3**

- [x] 4. 创建积分状态 Composable
  - [x] 4.1 创建 `app/composables/usePointStatus.ts` 文件
    - 实现 `isAvailable`、`isNotEffective` 方法
    - 定义 `PointRecord` 接口
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 4.2 编写 usePointStatus 属性测试
    - **Property 7: 积分可用性判断正确性**
    - **Property 8: 积分未生效判断正确性**
    - **Validates: Requirements 5.2, 5.3**

- [x] 5. Checkpoint - 确保所有 Composables 测试通过
  - 运行 `bun run test:server` 确保所有测试通过
  - 如有问题请询问用户

- [x] 6. 统一共享类型定义
  - [x] 6.1 更新 `shared/types/membership.ts`
    - 添加 `MembershipRecord` 接口
    - 添加 `MembershipLevelDisplay` 接口
    - _Requirements: 6.1, 6.2_
  - [x] 6.2 更新 `shared/types/payment.ts`
    - 添加 `OrderItem` 接口
    - 删除重复的 `CreatePaymentParams`、`PaymentResult`、`CallbackVerifyResult`
    - _Requirements: 1.4, 1.5, 6.3_
  - [x] 6.3 更新 `shared/types/point.types.ts`
    - 添加 `PointHistoryRecord` 接口
    - _Requirements: 6.4_

- [x] 7. 重构会员组件
  - [x] 7.1 重构 `MembershipRecordTable.vue`
    - 使用 `useFormatters` 替换内部的 `formatDate`、`formatDateOnly` 方法
    - 使用 `useMembershipStatus` 替换内部的 `isNotEffective`、`isHighestLevel` 方法
    - 从 `#shared/types/membership` 导入类型定义
    - 删除组件内部重复的类型定义和方法
    - _Requirements: 7.1_
  - [x] 7.2 重构 `MembershipRecordMobile.vue`
    - 使用 `useFormatters` 和 `useMembershipStatus`
    - 从 `#shared/types/membership` 导入类型定义
    - 删除组件内部重复的类型定义和方法
    - _Requirements: 7.2_

- [x] 8. 重构订单组件
  - [x] 8.1 重构 `OrderTable.vue`
    - 使用 `useFormatters` 替换内部的 `formatDate` 方法
    - 使用 `useOrderStatus` 替换内部的 `getStatusText`、`getStatusClass`、`formatDuration` 方法
    - 从 `#shared/types/payment` 导入 `OrderItem` 类型
    - 删除组件内部重复的类型定义和方法
    - _Requirements: 7.3_
  - [x] 8.2 重构 `OrderMobile.vue`
    - 使用 `useFormatters` 和 `useOrderStatus`
    - 从 `#shared/types/payment` 导入 `OrderItem` 类型
    - 删除组件内部重复的类型定义和方法
    - _Requirements: 7.4_

- [x] 9. 重构积分组件
  - [x] 9.1 重构 `PointHistoryTable.vue`
    - 使用 `useFormatters` 替换内部的日期格式化
    - 使用 `usePointStatus` 替换内部的 `isAvailable`、`isNotEffective` 方法
    - 从 `#shared/types/point.types` 导入 `PointHistoryRecord` 类型
    - 删除组件内部重复的类型定义和方法
    - _Requirements: 7.5_
  - [x] 9.2 重构 `PointHistoryMobile.vue`
    - 使用 `useFormatters` 和 `usePointStatus`
    - 从 `#shared/types/point.types` 导入 `PointHistoryRecord` 类型
    - 删除组件内部重复的类型定义和方法
    - _Requirements: 7.6_

- [x] 10. Final Checkpoint - 确保所有测试通过
  - 运行 `bun run test:server` 确保所有测试通过
  - 运行 `bun run build` 确保项目可以正常构建
  - 如有问题请询问用户

## Notes

- 所有任务都是必需的，包括测试任务
- 每个任务都引用了具体的需求编号，便于追溯
- Checkpoint 任务用于确保增量验证
- 属性测试验证通用正确性属性

## Completion Summary

所有任务已完成：
- 创建了 4 个 Composables：`useFormatters`、`useOrderStatus`、`useMembershipStatus`、`usePointStatus`
- 编写了 40 个属性测试用例，全部通过
- 更新了 3 个共享类型文件，添加了前端展示用的接口定义
- 删除了 `shared/types/payment.ts` 中与适配器层重复的类型定义
- 重构了 6 个 Vue 组件，消除了重复的类型定义和工具方法
