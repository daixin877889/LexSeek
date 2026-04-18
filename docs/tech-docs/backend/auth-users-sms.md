# 认证 / 用户 / 短信服务

LexSeek 的认证体系基于 JWT + HttpOnly Cookie 实现，配合 Token 黑名单机制支持登出失效，用户管理采用 Service + DAO 分层架构，短信验证通过阿里云 SMS 集成并内置防暴力破解机制。

## 架构总览

```
server/
├── middleware/
│   └── 02.auth.ts                      # 认证中间件（Token 验证 + 黑名单检查）
├── services/
│   ├── auth/
│   │   └── authToken.service.ts        # Token 生成与 Cookie 管理
│   ├── users/
│   │   ├── users.service.ts            # 用户业务逻辑层
│   │   ├── users.dao.ts                # 用户数据访问层
│   │   ├── userResponse.service.ts     # 用户响应格式化
│   │   └── tokenBlacklist.dao.ts       # Token 黑名单数据访问
│   └── sms/
│       ├── smsVerification.service.ts  # 验证码验证服务
│       └── smsRecord.dao.ts            # 验证码数据访问
├── lib/
│   └── aliSms.ts                       # 阿里云 SMS SDK 封装
└── utils/
    └── JwtUtil.ts                      # JWT 工具（自动导入）
```

## 1. JWT 认证

### 1.1 Token 生成（authToken.service.ts）

**核心接口**：

```typescript
interface TokenUserInfo {
    id: number        // 用户 ID
    phone: string     // 手机号
    roles: number[]   // 角色 ID 数组
    status: number    // 用户状态
}
```

**生成流程**（`generateAuthTokenService`）：

1. 调用 `JwtUtil.generateToken()` 生成 JWT，载荷包含 `id`、`phone`、`roles`、`status`
2. 将 token 写入 HttpOnly Cookie（名称由 `config.auth.cookieName` 指定）
3. 同时设置一个非 HttpOnly 的 `auth_status` Cookie（值为 `'1'`），供客户端 JavaScript 判断登录状态

**Cookie 安全策略**（`getCookieConfigService`）：

| 属性 | 值 | 说明 |
|------|-----|------|
| `httpOnly` | `true` | 防止 XSS 攻击窃取 token |
| `secure` | 生产环境 `true` | 仅 HTTPS 传输 |
| `sameSite` | `'lax'` | 平衡安全性和可用性 |
| `maxAge` | `config.auth.cookieMaxAge` | 默认 30 天 |

**清除认证**（`clearAuthCookiesService`）：
- 同时删除 token cookie 和 status cookie
- 在登出、token 失效等场景调用

### 1.2 认证中间件（02.auth.ts）

中间件按编号排序执行（01.requestId → 02.auth → 03.permission），处理所有 `/api` 开头的请求。

**认证流程**：

```
请求进入
  │
  ├─ 非 /api 请求 → 放行
  │
  ├─ 公开 API（数据库配置） → 标记 isPublicApi 放行
  │
  ├─ 提取 Token
  │   ├─ 优先 Authorization: Bearer <token>
  │   └─ 其次 Cookie: auth_token=<token>
  │
  ├─ Token 不存在 → 清除 Cookie → 401
  │
  ├─ JwtUtil.verifyToken() 验证
  │   └─ 失败 → 清除 Cookie → 401
  │
  ├─ 检查 Token 黑名单
  │   └─ 在黑名单中 → 清除 Cookie → 401（token 已失效）
  │
  ├─ 查询用户是否存在/被禁用
  │   ├─ 用户不存在 → 401
  │   └─ 用户被禁用 → 401
  │
  └─ 设置 event.context.auth
      ├─ user: JwtPayload（含最新 roles）
      ├─ type: 'cookie' | 'token'
      └─ token: string
```

**公开 API 判断**：
- 通过 `getPublicApiPermissions()` 从数据库获取公开路径列表（内置缓存）
- 支持精确匹配和前缀匹配（路径以 `/` 结尾时启用前缀匹配）
- 方法匹配支持 `*` 通配符

**用户上下文访问**：

