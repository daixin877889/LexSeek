# Requirements Document

## Introduction

本功能为 LexSeek 系统添加微信 JSAPI 支付支持。当用户在微信浏览器内访问系统时，使用 JSAPI 支付方式替代扫码支付，提供更流畅的支付体验。用户无需扫码，直接在微信内唤起支付界面完成支付。

现有系统已支持微信扫码支付（Native 支付），本次需求是在此基础上增加 JSAPI 支付方式，不改动现有的扫码支付逻辑。

参考旧项目实现：
- `LexSeek/lexseek_web/public/auth_jump.html` - 授权跳转中间页
- `LexSeek/lexseekApi/src/services/wechat/wechat.service.ts` - 获取 OpenID 服务
- `LexSeek/lexseekApi/src/services/payment/wechatPay.service.ts` - JSAPI 支付服务

## Glossary

- **JSAPI_Payment**: 微信 JSAPI 支付，适用于微信浏览器内的网页支付，通过 WeixinJSBridge 唤起支付界面
- **Native_Payment**: 微信扫码支付，生成二维码供用户扫描支付
- **WeChat_Browser**: 微信内置浏览器，通过 User-Agent 中的 MicroMessenger 标识识别
- **OpenID**: 微信用户在公众号下的唯一标识，JSAPI 支付必需参数
- **OAuth_Authorization**: 微信网页授权，用于获取用户 OpenID，使用 snsapi_base 静默授权
- **Auth_Jump_Page**: 授权跳转中间页，用于统一处理微信授权回调并携带 code 跳转到目标页面
- **Payment_Adapter**: 支付适配器，封装不同支付渠道的统一接口
- **Payment_Service**: 支付服务层，处理支付业务逻辑
- **Payment_API**: 支付接口层，处理 HTTP 请求和响应
- **WeixinJSBridge**: 微信内置浏览器提供的 JavaScript 桥接对象，用于调用微信原生功能

## Requirements

### Requirement 1: 微信浏览器环境检测

**User Story:** As a 用户, I want 系统自动检测我是否在微信浏览器中访问, so that 系统能为我选择最合适的支付方式。

#### Acceptance Criteria

1. WHEN 用户访问支付页面, THE WeChat_Browser_Detector SHALL 检测当前浏览器环境
2. WHEN 检测到 User-Agent 包含 MicroMessenger 字符串, THE WeChat_Browser_Detector SHALL 返回 true 表示在微信浏览器中
3. WHEN 检测到 User-Agent 不包含 MicroMessenger 字符串, THE WeChat_Browser_Detector SHALL 返回 false 表示不在微信浏览器中
4. WHEN 在服务端渲染环境中执行检测, THE WeChat_Browser_Detector SHALL 返回 false

### Requirement 2: 微信 OAuth 授权获取 OpenID

**User Story:** As a 用户, I want 在微信浏览器中自动完成授权获取 OpenID, so that 我可以使用 JSAPI 支付。

#### Acceptance Criteria

1. WHEN 用户在微信浏览器中需要支付且未获取 OpenID, THE OAuth_Service SHALL 构建微信授权 URL 并重定向
2. WHEN 构建授权 URL, THE OAuth_Service SHALL 使用 snsapi_base 静默授权方式
3. WHEN 构建授权 URL, THE OAuth_Service SHALL 将目标页面 URL 编码后放入 state 参数
4. WHEN 微信授权完成后, THE Auth_Jump_Page SHALL 解析 code 和 state 参数
5. WHEN Auth_Jump_Page 解析成功, THE Auth_Jump_Page SHALL 携带 code 参数重定向到目标页面
6. WHEN 目标页面收到 code 参数, THE OAuth_API SHALL 使用 code 换取 OpenID
7. WHEN 成功获取 OpenID, THE Payment_Page SHALL 将 OpenID 存储在 sessionStorage 中
8. IF 授权码无效或过期, THEN THE OAuth_API SHALL 返回错误信息并提示用户重新授权

### Requirement 3: JSAPI 支付创建

