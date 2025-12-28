# Requirements Document

## Introduction

本规范定义了 LexSeek 项目 server/api 目录下所有 API 端点的集成测试需求。测试将发送真实的 HTTP 请求到运行中的服务器，按照用户实际使用场景的顺序组织测试用例，确保 API 在真实环境中的正确性。

## Glossary

- **API_Test_Client**: 用于发送 HTTP 请求的测试客户端，基于 $fetch 或原生 fetch 实现
- **Test_Server**: 运行中的 Nuxt 开发服务器或测试服务器实例
- **Test_User**: 用于测试的用户账户，包含手机号、密码等信息
- **Auth_Token**: 用户认证后获得的 JWT 令牌
- **Test_Database**: 测试环境使用的数据库实例

## Requirements

### Requirement 1: 测试基础设施

**User Story:** 作为开发者，我需要一套完整的 API 测试基础设施，以便能够发送真实的 HTTP 请求进行测试。

#### Acceptance Criteria

1. THE API_Test_Client SHALL 提供发送 GET、POST、PUT、DELETE 请求的能力
2. THE API_Test_Client SHALL 支持设置请求头（包括 Authorization）
3. THE API_Test_Client SHALL 支持发送 JSON 请求体
4. THE API_Test_Client SHALL 返回完整的响应信息（状态码、响应体、响应头）
5. WHEN 测试开始前 THEN Test_Server SHALL 确保服务器已启动并可访问
6. WHEN 测试结束后 THEN API_Test_Client SHALL 清理测试产生的数据

### Requirement 2: 认证流程测试

**User Story:** 作为用户，我需要能够注册、登录和登出系统，以便安全地使用应用功能。

#### Acceptance Criteria

1. WHEN 用户提交有效的注册信息 THEN THE Auth_API SHALL 创建新用户并返回成功响应
2. WHEN 用户提交已存在的手机号注册 THEN THE Auth_API SHALL 返回错误提示
3. WHEN 用户通过邀请链接注册 THEN THE Auth_API SHALL 正确记录推荐人信息
4. WHEN 用户使用正确的手机号和密码登录 THEN THE Auth_API SHALL 返回认证令牌
5. WHEN 用户使用错误的密码登录 THEN THE Auth_API SHALL 返回认证失败错误
6. WHEN 用户使用有效的验证码进行短信登录 THEN THE Auth_API SHALL 返回认证令牌
7. WHEN 用户使用无效的验证码登录 THEN THE Auth_API SHALL 返回验证码错误
8. WHEN 已登录用户请求登出 THEN THE Auth_API SHALL 使当前令牌失效
9. WHEN 用户请求重置密码 THEN THE Auth_API SHALL 验证验证码并更新密码
10. WHEN 用户重置密码成功后 THEN THE Auth_API SHALL 允许使用新密码正常登录

### Requirement 3: 短信验证码测试

**User Story:** 作为用户，我需要能够获取短信验证码，以便进行登录、注册等操作。

#### Acceptance Criteria

1. WHEN 用户请求发送验证码到有效手机号 THEN THE SMS_API SHALL 创建验证码记录并返回成功
2. WHEN 用户在短时间内重复请求验证码 THEN THE SMS_API SHALL 返回频率限制错误
3. WHEN 用户请求发送验证码到无效手机号格式 THEN THE SMS_API SHALL 返回参数验证错误

### Requirement 4: 用户信息测试

**User Story:** 作为已登录用户，我需要能够查看和修改我的个人信息。

#### Acceptance Criteria

1. WHEN 已认证用户请求获取个人信息 THEN THE Users_API SHALL 返回用户详细信息
2. WHEN 未认证用户请求获取个人信息 THEN THE Users_API SHALL 返回 401 未授权错误
3. WHEN 已认证用户更新个人资料 THEN THE Users_API SHALL 保存更新并返回成功
4. WHEN 已认证用户修改密码（提供正确的旧密码）THEN THE Users_API SHALL 更新密码并返回成功
5. WHEN 已认证用户修改密码（提供错误的旧密码）THEN THE Users_API SHALL 返回密码错误
6. WHEN 已认证用户请求获取角色信息 THEN THE Users_API SHALL 返回用户角色列表
7. WHEN 已认证用户请求获取路由权限 THEN THE Users_API SHALL 返回可访问的路由列表
8. WHEN 已认证用户请求获取邀请列表 THEN THE Users_API SHALL 返回被邀请用户列表

### Requirement 5: 会员系统测试

**User Story:** 作为用户，我需要能够查看会员等级、权益和升级选项。

#### Acceptance Criteria

1. WHEN 用户请求获取会员等级列表 THEN THE Membership_API SHALL 返回所有可用等级
2. WHEN 用户请求获取特定等级详情 THEN THE Membership_API SHALL 返回该等级的完整信息
3. WHEN 已认证用户请求获取当前会员信息 THEN THE Membership_API SHALL 返回用户会员状态
4. WHEN 已认证用户请求获取会员权益 THEN THE Membership_API SHALL 返回当前等级权益
5. WHEN 已认证用户请求获取会员历史 THEN THE Membership_API SHALL 返回会员变更记录
6. WHEN 已认证用户请求获取升级选项 THEN THE Membership_API SHALL 返回可升级的等级列表
7. WHEN 已认证用户请求计算升级费用 THEN THE Membership_API SHALL 返回升级所需金额
8. WHEN 已认证用户请求获取升级记录 THEN THE Membership_API SHALL 返回历史升级记录