```typescript
// API 处理器中获取当前用户
const user = event.context.auth?.user
if (!user) return resError(event, 401, '请先登录')

// 获取用户 ID
const userId = user.id

// 获取用户角色
const roles = user.roles
```

注意：使用 `event.context.auth?.user`，不是 `event.context.user`（后者始终为 undefined）。

### 1.3 Token 黑名单（tokenBlacklist.dao.ts）

用于实现登出失效机制。当用户登出时，将当前 token 加入黑名单，使其在过期前也无法继续使用。

**数据操作**：

| 函数 | 说明 |
|------|------|
| `addTokenBlacklistDao` | 添加 token 到黑名单，记录 userId 和 expiredAt |
| `findTokenBlacklistByTokenDao` | 检查 token 是否在黑名单中 |
| `deleteTokenBlacklistByTokenDao` | 软删除黑名单记录 |
| `deleteExpiredTokenBlacklistDao` | 物理删除已过期的黑名单记录（定时清理） |

**存储模型**：

```
tokenBlacklist 表:
├── token       # JWT token 字符串
├── userId      # 用户 ID
├── expiredAt   # token 原始过期时间
├── createdAt   # 加入黑名单时间
├── updatedAt   # 更新时间
└── deletedAt   # 软删除标记
```

**设计要点**：
- 黑名单记录保留到 token 自然过期后再清理
- 使用 `deletedAt` 实现软删除，保留审计日志
- 所有 DAO 方法支持事务参数 `tx`

## 2. 用户管理

### 2.1 用户服务层（users.service.ts）

**核心功能**：

`createUserService` - 创建用户（带角色分配）：

```typescript
const user = await createUserService(userData, {
    roleIds: [1, 2],       // 可选：角色 ID 数组
    tx: transaction,       // 可选：外部事务实例
})
```

执行流程：
1. 验证角色是否存在（调用 `findRoleByIdsDao`）
2. 创建用户记录（调用 `createUserDao`）
3. 创建用户-角色关联（调用 `createUserRoleDao`）
4. 整个操作在事务中执行，保证一致性

### 2.2 用户数据访问层（users.dao.ts）

| 函数 | 说明 |
|------|------|
| `createUserDao` | 创建用户，自动 include userRoles |
| `findUserByIdDao` | 按 ID 查询，include userRoles + role 详情 |
| `findUserByPhoneDao` | 按手机号查询 |
| `findUserByInviteCodeDao` | 按邀请码查询 |
| `findUserByUsernameDao` | 按用户名查询 |
| `updateUserPasswordDao` | 更新密码 |
| `updateUserProfileDao` | 更新用户资料 |

**通用约定**：
- 所有查询自动过滤 `deletedAt: null`（软删除）
- 查询用户时自动 include `userRoles` 关联，关联查询 `role` 详情
- 所有方法支持可选事务参数 `tx`
- 异常通过 `logger.error` 记录后重新抛出

### 2.3 用户响应格式化（userResponse.service.ts）

`formatUserResponseService` 将数据库用户对象转换为安全的客户端响应格式，排除敏感字段：

```typescript
interface SafeUserInfo {
    id: number
    name: string | null
    username: string | null
    phone: string
    email: string | null
    roles: number[]        // 从 userRoles 关联中提取 roleId 数组
    status: number
    company: string | null
    profile: string | null
    inviteCode: string | null
}
```

**排除的字段**：`password`、`deletedAt`、`createdAt`、`updatedAt` 等敏感或内部字段。

## 3. 短信验证

### 3.1 验证码验证服务（smsVerification.service.ts）

提供完整的验证码生命周期管理，包含防暴力破解机制。

**核心验证流程**（`verifySmsCodeService`）：

```
输入：phone, code, type（登录/注册/重置密码）
  │
  ├─ 1. 检查是否被锁定
  │   └─ 已锁定 → 返回 { success: false, error: '验证码已锁定' }
  │
  ├─ 2. 查询验证码记录
  │   └─ 不存在 → 返回 { success: false, error: '验证码不存在' }
  │
  ├─ 3. 检查是否过期
  │   └─ 已过期 → 删除记录 → 返回 { success: false, error: '验证码已过期' }
  │
  ├─ 4. 时间安全比较验证码
  │   └─ 不匹配 → 记录失败 → 返回 { success: false, error: '验证码不正确' }
  │
  └─ 5. 验证成功
      ├─ 删除验证码记录
      ├─ 重置失败计数
      └─ 返回 { success: true, record: smsRecord }
```

