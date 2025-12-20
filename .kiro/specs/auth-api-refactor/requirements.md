# Requirements Document

## Introduction

本规范文档定义了对 `server/api/v1/auth` 目录下认证相关 API 的重构优化需求。主要目标是消除代码重复、提升安全性、增强可维护性。当前代码存在验证码验证逻辑重复、JWT/Cookie 处理重复、缺少安全防护等问题。

## Glossary

- **Auth_System**: 认证系统，负责用户注册、登录、密码重置等功能
- **SMS_Verification_Service**: 短信验证码服务，负责验证码的验证、过期检查、错误计数等
- **JWT_Auth_Service**: JWT 认证服务，负责 token 生成和 cookie 设置
- **User_Response_Formatter**: 用户响应格式化器，负责统一用户信息的返回格式
- **Verification_Code**: 6位数字验证码，用于身份验证
- **Rate_Limiting**: 频率限制，防止暴力破解攻击

## Requirements

### Requirement 1

**User Story:** As a 开发者, I want 将验证码验证逻辑抽取为独立服务, so that 消除代码重复并统一验证行为。

#### Acceptance Criteria

1. WHEN 调用验证码验证服务时 THEN Auth_System SHALL 执行验证码存在性检查、过期检查、正确性检查的完整流程
2. WHEN 验证码不存在时 THEN SMS_Verification_Service SHALL 返回明确的错误信息"验证码不存在,请先获取验证码"
3. WHEN 验证码已过期时 THEN SMS_Verification_Service SHALL 删除该验证码记录并返回"验证码已过期"错误
4. WHEN 验证码不正确时 THEN SMS_Verification_Service SHALL 返回"验证码不正确"错误
5. WHEN 验证码验证成功时 THEN SMS_Verification_Service SHALL 删除该验证码记录并返回成功状态

### Requirement 2

**User Story:** As a 开发者, I want 将 JWT token 生成和 Cookie 设置抽取为独立服务, so that 统一认证令牌的处理逻辑。

#### Acceptance Criteria

1. WHEN 用户认证成功时 THEN JWT_Auth_Service SHALL 生成包含用户 id、phone、role、status 的 JWT token
2. WHEN 生成 token 后 THEN JWT_Auth_Service SHALL 设置 HttpOnly Cookie，包含 secure、sameSite、maxAge 配置
3. WHEN 在生产环境时 THEN JWT_Auth_Service SHALL 将 Cookie 的 secure 属性设置为 true
4. WHEN 设置 Cookie 时 THEN JWT_Auth_Service SHALL 使用 30 天的过期时间

### Requirement 3

**User Story:** As a 开发者, I want 统一用户信息的返回格式, so that 保持 API 响应的一致性。

#### Acceptance Criteria

1. WHEN 返回用户信息时 THEN User_Response_Formatter SHALL 包含 id、name、username、phone、email、role、status、company、profile、inviteCode 字段
2. WHEN 格式化用户信息时 THEN User_Response_Formatter SHALL 排除敏感字段如 password、deletedAt

### Requirement 4

**User Story:** As a 安全工程师, I want 增加验证码错误次数限制, so that 防止暴力破解攻击。

#### Acceptance Criteria

1. WHEN 验证码验证失败时 THEN SMS_Verification_Service SHALL 记录该手机号的失败次数
2. WHEN 同一手机号验证失败次数达到 5 次时 THEN SMS_Verification_Service SHALL 锁定该验证码 15 分钟
3. WHEN 验证码被锁定时 THEN SMS_Verification_Service SHALL 返回"验证码已锁定，请稍后再试"错误
4. WHEN 验证码验证成功时 THEN SMS_Verification_Service SHALL 重置该手机号的失败次数

### Requirement 5

**User Story:** As a 开发者, I want 清理未使用的代码, so that 保持代码整洁。

#### Acceptance Criteria

1. WHEN 重构 register.post.ts 时 THEN Auth_System SHALL 移除未使用的 CODE_EXPIRE_MS 变量
2. WHEN 重构完成后 THEN Auth_System SHALL 确保所有声明的变量都被使用

### Requirement 6

**User Story:** As a 安全工程师, I want 使用时间安全的字符串比较, so that 防止时序攻击。

#### Acceptance Criteria

1. WHEN 比较验证码时 THEN SMS_Verification_Service SHALL 使用时间安全的比较方法而非简单的 === 比较
2. WHEN 比较操作完成时 THEN SMS_Verification_Service SHALL 确保比较时间不随字符匹配程度变化

### Requirement 7

**User Story:** As a 开发者, I want 重构代码遵循现有编码风格, so that 保持代码库的一致性和可读性。

#### Acceptance Criteria

1. WHEN 创建新的服务文件时 THEN Auth_System SHALL 遵循现有项目的目录结构和命名规范
2. WHEN 编写函数时 THEN Auth_System SHALL 使用与现有代码一致的函数命名风格（如 camelCase）
3. WHEN 导入模块时 THEN Auth_System SHALL 遵循现有的导入顺序和格式
4. WHEN 处理错误时 THEN Auth_System SHALL 使用现有的 resError 和 resSuccess 响应格式

### Requirement 8

**User Story:** As a 开发者, I want 修改的代码包含简洁易懂的注释, so that 提高代码可维护性和团队协作效率。

#### Acceptance Criteria

1. WHEN 创建新的服务函数时 THEN Auth_System SHALL 添加 JSDoc 风格的函数注释，包含功能描述、参数说明、返回值说明
2. WHEN 实现复杂逻辑时 THEN Auth_System SHALL 添加行内注释解释关键步骤
3. WHEN 定义常量或配置时 THEN Auth_System SHALL 添加注释说明其用途和取值范围
4. WHEN 处理边界情况时 THEN Auth_System SHALL 添加注释说明为何需要该处理