### Requirement 6: 积分系统测试

**User Story:** 作为用户，我需要能够查看我的积分信息和使用记录。

#### Acceptance Criteria

1. WHEN 已认证用户请求获取积分信息 THEN THE Points_API SHALL 返回当前积分余额
2. WHEN 已认证用户请求获取积分记录 THEN THE Points_API SHALL 返回积分变动历史
3. WHEN 已认证用户请求获取积分使用情况 THEN THE Points_API SHALL 返回积分消费统计

### Requirement 7: 兑换码测试

**User Story:** 作为用户，我需要能够使用兑换码获取会员或积分奖励。

#### Acceptance Criteria

1. WHEN 用户查询有效兑换码信息 THEN THE Redemption_API SHALL 返回兑换码详情
2. WHEN 用户查询无效兑换码 THEN THE Redemption_API SHALL 返回错误信息
3. WHEN 已认证用户使用有效兑换码 THEN THE Redemption_API SHALL 发放奖励并返回成功
4. WHEN 已认证用户使用已使用的兑换码 THEN THE Redemption_API SHALL 返回已使用错误
5. WHEN 已认证用户查询已兑换列表 THEN THE Redemption_API SHALL 返回兑换历史

### Requirement 8: 营销活动测试

**User Story:** 作为用户，我需要能够查看当前的营销活动信息，并通过活动获得奖励。

#### Acceptance Criteria

1. WHEN 用户请求获取活动列表 THEN THE Campaign_API SHALL 返回进行中的活动
2. WHEN 用户请求获取特定活动详情 THEN THE Campaign_API SHALL 返回活动完整信息
3. WHEN 用户请求获取不存在的活动 THEN THE Campaign_API SHALL 返回 404 错误
4. WHEN 用户通过邀请链接注册成功 THEN THE Campaign_API SHALL 触发邀请奖励活动
5. WHEN 邀请奖励活动触发后 THEN THE Campaign_API SHALL 正确发放推荐人和被邀请人的奖励

### Requirement 9: 产品信息测试

**User Story:** 作为用户，我需要能够查看可购买的产品信息。

#### Acceptance Criteria

1. WHEN 用户请求获取产品列表 THEN THE Product_API SHALL 返回所有可用产品
2. WHEN 用户请求获取特定产品详情 THEN THE Product_API SHALL 返回产品完整信息
3. WHEN 用户请求获取不存在的产品 THEN THE Product_API SHALL 返回 404 错误

### Requirement 10: 支付系统测试

**User Story:** 作为用户，我需要能够创建支付订单并查询支付状态。

#### Acceptance Criteria

1. WHEN 已认证用户创建支付订单 THEN THE Payment_API SHALL 返回支付参数
2. WHEN 已认证用户查询订单状态 THEN THE Payment_API SHALL 返回当前支付状态
3. WHEN 支付回调到达 THEN THE Payment_API SHALL 更新订单状态

### Requirement 11: 文件存储测试

**User Story:** 作为用户，我需要能够上传和下载文件。

#### Acceptance Criteria

1. WHEN 已认证用户请求获取上传配置 THEN THE Storage_API SHALL 返回 OSS 配置信息
2. WHEN 已认证用户请求获取预签名上传 URL THEN THE Storage_API SHALL 返回有效的上传地址
3. WHEN 已认证用户请求获取文件列表 THEN THE Files_API SHALL 返回用户文件列表
4. WHEN 已认证用户请求获取下载 URL THEN THE Files_API SHALL 返回有效的下载地址
5. WHEN 已认证用户删除文件 THEN THE Files_API SHALL 删除文件并返回成功
6. WHEN OSS 回调到达 THEN THE Storage_API SHALL 处理回调并更新文件状态

### Requirement 12: 加密配置测试

**User Story:** 作为用户，我需要能够管理我的文件加密配置。

#### Acceptance Criteria

1. WHEN 已认证用户请求获取加密配置 THEN THE Encryption_API SHALL 返回当前配置
2. WHEN 已认证用户创建加密配置 THEN THE Encryption_API SHALL 保存配置并返回成功
3. WHEN 已认证用户更新加密配置 THEN THE Encryption_API SHALL 更新配置并返回成功
4. WHEN 已认证用户请求获取恢复密钥 THEN THE Encryption_API SHALL 返回加密的恢复密钥
5. WHEN 已认证用户使用恢复密钥恢复 THEN THE Encryption_API SHALL 验证并恢复访问

### Requirement 13: 健康检查测试

**User Story:** 作为运维人员，我需要能够检查服务健康状态。

#### Acceptance Criteria

1. WHEN 请求健康检查端点 THEN THE Health_API SHALL 返回服务状态信息