**防暴力破解机制**：

| 功能 | 函数 | 说明 |
|------|------|------|
| 锁定检查 | `isVerificationLockedService` | 检查手机号+类型是否被锁定 |
| 记录失败 | `recordVerificationFailureService` | 累计失败次数，达到阈值自动锁定 |
| 重置计数 | `resetVerificationFailuresService` | 验证成功后清除失败记录 |

配置参数（来自 `runtimeConfig`）：
- `maxFailures`：最大失败次数
- `lockDurationMs`：锁定时长（秒，内部转换为毫秒）

失败记录使用内存 Map 存储，key 格式为 `${phone}:${type}`。

**时间安全比较**（`timingSafeEqual`）：

为防止时序攻击，验证码比较使用固定时间比较算法：
- 无论匹配在哪个位置失败，比较时间保持一致
- 使用位运算（XOR）逐字符比较
- 长度不同时仍进行完整比较

### 3.2 验证码数据访问（smsRecord.dao.ts）

| 函数 | 说明 |
|------|------|
| `createSmsRecordDao` | 创建验证码记录，设置过期时间 |
| `findSmsRecordByPhoneAndTypeDao` | 按手机号+类型查询最新验证码 |
| `deleteSmsRecordByIdDao` | 删除验证码记录（验证成功后调用） |

**验证码记录结构**：

```
smsRecords 表:
├── id         # 记录 ID
├── phone      # 手机号
├── type       # 类型（SmsType 枚举）
├── code       # 验证码
├── expiredAt  # 过期时间
├── createdAt  # 创建时间
├── updatedAt  # 更新时间
└── deletedAt  # 软删除标记
```

### 3.3 阿里云 SMS 集成（server/lib/aliSms.ts）

`aliSms.ts` 封装了阿里云短信 SDK（`@alicloud/dysmsapi20170525`），提供验证码发送能力。

**初始化**：
- 使用懒加载单例模式，首次调用时创建 SMS Client
- 从 `runtimeConfig` 读取 `accessKeyId` 和 `accessKeySecret`
- 端点固定为 `dysmsapi.aliyuncs.com`

**发送接口**：

```typescript
const result = await sendCaptchaSms(phone, code)
// phone: 手机号
// code: 验证码内容
// 使用配置的 signName 和 templateCaptchaCode
```

**配置项**（来自 `runtimeConfig.aliyun`）：

| 配置 | 说明 |
|------|------|
| `accessKeyId` | 阿里云 AccessKey ID |
| `accessKeySecret` | 阿里云 AccessKey Secret |
| `sms.signName` | 短信签名（默认 '阿里云短信测试'） |
| `sms.templateCaptchaCode` | 验证码短信模板代码 |
| `sms.maxFailures` | 验证码最大失败次数 |
| `sms.lockDurationMs` | 验证码锁定时长 |

### 3.4 阿里云验证码 2.0（一期）

认证相关公开页面新增了阿里云验证码 2.0 接入，用来保护短信发送链路，并在密码登录失败达到阈值后触发补验。

**服务端封装**：
- `server/services/security/aliyunCaptcha.service.ts`
- `server/services/security/loginRisk.service.ts`
- `server/routes/auth-captcha-config.get.ts`

**控制台场景约定**：

| 场景 key | 用途 |
|------|------|
| `loginSms` | 短信登录发送验证码 |
| `registerSms` | 注册页/注册弹窗发送验证码 |
| `resetPasswordSms` | 找回密码发送验证码 |
| `passwordLogin` | 密码登录失败阈值后的补验 |

**运行时配置**（`runtimeConfig.aliyun.captcha`）：

