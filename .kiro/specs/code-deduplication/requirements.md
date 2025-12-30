# Requirements Document

## Introduction

本文档定义了 lexseek 项目内代码去重和统一的需求。目标是消除项目内重复的类型定义、工具方法和 UI 组件模式，提高代码的可维护性和一致性。

## Glossary

- **Shared_Types**: 位于 `shared/types/` 目录下的共享类型定义
- **Adapter_Types**: 位于 `server/lib/payment/types.ts` 的支付适配器类型定义
- **Service_Types**: 服务层内部定义的类型
- **Composable**: Vue 3 的组合式函数，用于封装可复用的逻辑
- **Formatter**: 格式化工具函数，如日期格式化、金额格式化等

## Requirements

### Requirement 1: 统一支付类型定义

**User Story:** 作为开发者，我希望支付相关的类型定义有清晰的分层和命名，以便在不同层级使用正确的类型。

#### Acceptance Criteria

1. THE Shared_Types SHALL 只包含面向 API 层和前端的类型定义
2. THE Adapter_Types SHALL 只包含支付适配器内部使用的类型定义
3. WHEN 类型在多个层级使用时 THEN THE System SHALL 在 Shared_Types 中定义并导出
4. THE System SHALL 删除 `shared/types/payment.ts` 中的 `CreatePaymentParams` 和 `PaymentResult`，因为它们与 `server/lib/payment/types.ts` 中的定义重复
5. THE System SHALL 删除 `shared/types/payment.ts` 中的 `CallbackVerifyResult`，因为它只在服务端使用

### Requirement 2: 创建通用格式化 Composable

**User Story:** 作为开发者，我希望有统一的日期和金额格式化方法，避免在每个组件中重复定义。

#### Acceptance Criteria

1. THE System SHALL 创建 `app/composables/useFormatters.ts` 文件
2. THE Composable SHALL 提供 `formatDate` 方法，格式为 `YYYY-MM-DD HH:mm`
3. THE Composable SHALL 提供 `formatDateOnly` 方法，格式为 `YY/MM/DD`
4. THE Composable SHALL 提供 `formatDateChinese` 方法，格式为 `YYYY年MM月DD日 HH:mm`
5. THE Composable SHALL 提供 `formatAmount` 方法，格式化金额为带两位小数的字符串
6. WHEN 日期字符串为空或无效时 THEN THE Formatter SHALL 返回 `—`

### Requirement 3: 创建订单状态 Composable

**User Story:** 作为开发者，我希望有统一的订单状态处理方法，避免在订单相关组件中重复定义。

#### Acceptance Criteria

1. THE System SHALL 创建 `app/composables/useOrderStatus.ts` 文件
2. THE Composable SHALL 提供 `getStatusText` 方法，返回订单状态的中文文本
3. THE Composable SHALL 提供 `getStatusClass` 方法，返回订单状态对应的 CSS 类名
4. THE Composable SHALL 提供 `formatDuration` 方法，格式化时长为中文描述

### Requirement 4: 创建会员状态 Composable

**User Story:** 作为开发者，我希望有统一的会员状态处理方法，避免在会员相关组件中重复定义。

#### Acceptance Criteria

1. THE System SHALL 创建 `app/composables/useMembershipStatus.ts` 文件
2. THE Composable SHALL 提供 `isNotEffective` 方法，判断会员是否未生效
3. THE Composable SHALL 提供 `isHighestLevel` 方法，判断是否为最高会员级别
4. THE Composable SHALL 接受会员级别列表作为参数

### Requirement 5: 创建积分状态 Composable

**User Story:** 作为开发者，我希望有统一的积分状态处理方法，避免在积分相关组件中重复定义。

#### Acceptance Criteria

1. THE System SHALL 创建 `app/composables/usePointStatus.ts` 文件
2. THE Composable SHALL 提供 `isAvailable` 方法，判断积分记录是否可用
3. THE Composable SHALL 提供 `isNotEffective` 方法，判断积分记录是否未生效

### Requirement 6: 统一前端类型定义

**User Story:** 作为开发者，我希望前端组件使用的类型定义集中管理，而不是在每个组件内部重复定义。

#### Acceptance Criteria

1. THE System SHALL 在 `shared/types/membership.ts` 中添加 `MembershipRecord` 接口
2. THE System SHALL 在 `shared/types/membership.ts` 中添加 `MembershipLevel` 接口
3. THE System SHALL 在 `shared/types/payment.ts` 中添加 `OrderItem` 接口
4. THE System SHALL 在 `shared/types/point.types.ts` 中添加 `PointHistoryRecord` 接口
5. WHEN 组件需要使用这些类型时 THEN THE Component SHALL 从 `#shared/types/` 导入

### Requirement 7: 重构现有组件使用新的 Composables

**User Story:** 作为开发者，我希望现有组件使用新创建的 Composables，消除重复代码。

#### Acceptance Criteria

1. THE `MembershipRecordTable.vue` SHALL 使用 `useFormatters` 和 `useMembershipStatus`
2. THE `MembershipRecordMobile.vue` SHALL 使用 `useFormatters` 和 `useMembershipStatus`
3. THE `OrderTable.vue` SHALL 使用 `useFormatters` 和 `useOrderStatus`
4. THE `OrderMobile.vue` SHALL 使用 `useFormatters` 和 `useOrderStatus`
5. THE `PointHistoryTable.vue` SHALL 使用 `useFormatters` 和 `usePointStatus`
6. THE `PointHistoryMobile.vue` SHALL 使用 `useFormatters` 和 `usePointStatus`
7. WHEN 重构完成后 THEN THE Components SHALL 删除内部重复的方法定义
