# 配置与环境变量

LexSeek 使用 Nuxt 4 的 `runtimeConfig` 机制管理配置，通过 `NUXT_` 前缀的环境变量自动映射到运行时配置对象，支持 `.env` 和 `.env.testing` 双环境。

---

## 1. runtimeConfig 结构

配置定义在 `nuxt.config.ts` 的 `runtimeConfig` 字段，分为 `public`（前后端共享）和顶层（仅服务端）两部分。

### 1.1 public（前后端共享）

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `logLevel` | `NUXT_PUBLIC_LOG_LEVEL` | `'DEBUG'` | 日志级别：DEBUG / INFO / WARN / ERROR / SILENT |
| `baseUrl` | `NUXT_PUBLIC_BASE_URL` | `''` | 应用基础 URL，用于支付回调等 |
| `wechatAppId` | `NUXT_PUBLIC_WECHAT_APP_ID` | `''` | 微信公众号 AppID |
| `wechatAuthCallbackUrl` | `NUXT_PUBLIC_WECHAT_AUTH_CALLBACK_URL` | `''` | 微信授权回调地址 |

### 1.2 服务端私有配置

#### JWT 认证

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `jwt.secret` | `NUXT_JWT_SECRET` | `'lexseek_jwt_secret'` | JWT 签名密钥（生产环境必须修改） |
| `jwt.expiresIn` | `NUXT_JWT_EXPIRES_IN` | `'30d'` | Token 过期时间 |
| `auth.cookieName` | `NUXT_AUTH_COOKIE_NAME` | `'auth_token'` | 认证 Cookie 名称 |
| `auth.cookieMaxAge` | `NUXT_AUTH_COOKIE_MAX_AGE` | `2592000` | Cookie 过期时间（秒），默认 30 天 |

#### Redis

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `redis.url` | `NUXT_REDIS_URL` | `''` | Redis 连接 URL，未配置则不启动 Agent Worker 和定时任务 |

#### Agent 后台任务队列

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `agent.maxConcurrent` | `NUXT_AGENT_MAX_CONCURRENT` | `3` | 单实例最大并发 Agent 数 |
| `agent.maxUserConcurrent` | `NUXT_AGENT_MAX_USER_CONCURRENT` | `2` | 单用户最大并发 |
| `agent.timeoutMs` | `NUXT_AGENT_TIMEOUT_MS` | `3600000` | 执行超时（1 小时） |
| `agent.heartbeatIntervalMs` | `NUXT_AGENT_HEARTBEAT_INTERVAL_MS` | `15000` | 心跳间隔 |
| `agent.crashThresholdMs` | `NUXT_AGENT_CRASH_THRESHOLD_MS` | `60000` | 心跳超时判定崩溃 |
| `agent.databaseUrl` | `NUXT_AGENT_DATABASE_URL` | `''` | Agent 专用数据库连接，默认回退到 `DATABASE_URL` |
| `agent.pendingQueueMax` | `NUXT_AGENT_PENDING_QUEUE_MAX` | `500000` | 最大队列长度 |
| `agent.pendingQueueTtlMs` | `NUXT_AGENT_PENDING_QUEUE_TTL_MS` | `600000` | 队列超时（10 分钟） |

#### Embedding 嵌入模型

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `embedding.apiKey` | `NUXT_EMBEDDING_API_KEY` | `''` | 嵌入模型 API 密钥 |
| `embedding.baseUrl` | `NUXT_EMBEDDING_BASE_URL` | `''` | 嵌入模型基础 URL |
| `embedding.model` | `NUXT_EMBEDDING_MODEL` | `'text-embedding-v3'` | 嵌入模型名称 |
| `embedding.dimensions` | `NUXT_EMBEDDING_DIMENSIONS` | `1536` | 向量维度 |
| `embedding.batchSize` | `NUXT_EMBEDDING_BATCH_SIZE` | `5` | 批处理大小 |

#### 存储配置

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `storage.defaultType` | `NUXT_STORAGE_DEFAULT_TYPE` | `'aliyun_oss'` | 默认存储类型 |
| `storage.callbackUrl` | `NUXT_STORAGE_CALLBACK_URL` | `''` | OSS 回调 URL |
| `storage.basePath` | `NUXT_STORAGE_BASE_PATH` | `''` | 文件存储基础路径 |
| `storage.aliyunOss.accessKeyId` | `NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID` | `''` | 阿里云 OSS AK |
| `storage.aliyunOss.accessKeySecret` | `NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET` | `''` | 阿里云 OSS SK |
| `storage.aliyunOss.bucket` | `NUXT_STORAGE_ALIYUN_OSS_BUCKET` | `''` | Bucket 名称 |
| `storage.aliyunOss.region` | `NUXT_STORAGE_ALIYUN_OSS_REGION` | `''` | OSS 区域 |
| `storage.aliyunOss.customDomain` | `NUXT_STORAGE_ALIYUN_OSS_CUSTOM_DOMAIN` | `''` | CDN 自定义域名 |
| `storage.aliyunOss.sts.roleArn` | `NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_ARN` | `''` | STS 角色 ARN |
| `storage.aliyunOss.sts.roleSessionName` | `NUXT_STORAGE_ALIYUN_OSS_STS_ROLE_SESSION_NAME` | `'lexseek-oss-session'` | STS 会话名 |
| `storage.aliyunOss.sts.durationSeconds` | `NUXT_STORAGE_ALIYUN_OSS_STS_DURATION_SECONDS` | `3600` | STS 凭证有效期 |