**User Story:** As a 用户, I want 在微信浏览器中直接唤起微信支付, so that 我无需扫码即可完成支付。

#### Acceptance Criteria

1. WHEN 用户在微信浏览器中发起支付请求, THE Payment_API SHALL 接受 JSAPI 支付方式（PaymentMethod.MINI_PROGRAM）
2. WHEN 创建 JSAPI 支付, THE Payment_Service SHALL 调用微信支付 JSAPI 接口获取预支付参数
3. WHEN 预支付参数获取成功, THE Payment_API SHALL 返回包含 appId、timeStamp、nonceStr、package、signType、paySign 的支付参数
4. IF 缺少 OpenID 参数, THEN THE Payment_API SHALL 返回 400 错误提示需要 OpenID
5. WHEN 支付创建成功, THE Payment_Service SHALL 记录支付方式为 mini_program

### Requirement 4: 前端支付方式自动选择

**User Story:** As a 用户, I want 系统根据我的浏览器环境自动选择支付方式, so that 我无需手动选择即可获得最佳支付体验。

#### Acceptance Criteria

1. WHEN 用户在微信浏览器中点击支付, THE Payment_Component SHALL 自动选择 JSAPI 支付方式
2. WHEN 用户在非微信浏览器中点击支付, THE Payment_Component SHALL 自动选择扫码支付方式
3. WHEN 使用 JSAPI 支付方式且有 OpenID, THE Payment_Component SHALL 调用 WeixinJSBridge 唤起支付界面
4. WHEN 使用 JSAPI 支付方式但无 OpenID, THE Payment_Component SHALL 先触发 OAuth 授权流程
5. WHEN 使用扫码支付方式, THE Payment_Component SHALL 显示支付二维码弹窗

### Requirement 5: WeixinJSBridge 支付调用

**User Story:** As a 开发者, I want 系统正确调用 WeixinJSBridge 唤起支付, so that 用户可以在微信浏览器中完成支付。

#### Acceptance Criteria

1. WHEN 调用 JSAPI 支付, THE Payment_Component SHALL 使用 WeixinJSBridge.invoke 方法调用 getBrandWCPayRequest
2. WHEN WeixinJSBridge 未就绪, THE Payment_Component SHALL 监听 WeixinJSBridgeReady 事件后再调用
3. WHEN 调用 getBrandWCPayRequest, THE Payment_Component SHALL 传入正确的支付参数对象
4. IF WeixinJSBridge 调用失败, THEN THE Payment_Component SHALL 显示错误提示

### Requirement 6: 支付结果处理

**User Story:** As a 用户, I want 支付完成后看到明确的结果反馈, so that 我知道支付是否成功。

#### Acceptance Criteria

1. WHEN WeixinJSBridge 返回 get_brand_wcpay_request:ok, THE Payment_Component SHALL 显示支付成功状态
2. WHEN WeixinJSBridge 返回 get_brand_wcpay_request:cancel, THE Payment_Component SHALL 保持在支付页面允许重新支付
3. WHEN WeixinJSBridge 返回 get_brand_wcpay_request:fail, THE Payment_Component SHALL 显示支付失败提示
4. WHEN 支付成功, THE Payment_Component SHALL 主动查询后端确认支付状态
5. WHEN 后端确认支付成功, THE Payment_Component SHALL 执行支付成功后的业务逻辑

### Requirement 7: 兼容性保持

**User Story:** As a 开发者, I want 新增的 JSAPI 支付不影响现有的扫码支付功能, so that 系统保持稳定。

#### Acceptance Criteria

1. WHEN 在非微信浏览器中支付, THE Payment_Service SHALL 继续使用现有的扫码支付逻辑
2. WHEN 处理支付回调, THE Callback_Handler SHALL 同时支持 JSAPI 和 Native 支付的回调（回调处理逻辑相同）
3. WHEN 查询支付状态, THE Query_Service SHALL 同时支持 JSAPI 和 Native 支付单
4. THE Payment_Adapter SHALL 保持现有接口不变，现有 JSAPI 实现已支持公众号支付
