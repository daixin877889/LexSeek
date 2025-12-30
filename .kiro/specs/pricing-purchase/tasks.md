# 实现计划: Pricing 页面购买功能

## 概述

实现 `/pricing` 页面的会员购买功能，包括登录状态检测、认证弹框、订单创建和支付流程。所有组件设计为可复用，可在其他页面中使用。

## 任务

- [x] 1. 创建微信浏览器检测工具函数
  - 创建 `app/utils/wechat.ts` 文件
  - 实现 `isWeChatBrowser()` 函数
  - 实现 `getWechatAuthUrl()` 函数
  - _Requirements: 5.1, 5.4_

- [x] 2. 创建 AuthModal 认证弹框组件
  - [x] 2.1 创建组件基础结构
    - 创建 `app/components/auth/AuthModal.vue`
    - 实现 Dialog 容器和 Tabs 切换
    - _Requirements: 2.1, 2.8_
  - [x] 2.2 实现登录 Tab
    - 实现手机号和密码登录表单
    - 复用 authStore 的登录逻辑
    - _Requirements: 2.2_
  - [x] 2.3 实现注册 Tab
    - 实现手机号、验证码、密码注册表单
    - 复用 authStore 的注册逻辑
    - 包含服务条款确认
    - _Requirements: 2.4_
  - [x] 2.4 实现认证成功后的回调
    - 登录/注册成功后触发 success 事件
    - 关闭弹框
    - _Requirements: 2.5_

- [x] 3. 创建 usePurchaseFlow Composable
  - [x] 3.1 实现基础状态管理
    - 定义所有响应式状态
    - 实现状态初始化
    - _Requirements: 1.1, 1.2_
  - [x] 3.2 实现登录状态检测
    - 检测用户是否已登录
    - 未登录时显示认证弹框
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 3.3 实现订单创建逻辑
    - 调用支付创建 API
    - 处理限购检查
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 3.4 实现支付状态轮询
    - 每 2 秒轮询支付状态
    - 支付成功后停止轮询
    - _Requirements: 4.3, 4.4, 4.5_
  - [x] 3.5 实现微信浏览器特殊处理
    - 检测微信浏览器环境
    - 跳转到专用购买页面
    - _Requirements: 5.1, 5.4_

- [x] 4. 创建 PurchaseFlow 组件
  - [x] 4.1 创建组件基础结构
    - 创建 `app/components/purchase/PurchaseFlow.vue`
    - 集成 AuthModal 组件
    - 集成 MembershipQRCodeDialog 组件
    - _Requirements: 2.1, 4.2_
  - [x] 4.2 实现事件处理
    - 处理认证成功/取消事件
    - 处理支付成功/取消事件
    - _Requirements: 2.5, 2.7, 4.4_

- [x] 5. 更新 pricing.vue 页面
  - [x] 5.1 集成 PurchaseFlow 组件
    - 引入 PurchaseFlow 组件
    - 使用 usePurchaseFlow composable
    - _Requirements: 1.1, 1.2_
  - [x] 5.2 更新购买按钮逻辑
    - 修改 buy 方法调用 purchaseFlow.buy()
    - 移除旧的二维码生成逻辑
    - _Requirements: 4.1, 4.2_
  - [x] 5.3 实现错误处理
    - 显示错误提示
    - 提供联系客服入口
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 6. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户

- [x] 7. 编写单元测试
  - [x] 7.1 编写 wechat 工具函数测试
    - 测试 isWeChatBrowser 函数
    - 测试 getWechatAuthUrl 函数
    - _Requirements: 5.1, 5.4_
  - [x] 7.2 编写 usePurchaseFlow 测试
    - **Property 1: 未登录用户购买触发登录弹框**
    - **Validates: Requirements 1.1, 2.1**
  - [x] 7.3 编写登录状态检测测试
    - **Property 2: 已登录用户直接进入支付流程**
    - **Validates: Requirements 1.2**

- [x] 8. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户

## 备注

- 每个任务都引用了具体的需求以便追溯
- 检查点用于确保增量验证
- 属性测试验证通用的正确性属性
- 单元测试验证具体的示例和边界情况