| 配置 | 说明 |
|------|------|
| `enable` | 是否启用验证码能力 |
| `region` | `cn` 或 `sgp`，必须与服务端 endpoint 对齐 |
| `prefix` | 控制台实例身份标 |
| `dualStack` | 是否走双栈 endpoint |
| `scriptSrc` | 前端动态加载的验证码脚本地址 |
| `sceneIds.*` | 各业务场景对应的 SceneId |
| `loginRisk.enable` | 是否启用密码登录失败阈值风控 |
| `loginRisk.threshold` | 连续失败达到该次数后，登录接口返回 `429` 要求补验 |
| `loginRisk.windowSec` | 风控窗口 TTL，单位秒 |

常用环境变量示例：
- `NUXT_ALIYUN_CAPTCHA_ENABLE`
- `NUXT_ALIYUN_CAPTCHA_REGION`
- `NUXT_ALIYUN_CAPTCHA_PREFIX`
- `NUXT_ALIYUN_CAPTCHA_DUAL_STACK`
- `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_REGISTER_SMS`
- `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_RESET_PASSWORD_SMS`
- `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_PASSWORD_LOGIN`
- `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_ENABLE`
- `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_THRESHOLD`
- `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_WINDOW_SEC`

**前端接入点**：
- `app/pages/register.vue`：发送注册验证码前先完成 captcha
- `app/pages/reset-password.vue`：发送重置验证码前先完成 captcha
- `app/components/auth/AuthModal.vue`：注册 tab 发送验证码前先完成 captcha
- `app/pages/login.vue` / `app/components/auth/AuthModal.vue`：密码登录首次直接提交；若服务端返回 `429`，前端自动拉起 `passwordLogin` 场景并仅重试一次

**请求契约**：
- `POST /api/v1/sms/send`：当当前场景启用了 captcha 时，请求体必须包含 `captchaVerifyParam`
- `POST /api/v1/auth/login/password`：请求体支持可选的 `captchaVerifyParam`；达到阈值但未补验时返回 `429 / 请完成安全验证后重试`
- `CaptchaVerifyParam` 必须原样透传给阿里云服务端验签，不能裁剪或重组

**测试与本地开发**：
- 默认建议 `NUXT_ALIYUN_CAPTCHA_ENABLE=false`
- 默认建议 `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_ENABLE=false`
- 这样现有 API 集成测试无需真实 captcha 即可继续运行
- 如果需要联调真实验证码，除了开启以上配置，还必须配置 `aliyun.accessKeyId/accessKeySecret`

## 4. 自动导入

以下函数通过 Nuxt 自动导入机制注册，在 API 处理器和其他服务中无需手动 import：

**认证服务**：
- `generateAuthTokenService` / `clearAuthCookiesService` / `getCookieConfigService`

**用户服务**：
- `createUserService` / `formatUserResponseService`

**用户 DAO**：
- `createUserDao` / `findUserByIdDao` / `findUserByPhoneDao`
- `findUserByInviteCodeDao` / `findUserByUsernameDao`
- `updateUserPasswordDao` / `updateUserProfileDao`

**Token 黑名单 DAO**：
- `addTokenBlacklistDao` / `findTokenBlacklistByTokenDao`
- `deleteTokenBlacklistByTokenDao` / `deleteExpiredTokenBlacklistDao`

**SMS 服务**：
- `verifySmsCodeService` / `isVerificationLockedService`
- `recordVerificationFailureService` / `resetVerificationFailuresService`

**SMS DAO**：
- `createSmsRecordDao` / `findSmsRecordByPhoneAndTypeDao` / `deleteSmsRecordByIdDao`

## 5. 安全设计要点

1. **双 Cookie 策略**：HttpOnly cookie 存储 token（服务端验证），非 HttpOnly cookie 存储登录状态标记（客户端 UI 判断）
2. **Token 黑名单**：登出后 token 立即失效，无需等待 JWT 自然过期
3. **时间安全比较**：验证码比较防止时序攻击
4. **失败锁定**：验证码验证达到阈值后自动锁定，防暴力破解
5. **最小暴露**：用户响应格式化排除所有敏感字段
6. **事务一致性**：用户创建与角色分配在同一事务中完成