此外还预留了 `storage.qiniu` 和 `storage.tencentCos` 配置段，结构类似，当前未启用。

#### 微信支付

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `wechatPay.mchId` | `NUXT_WECHAT_PAY_MCH_ID` | `''` | 微信支付商户号 |
| `wechatPay.apiV3Key` | `NUXT_WECHAT_PAY_API_V3_KEY` | `''` | API v3 密钥 |
| `wechatPay.serialNo` | `NUXT_WECHAT_PAY_SERIAL_NO` | `''` | 商户证书序列号 |
| `wechatPay.privateKey` | `NUXT_WECHAT_PAY_PRIVATE_KEY` | `''` | 商户私钥（PEM 格式） |
| `wechatPay.platformCert` | `NUXT_WECHAT_PAY_PLATFORM_CERT` | `''` | 平台证书（可选） |
| `wechatPay.notifyUrl` | `NUXT_WECHAT_PAY_NOTIFY_URL` | `''` | 支付回调通知地址 |

#### 微信公众号

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `wechat.mpSecret` | `NUXT_WECHAT_MP_SECRET` | `''` | 公众号 AppSecret |
| `wechat.authRedirectWhitelist` | `NUXT_WECHAT_AUTH_REDIRECT_WHITELIST` | `''` | 授权回调重定向白名单（逗号分隔） |

#### 阿里云基础 / 短信 / 验证码 / OSS 回调

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `aliyun.accessKeyId` | `NUXT_ALIYUN_ACCESS_KEY_ID` | `''` | 阿里云 AK（短信 / 验证码 / OSS 通用） |
| `aliyun.accessKeySecret` | `NUXT_ALIYUN_ACCESS_KEY_SECRET` | `''` | 阿里云 SK |
| `aliyun.captcha.enable` | `NUXT_ALIYUN_CAPTCHA_ENABLE` | `false` | 是否启用阿里云行为式验证码 |
| `aliyun.captcha.region` | `NUXT_ALIYUN_CAPTCHA_REGION` | `'cn'` | 验证码区域（cn / sg） |
| `aliyun.captcha.prefix` | `NUXT_ALIYUN_CAPTCHA_PREFIX` | `''` | 验证码场景前缀 |
| `aliyun.captcha.dualStack` | `NUXT_ALIYUN_CAPTCHA_DUAL_STACK` | `false` | 是否启用双栈 endpoint |
| `aliyun.captcha.scriptSrc` | `NUXT_ALIYUN_CAPTCHA_SCRIPT_SRC` | `'https://o.alicdn.com/...'` | 前端脚本 CDN 地址 |
| `aliyun.captcha.sceneIds.loginSms` | `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_LOGIN_SMS` | `''` | 登录短信场景 ID |
| `aliyun.captcha.sceneIds.registerSms` | `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_REGISTER_SMS` | `''` | 注册短信场景 ID |
| `aliyun.captcha.sceneIds.resetPasswordSms` | `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_RESET_PASSWORD_SMS` | `''` | 找回密码短信场景 ID |
| `aliyun.captcha.sceneIds.passwordLogin` | `NUXT_ALIYUN_CAPTCHA_SCENE_IDS_PASSWORD_LOGIN` | `''` | 密码登录场景 ID |
| `aliyun.captcha.loginRisk.enable` | `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_ENABLE` | `false` | 登录风控开关 |
| `aliyun.captcha.loginRisk.threshold` | `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_THRESHOLD` | `3` | 触发验证码的失败次数阈值 |
| `aliyun.captcha.loginRisk.windowSec` | `NUXT_ALIYUN_CAPTCHA_LOGIN_RISK_WINDOW_SEC` | `900` | 风控统计窗口（秒） |
| `aliyun.sms.enable` | `NUXT_ALIYUN_SMS_ENABLE` | `false` | 是否启用短信 |
| `aliyun.sms.signName` | `NUXT_ALIYUN_SMS_SIGN_NAME` | `''` | 短信签名 |
| `aliyun.sms.templateCaptchaCode` | `NUXT_ALIYUN_SMS_TEMPLATE_CAPTCHA_CODE` | `''` | 验证码模板 ID |
| `aliyun.sms.rateLimitMs` | `NUXT_ALIYUN_SMS_RATE_LIMIT_MS` | `60` | 发送频率限制（秒） |
| `aliyun.sms.codeExpireMs` | `NUXT_ALIYUN_SMS_CODE_EXPIRE_MS` | `300` | 验证码有效期（秒） |
| `aliyun.sms.maxFailures` | `NUXT_ALIYUN_SMS_MAX_FAILURES` | `5` | 最大失败次数 |
| `aliyun.sms.lockDurationMs` | `NUXT_ALIYUN_SMS_LOCK_DURATION_MS` | `900` | 锁定时间（秒） |
| `aliyun.oss.callbackUrl` | `NUXT_ALIYUN_OSS_CALLBACK_URL` | `''` | 旧版 OSS 回调地址（保留兼容；新代码用 `storage.callbackUrl`） |
| `aliyun.oss.main.bucket` | `NUXT_ALIYUN_OSS_MAIN_BUCKET` | `''` | 旧版主 bucket（兼容字段） |
| `aliyun.oss.main.basePath` | `NUXT_ALIYUN_OSS_MAIN_BASE_PATH` | `''` | 旧版基础路径（兼容字段） |

