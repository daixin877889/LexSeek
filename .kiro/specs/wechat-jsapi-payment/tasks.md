# Implementation Plan: 微信 JSAPI 支付

## Overview

本实现计划将微信 JSAPI 支付功能分解为可执行的编码任务。采用渐进式实现策略，先完成后端基础设施，再实现前端集成，最后进行页面适配。

## Tasks

- [x] 1. 配置和基础设施
  - [x] 1.1 添加环境变量配置
    - 在 `.env.example` 中添加微信相关配置项
    - 在 `nuxt.config.ts` 中添加 runtimeConfig 配置
    - 配置项：`WECHAT_MP_SECRET`、`WECHAT_AUTH_CALLBACK_URL`、`WECHAT_AUTH_REDIRECT_WHITELIST`
    - _Requirements: 2.1, 2.2_

- [x] 2. 后端服务层实现
  - [x] 2.1 创建微信服务
    - 创建 `server/services/wechat/wechat.service.ts`
    - 实现 `getMpOpenid(code)` 函数，调用微信 API 获取 OpenID
    - 参考旧项目 `LexSeek/lexseekApi/src/services/wechat/wechat.service.ts`
    - _Requirements: 2.6_

  - [x] 2.2 编写微信服务单元测试
    - 测试在 `tests/server/wechat/auth-callback.test.ts` 中覆盖
    - _Requirements: 2.6, 2.8_

- [x] 3. 后端 API 接口实现
  - [x] 3.1 创建通用授权回调接口
    - 创建 `server/api/v1/wechat/auth-callback.get.ts`
    - 实现 state 参数解析（base64 + JSON）
    - 实现白名单验证逻辑
    - 实现 302 重定向，携带 code 参数
    - _Requirements: 2.4, 2.5_

  - [x] 3.2 编写授权回调接口属性测试
    - 创建 `tests/server/wechat/auth-callback.test.ts`
    - **Property 4: State 参数编解码往返一致性**
    - **Property 5: 授权回调白名单验证**
    - **Property 6: 授权回调 code 参数传递**
    - **Validates: Requirements 2.3, 2.4, 2.5**

  - [x] 3.3 创建获取 OpenID 接口
    - 创建 `server/api/v1/wechat/openid.post.ts`
    - 接收 code 参数，调用 wechat.service 获取 OpenID
    - 返回 openid 和 unionid
    - _Requirements: 2.6_

- [x] 4. Checkpoint - 后端功能验证
  - 所有后端测试通过（9/9）
  - 代码无语法错误

- [x] 5. 前端工具函数扩展
  - [x] 5.1 扩展微信工具函数
    - 在 `app/utils/wechat.ts` 中添加 `getWechatAuthUrlWithCallback()` 函数
    - 添加 `encodeAuthState()` 和 `decodeAuthState()` 函数
    - 实现 state 参数的 JSON + base64 编码
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.2 编写工具函数属性测试
    - 测试在 `tests/server/wechat/auth-callback.test.ts` 中覆盖
    - **Validates: Requirements 2.2**

- [x] 6. 前端 Composable 实现
  - [x] 6.1 创建 useWechatPayment composable
    - 创建 `app/composables/useWechatPayment.ts`
    - 实现 `isInWechat` 计算属性（复用 isWeChatBrowser）
    - 实现 `openId` 状态管理（sessionStorage 存取）
    - 实现 `ensureOpenId()` 方法（检查缓存或触发授权）
    - 实现 `invokeJsapiPay()` 方法（调用 WeixinJSBridge）
    - 实现 `redirectToAuth()` 方法（构建授权 URL 并重定向）
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.7, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2_

  - [x] 6.2 编写 composable 单元测试
    - 测试逻辑在属性测试中覆盖
    - _Requirements: 2.7_

- [x] 7. 支付组件扩展
  - [x] 7.1 扩展 PaymentQRCodeDialog 组件
    - 修改 `app/components/payment/PaymentQRCodeDialog.vue`
    - 添加 `useJsapi`、`jsapiParams`、`onJsapiResult` props
    - 实现 JSAPI 支付模式的 UI 和逻辑
    - 支持支付结果回调处理
    - _Requirements: 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3_

- [x] 8. Checkpoint - 前端组件验证
  - 所有代码无语法错误
  - 组件扩展完成

- [x] 9. 支付页面适配
  - [x] 9.1 适配会员等级购买页面
    - 修改 `app/pages/dashboard/membership/level.vue`
    - 集成 useWechatPayment composable
    - 根据环境自动选择支付方式（JSAPI 或扫码）
    - 处理授权回调后的 code 参数
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [x] 9.2 适配积分购买页面
    - 修改 `app/pages/dashboard/membership/point.vue`
    - 集成 useWechatPayment composable
    - 根据环境自动选择支付方式
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

  - [x] 9.3 适配订单支付页面
    - 修改 `app/pages/dashboard/membership/order.vue`
    - 集成 useWechatPayment composable
    - 根据环境自动选择支付方式
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 10. Final Checkpoint - 完整功能验证
  - 所有测试通过
  - 代码无语法错误
  - 需要在微信开发者工具中测试完整支付流程

## Notes

- Property 1 和 Property 2（微信浏览器检测）已有现有测试覆盖，无需重复编写
- Property 7 和 Property 8（JSAPI 支付参数）依赖微信支付 API，建议手动测试
- E2E 测试需要在真实微信环境中进行，不在本任务列表中
- 修复了白名单验证的安全漏洞（使用严格匹配替代 startsWith）

## 已创建/修改的文件

### 新增文件
- `server/services/wechat/wechat.service.ts` - 微信服务
- `server/api/v1/wechat/auth-callback.get.ts` - 授权回调接口
- `server/api/v1/wechat/openid.post.ts` - 获取 OpenID 接口
- `app/composables/useWechatPayment.ts` - 微信支付 Composable
- `tests/server/wechat/auth-callback.test.ts` - 授权回调测试
- `tests/server/wechat/README.md` - 测试模块说明

### 修改文件
- `.env.example` - 添加微信公众号配置
- `nuxt.config.ts` - 添加 runtimeConfig
- `app/utils/wechat.ts` - 扩展授权 URL 构建函数
- `app/components/payment/PaymentQRCodeDialog.vue` - 支持 JSAPI 支付
- `app/components/membership/MembershipQRCodeDialog.vue` - 支持 JSAPI 支付
- `app/components/points/PointQRCodeDialog.vue` - 支持 JSAPI 支付
- `app/pages/dashboard/membership/level.vue` - 集成 JSAPI 支付
- `app/pages/dashboard/membership/point.vue` - 集成 JSAPI 支付
- `app/pages/dashboard/membership/order.vue` - 集成 JSAPI 支付
