# 实现计划：赠送积分生效日期修复

## 概述

修复购买会员套餐时赠送积分的生效日期问题，确保积分的 `effectiveAt` 与会员的 `startDate` 保持一致。

## 任务

- [x] 1. 修改 handleGiftPoints 函数
  - 修改 `server/services/payment/handlers/membershipHandler.ts`
  - 新增 `effectiveAt` 参数
  - 将积分创建时的 `effectiveAt` 从 `new Date()` 改为使用传入的参数
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. 修改 membershipHandler 调用处
  - 在调用 `handleGiftPoints` 时传入 `membership.startDate`
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. 编写属性测试
  - [x] 3.1 编写积分有效期同步属性测试
    - **Property 1: 积分有效期与会员有效期同步**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.2**
  
- [x] 4. 检查点 - 确保所有测试通过
  - 运行测试确保修复正确
  - 如有问题请询问用户

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加快 MVP 进度
- 每个任务都引用了具体的需求以便追溯
- 检查点确保增量验证