#### Langfuse 可观测性（自托管）

| 配置键 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| `langfuse.publicKey` | `LANGFUSE_PUBLIC_KEY` | `''` | Langfuse public key（注：本节直接读 `process.env`，不走 NUXT_ 前缀） |
| `langfuse.secretKey` | `LANGFUSE_SECRET_KEY` | `''` | Langfuse secret key |
| `langfuse.baseUrl` | `LANGFUSE_BASE_URL` | `''` | 自托管 Langfuse 地址 |
| `langfuse.tracingEnabled` | `LANGFUSE_TRACING_ENABLED` | `true`（除非显式置 `false`） | 是否启用 OTel tracing |
| `langfuse.maskPII` | `LANGFUSE_MASK_PII` | `true`（除非显式置 `false`） | 是否对 PII 字段脱敏 |
| `langfuse.environment` | `LANGFUSE_ENVIRONMENT` / `NODE_ENV` | `'development'` | 环境标识，用于在 Langfuse UI 区分 dev/staging/production |
| `langfuse.gitSha` | `GIT_SHA` | `''` | 当前部署的 git SHA（CI 注入） |
| `langfuse.exportMode` | `LANGFUSE_EXPORT_MODE` | `'batched'` | `'immediate'` 适用于 serverless（FC3/Lambda），避免容器回收导致 span 丢失 |

> 详见 [tech-docs/backend/langfuse.md](../backend/langfuse.md)。

---

## 2. 环境变量命名规则

Nuxt 4 的自动映射规则：

```
runtimeConfig 路径                    环境变量名
─────────────────────────────────    ──────────────────────────
public.baseUrl                   →  NUXT_PUBLIC_BASE_URL
jwt.secret                       →  NUXT_JWT_SECRET
storage.aliyunOss.accessKeyId    →  NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID
agent.maxConcurrent              →  NUXT_AGENT_MAX_CONCURRENT
```

命名规则总结：
1. 所有变量以 `NUXT_` 开头
2. `public` 下的变量以 `NUXT_PUBLIC_` 开头
3. 嵌套层级用 `_` 分隔，camelCase 转为 `UPPER_SNAKE_CASE`
4. 数据库连接使用独立的 `DATABASE_URL`（非 Nuxt 管理）

---

## 3. 访问方式

### 服务端

```typescript
const config = useRuntimeConfig()

// 私有配置（仅服务端可用）
config.jwt.secret
config.redis.url
config.storage.aliyunOss.bucket

// 公开配置
config.public.baseUrl
config.public.wechatAppId
```

### 客户端

```typescript
const config = useRuntimeConfig()

// 仅可访问 public 下的配置
config.public.baseUrl
config.public.logLevel
```

---

## 4. 双环境配置

### `.env`（开发环境）

包含开发所需的所有配置，由 Nuxt 自动加载。`DATABASE_URL` 指向本地 Docker 中的 PostgreSQL。

### `.env.testing`（测试环境）

测试专用配置文件，使用独立的测试数据库 `ls_new_testing`。在 `vitest.config.ts` 中显式加载：

```typescript
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '.env.testing') })
```

关键差异：
- `DATABASE_URL` 指向测试数据库 `ls_new_testing`
- 测试中通过 `process.env.DATABASE_URL` 直接获取连接串（不经过 Nuxt runtimeConfig）

### `.env.example`（配置模板）

提供所有环境变量的完整列表和说明，新部署时复制为 `.env` 并填写实际值。

---

## 5. 安全注意事项

- **JWT Secret**：`nuxt.config.ts` 中的默认值 `'lexseek_jwt_secret'` 仅用于开发，生产环境必须通过环境变量覆盖
- **敏感配置**：所有密钥、证书、API Key 都定义在服务端私有配置中，不会暴露到客户端
- **OSS STS**：上传签名使用 STS 临时凭证，避免客户端接触长期 AK/SK
- **数据库 URL**：存储在 `DATABASE_URL` 中，不经过 Nuxt runtimeConfig，避免被 public 部分意外暴露
