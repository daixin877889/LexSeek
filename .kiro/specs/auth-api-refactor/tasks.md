# Implementation Plan

- [x] 1. 更新配置文件
  - [x] 1.1 更新 nuxt.config.ts 添加验证码和 Cookie 配置
    - 在 runtimeConfig.aliyun.sms 中添加 maxFailures 和 lockDurationMs
    - 在 runtimeConfig 中添加 auth.cookieName 和 auth.cookieMaxAge
    - _Requirements: 4.2, 2.4_
  - [x] 1.2 更新 .env 文件添加对应环境变量
    - 添加 NUXT_ALIYUN_SMS_MAX_FAILURES 和 NUXT_ALIYUN_SMS_LOCK_DURATION_MS
    - 添加 NUXT_AUTH_COOKIE_NAME 和 NUXT_AUTH_COOKIE_MAX_AGE
    - _Requirements: 4.2, 2.4_

- [ ] 2. 创建 SMS Verification Service
  - [x] 2.1 创建 server/services/sms/smsVerification.service.ts
    - 实现 timingSafeEqual 时间安全字符串比较函数
    - 实现 isVerificationLocked 检查锁定状态函数
    - 实现 recordVerificationFailure 记录失败函数
    - 实现 resetVerificationFailures 重置失败计数函数
    - 实现 verifySmsCode 主验证函数
    - 添加 JSDoc 注释和行内注释
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4, 6.1, 7.1, 7.2, 8.1, 8.2_
  - [ ]* 2.2 编写属性测试：验证码验证流程完整性
    - **Property 1: 验证码验证流程完整性**
    - **Validates: Requirements 1.1, 1.5**
  - [ ]* 2.3 编写属性测试：时间安全字符串比较正确性
    - **Property 5: 时间安全字符串比较正确性**
    - **Validates: Requirements 6.1**
  - [ ]* 2.4 编写单元测试：SMS Verification Service
    - 测试验证码不存在场景
    - 测试验证码过期场景
    - 测试验证码锁定场景
    - _Requirements: 1.2, 1.3, 4.3_

- [x] 3. 创建 Auth Token Service
  - [x] 3.1 创建 server/services/auth/authToken.service.ts
    - 实现 getCookieConfig 获取 Cookie 配置函数
    - 实现 generateAuthToken 生成 token 并设置 cookie 函数
    - 添加 JSDoc 注释
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.1, 7.2, 8.1_
  - [ ]* 3.2 编写属性测试：JWT Token 字段完整性
    - **Property 2: JWT Token 字段完整性**
    - **Validates: Requirements 2.1**
  - [ ]* 3.3 编写单元测试：Auth Token Service
    - 测试生产环境 Cookie secure 属性
    - 测试 Cookie maxAge 配置
    - _Requirements: 2.3, 2.4_

- [x] 4. 创建 User Response Service
  - [x] 4.1 创建 server/services/users/userResponse.service.ts
    - 定义 SafeUserInfo 接口
    - 实现 formatUserResponse 格式化用户信息函数
    - 添加 JSDoc 注释
    - _Requirements: 3.1, 3.2, 7.1, 7.2, 8.1_
  - [ ]* 4.2 编写属性测试：用户信息格式化安全性
    - **Property 3: 用户信息格式化安全性**
    - **Validates: Requirements 3.1, 3.2**

- [x] 5. Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. 重构 Auth API 使用新服务
  - [x] 6.1 重构 register.post.ts
    - 使用 verifySmsCode 替换验证码验证逻辑
    - 使用 generateAuthToken 替换 token 生成和 cookie 设置
    - 使用 formatUserResponse 格式化用户信息
    - 移除未使用的 CODE_EXPIRE_MS 变量
    - 添加必要的注释
    - _Requirements: 1.1, 2.1, 3.1, 5.1, 7.4, 8.2_
  - [x] 6.2 重构 login/sms.post.ts
    - 使用 verifySmsCode 替换验证码验证逻辑
    - 使用 generateAuthToken 替换 token 生成和 cookie 设置
    - 使用 formatUserResponse 格式化用户信息
    - 添加必要的注释
    - _Requirements: 1.1, 2.1, 3.1, 7.4, 8.2_
  - [x] 6.3 重构 login/password.post.ts
    - 使用 generateAuthToken 替换 token 生成和 cookie 设置
    - 使用 formatUserResponse 格式化用户信息
    - 添加必要的注释
    - _Requirements: 2.1, 3.1, 7.4, 8.2_
  - [x] 6.4 重构 reset-password.ts
    - 使用 verifySmsCode 替换验证码验证逻辑
    - 添加必要的注释
    - _Requirements: 1.1, 7.4, 8.2_

- [x] 7. Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 8. 编写属性测试：验证失败计数管理
  - **Property 4: 验证失败计数管理**
  - **Validates: Requirements 4.1, 4.4**

- [x] 9. Final Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.
