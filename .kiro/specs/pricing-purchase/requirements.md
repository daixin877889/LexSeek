# 需求文档

## 简介

本文档定义了 `/pricing` 页面会员购买功能的需求。该页面是一个公开页面，用户可能处于未登录状态，需要设计一个完整的购买流程来处理登录状态检测、登录引导、订单创建和支付等环节。

## 术语表

- **Pricing_Page**: 价格方案展示页面，展示所有会员套餐信息
- **Guest_User**: 未登录的访客用户
- **Logged_In_User**: 已登录的用户
- **Purchase_Flow**: 购买流程，从点击购买按钮到完成支付的完整流程
- **Login_Modal**: 登录弹框组件（已废弃，使用 Auth_Modal）
- **Auth_Modal**: 认证弹框组件，支持登录和注册，用于在当前页面内完成用户认证
- **Payment_QRCode**: 微信支付二维码，用于扫码支付
- **WeChat_Browser**: 微信内置浏览器环境
- **Order_Service**: 订单服务，负责创建和管理订单
- **Payment_Service**: 支付服务，负责发起支付和处理支付回调
- **Product**: 会员商品，包含价格、时长、赠送积分等信息

## 需求

### 需求 1: 登录状态检测

**用户故事:** 作为一个用户，我希望在点击购买按钮时系统能自动检测我的登录状态，以便引导我完成后续操作。

#### 验收标准

1. WHEN Guest_User 点击购买按钮时, THE Pricing_Page SHALL 检测到用户未登录
2. WHEN Logged_In_User 点击购买按钮时, THE Pricing_Page SHALL 直接进入支付流程
3. THE Pricing_Page SHALL 使用现有的认证机制检查登录状态

### 需求 2: 未登录用户引导

**用户故事:** 作为一个未登录用户，我希望能在当前页面完成登录或注册，而不需要跳转到其他页面，以便保持购买意向。

#### 验收标准

1. WHEN Guest_User 点击购买按钮时, THE Pricing_Page SHALL 显示 Auth_Modal
2. THE Auth_Modal SHALL 支持手机号和密码登录
3. THE Auth_Modal SHALL 支持短信验证码登录
4. THE Auth_Modal SHALL 支持新用户注册，包含手机号、验证码、密码设置
5. WHEN 登录或注册成功时, THE Auth_Modal SHALL 关闭并自动继续购买流程
6. THE Auth_Modal SHALL 记住用户选择的商品，以便登录/注册后继续购买
7. IF 用户未完成认证就关闭 Auth_Modal, THEN THE Pricing_Page SHALL 取消当前购买尝试
8. THE Auth_Modal SHALL 提供登录和注册之间的快速切换

### 需求 3: 订单创建

**用户故事:** 作为一个已登录用户，我希望系统能为我创建订单，以便我可以完成支付。

#### 验收标准

1. WHEN Logged_In_User 发起购买时, THE Order_Service SHALL 使用选中的商品创建订单
2. THE Order_Service SHALL 验证商品存在且可购买
3. THE Order_Service SHALL 检查限购商品的购买限制（如新手套餐）
4. IF 商品有购买限制且用户已达到限制, THEN THE Order_Service SHALL 返回错误信息
5. THE Order_Service SHALL 根据商品配置计算正确的价格

### 需求 4: 支付流程

**用户故事:** 作为一个用户，我希望能通过微信扫码支付完成购买，以便快速完成交易。

#### 验收标准

1. WHEN 订单创建成功时, THE Payment_Service SHALL 生成微信支付二维码
2. THE Pricing_Page SHALL 在弹框中显示 Payment_QRCode
3. THE Pricing_Page SHALL 每 2 秒轮询一次支付状态
4. WHEN 支付成功时, THE Pricing_Page SHALL 显示成功消息并关闭二维码弹框
5. WHEN 支付成功时, THE Pricing_Page SHALL 更新用户的会员状态

### 需求 5: 微信浏览器特殊处理

**用户故事:** 作为一个在微信内访问的用户，我希望能直接使用微信支付，而不需要扫码。

#### 验收标准

1. WHEN 用户在 WeChat_Browser 中点击购买时, THE Pricing_Page SHALL 跳转到专用购买页面
2. THE 专用购买页面 SHALL 处理微信 OAuth 授权
3. THE 专用购买页面 SHALL 使用微信 JSAPI 支付而非二维码支付
4. IF 用户不在 WeChat_Browser 中, THEN THE Pricing_Page SHALL 使用二维码支付流程

### 需求 6: 错误处理

**用户故事:** 作为一个用户，我希望在购买过程中遇到问题时能看到清晰的错误提示。

#### 验收标准

1. IF 订单创建失败, THEN THE Pricing_Page SHALL 显示服务器返回的错误信息
2. IF 支付创建失败, THEN THE Pricing_Page SHALL 显示错误信息并允许重试
3. IF 发生网络错误, THEN THE Pricing_Page SHALL 显示通用错误信息
4. THE Pricing_Page SHALL 在发生错误时提供联系客服的方式

### 需求 7: 用户体验优化

**用户故事:** 作为一个用户，我希望购买流程简洁流畅，不会因为登录等操作而中断我的购买意向。

#### 验收标准

1. THE Auth_Modal SHALL 具有清晰简洁的设计
2. THE Auth_Modal SHALL 提供登录和注册 Tab 的快速切换
3. THE Auth_Modal 注册表单 SHALL 预填充服务条款同意选项
4. THE Payment_QRCode 弹框 SHALL 在生成二维码时显示加载状态
5. THE Payment_QRCode 弹框 SHALL 在支付完成时显示成功动画
6. WHEN 用户在支付前关闭二维码弹框时, THE Pricing_Page SHALL 询问确认
