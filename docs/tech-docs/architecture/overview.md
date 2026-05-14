# 系统架构总览

LexSeek 是基于 Nuxt 4 的全栈法律 AI 应用，前后端同仓，通过 Nitro 服务引擎统一部署。采用 LangGraph 工作流引擎驱动 AI 分析，以 PostgreSQL 为数据核心，支持多模型供应商和多存储后端。

## 技术栈版本

### 框架与运行时

| 技术 | 版本 | 用途 |
|------|------|------|
| Nuxt | ^4.2.2 | 全栈框架（compatibilityVersion: 4） |
| Vue | ^3.5.25 | 前端 UI 框架 |
| Tailwind CSS | ^4.1.18 | 原子化样式（v4 新架构，Vite 插件模式） |
| TypeScript | - | 全栈类型系统（vue-tsc ^3.2.2 类型检查） |
| Bun | - | 包管理 + 脚本运行 |

### UI 组件

| 技术 | 版本 | 用途 |
|------|------|------|
| shadcn-vue | ^2.4.3 | UI 组件库（基于 reka-ui） |
| reka-ui | ^2.7.0 | 无样式组件原语 |
| lucide-vue-next | ^0.562.0 | 图标库 |
| @iconify/vue | ^5.0.0 | 通用图标系统 |
| TipTap | ^3.14.0 | 富文本编辑器 |
| Vue Flow | ^1.48.1 | 流程图/工作流可视化 |

### 数据与缓存

| 技术 | 版本 | 用途 |
|------|------|------|
| Prisma | ^7.2.0 | ORM + 数据库迁移（@prisma/adapter-pg） |
| PostgreSQL (pg) | ^8.16.3 | 主数据库驱动，时区 Asia/Shanghai |
| ioredis | ^5.10.1 | Redis 客户端（缓存 + Agent 事件桥） |

### AI/LLM

| 技术 | 版本 | 用途 |
|------|------|------|
| LangChain Core | ^1.1.39 | AI 框架核心 |
| LangGraph | ^1.2.8 | 工作流编排 |
| @langchain/langgraph-checkpoint-postgres | ^1.0.1 | 工作流状态持久化 |
| AI SDK (Vercel) | ^6.0.116 | AI 工具集 |
| @langchain/anthropic | ^1.3.26 | Claude 模型接入 |
| @langchain/openai | ^1.4.1 | OpenAI 模型接入 |
| @langchain/deepseek | ^1.0.23 | DeepSeek 模型接入 |
| @langchain/google-genai | ^2.1.26 | Gemini 模型接入 |

### 工具与测试

| 技术 | 版本 | 用途 |
|------|------|------|
| Vitest | ^4.0.16 | 测试框架 |
| fast-check | ^4.5.2 | 属性测试 |
| Zod | ^4.2.1 | 运行时参数校验 |
| dayjs | ^1.11.19 | 日期处理 |
| Pinia | ^3.0.4 | 状态管理 |

## 目录结构

```
LexSeek/
├── app/                          # 前端应用
│   ├── components/               # Vue 组件
│   │   ├── ui/                  # shadcn-vue 基础组件 (禁止修改)
│   │   └── */                   # 业务组件 (按功能域组织，约 24 个模块)
│   ├── composables/              # 组合式函数 (33 个 use*.ts)
│   ├── pages/                    # 页面路由 (文件系统路由，约 83 个文件)
│   │   ├── admin/               # 管理后台 (20+ 页面)
│   │   ├── dashboard/           # 用户仪表板 (案件/工具/会员/设置)
│   │   └── *.vue                # 公共页面 (登录/注册/定价/隐私协议等)
│   ├── store/                    # Pinia 状态 (9 个 store)
│   ├── layouts/                  # 布局模板 (5 个)
│   │   ├── baseLayout.vue       # 基础布局
│   │   ├── dashboardLayout.vue  # 仪表板布局 (侧边栏 + 主内容区)
│   │   ├── admin-layout.vue     # 管理后台布局
│   │   ├── membershipLayout.vue # 会员页面布局
│   │   └── settingsLayout.vue   # 设置页面布局
│   ├── plugins/                  # 插件 (color-mode/logger/pinia-reset/ssr-width)
│   ├── workers/                  # Web Worker (文件加密等)
│   ├── lib/                      # 工具函数 (cn, utils)
│   └── assets/                   # 静态资源 (CSS/图片)
├── server/                       # 服务端 (Nitro)
│   ├── api/v1/                   # REST API 路由 (25 个模块)
│   │   ├── admin/               # 管理接口 (权限/角色/用户/产品/法规/合同/文书/节点/skills 等)
│   │   ├── assistant/           # 通用问答 / 文书 / 合同 用户端接口
│   │   ├── auth/                # 认证 (登录/注册/密码)
│   │   ├── callback/            # 第三方异步回调（含 MinerU）
│   │   ├── cases/               # 案件分析 (分析运行 / 会话 / init-analysis)
│   │   ├── case-types/          # 案件类型
│   │   ├── dashboard/           # 用户仪表板聚合数据
│   │   ├── demo-cases/          # 演示案件
│   │   ├── files/               # 文件元数据
│   │   ├── legal/               # 法律法规
│   │   ├── material/            # 素材 (上传/搜索/处理)
│   │   ├── memberships/         # 会员
│   │   ├── oss/                 # 旧版 OSS 直传相关
│   │   ├── payments/            # 支付 (订单/回调)
│   │   ├── points/              # 积分
│   │   ├── products/            # 商品
│   │   ├── proxy/               # 透传代理（OSS 文件 / 临时签名 URL）
│   │   ├── recognition/         # OCR / ASR / 文档识别（部分用户端入口）
│   │   ├── redemption-codes/    # 兑换码
│   │   ├── skills/              # Skill 列表 / labels（用户端）
│   │   ├── sms/                 # 短信验证码
│   │   ├── storage/             # 存储 (预签名 / 回调 / confirm-upload 兜底)
│   │   ├── users/               # 用户 (个人信息/权限/权益)
│   │   ├── wechat/              # 微信公众号 OAuth
│   │   └── campaigns/           # 营销活动
│   ├── agents/                    # Domain Agent vertical 配置 (7 个目录)
│   │   ├── _shared/              # 跨 vertical 共享中间件 / 工具（如 caseContext）
│   │   ├── case-analysis/        # 案件初分（StateGraph：7 节点串行）
│   │   ├── case-main/            # 案件主对话（CASE 域默认入口）
│   │   ├── case-module/          # 案件子模块"小索"（StateGraph，moduleName 路由）
│   │   ├── contract/             # 合同审查（StateGraph，含 stance interrupt）
│   │   ├── document/             # 文书起草（StateGraph）
│   │   └── legal-assistant/      # 全局通用问答（无 caseId，跨案件）
│   ├── middleware/                # 三层中间件链 (requestId → auth → permission)
│   ├── services/                  # 业务逻辑层 (29 个子目录 + dashboard.service.ts 顶级文件)
│   │   ├── agent-platform/       # 自研 LangGraph 适配层（factory/registry/middleware/skills/tools/sse/state/subAgent/context/diagnostics/nodeConfig/threadState/checkpointer）
│   │   ├── memory/               # 案件记忆系统（自动提取 + 用户记录）
│   │   ├── security/             # 风控（验证码、登录风险）
│   │   ├── ai/                   # AI 通用 helper（如 generateSummaryService）
│   │   ├── */module.service.ts  # Service 层 (业务编排，方法 XXXService 后缀)
│   │   └── */module.dao.ts      # DAO 层 (数据访问，方法 XXXDao/XXXDAO 后缀)
│   ├── lib/                       # 基础设施库
│   │   ├── payment/              # 支付适配器 (工厂模式，微信支付)
│   │   ├── storage/              # 存储适配器 (工厂模式，OSS/七牛/腾讯COS)
│   │   ├── oss/                  # 阿里云 OSS 底层操作（含 head / postSignature 等）
│   │   ├── langfuse/             # Langfuse OTel 桥接 + ModelProxy + PII 脱敏
│   │   ├── redis.ts              # Redis 客户端 (ioredis)
│   │   └── aliSms.ts             # 阿里云短信
│   ├── utils/                     # 工具函数
│   │   ├── db.ts                 # Prisma 客户端单例 (adapter-pg, TimeZone=UTC)
│   │   ├── jwt.ts                # JWT 工具 (生成/验证/解析)
│   │   ├── serialization.ts      # 序列化工具
│   │   └── */                    # 其他工具 (密码/图片压缩/音频等)
│   ├── plugins/                   # Nitro 插件（skill-sync / agent-worker / agents-load 等）
│   └── scripts/                   # 脚本 (数据库初始化 / 重建嵌入)
├── shared/                        # 前后端共享
│   ├── types/                     # 类型定义 (按业务域组织)
│   └── utils/                     # 共享工具 (apiResponse/logger/uuid 等)
├── prisma/                        # 数据库
│   ├── schema.prisma             # 主 schema (仅 generator + datasource)
│   └── models/                    # 模块化模型 (28 个 .prisma 文件)
└── tests/                         # 测试用例
    ├── _infra/                    # global-setup / worker-prisma / template-db
    ├── server/                    # 服务端测试
    ├── client/                    # 客户端测试
    ├── shared/                    # 共享代码测试
    ├── integration/               # 集成测试
    ├── e2e/                       # 端到端
    └── eval/                      # 评测（context-governance 等）
```

## 请求生命周期

```
HTTP 请求
  │
  ▼
01.requestId.ts ─── 生成 UUIDv7 写入 event.context.requestId
  │
  ▼
02.auth.ts ──────── 非 API 放行 → 公开 API 放行 → 提取 JWT（Header/Cookie）
  │                  → 验证 token → 检查黑名单 → 查询用户 → 设置 event.context.auth
  ▼
03.permission.ts ── 非 API 放行 → 公开 API 放行 → 超级管理员放行
  │                  → RBAC 路径匹配验证
  ▼
API Handler ─────── defineEventHandler() 处理业务逻辑
  │                  使用 getQuery/readBody/getRouterParam 获取参数
  │                  使用 resSuccess/resError 返回统一格式
  ▼
Service 层 ──────── *.service.ts（业务编排，方法以 Service 结尾）
  │
  ▼
DAO 层 ─────────── *.dao.ts（数据访问，方法以 DAO/Dao 结尾）
  │
  ▼
Prisma Client ───── PostgreSQL（adapter-pg，TimeZone=UTC 避免双偏移）
```

## 响应格式

所有 API 恒返回 HTTP 200，通过 code 字段区分业务状态：

```typescript
// 成功响应 (code: 0)
{
  requestId: "0193xxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx",
  success: true,
  code: 0,
  message: "操作成功",
  timestamp: 1712847600000,
  data: { /* 业务数据 */ }
}

// 失败响应 (code: 400/401/403...)
{
  requestId: "0193xxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx",
  success: false,
  code: 400,
  message: "参数错误",
  timestamp: 1712847600000,
  data: null
}
```

`resSuccess` 和 `resError` 定义在 `shared/utils/apiResponse.ts`，通过 Nuxt 4 的 shared 自动导入机制全局可用。

## 前后端通信

### REST API

标准 RESTful 接口，通过 Nuxt 的文件系统路由自动注册：

```
文件路径                                          对应路由
server/api/v1/cases/[caseId]/history.get.ts    → GET  /api/v1/cases/:caseId/history
server/api/v1/auth/login/password.post.ts      → POST /api/v1/auth/login/password
server/api/v1/admin/roles/[id].delete.ts       → DELETE /api/v1/admin/roles/:id
```

前端通过两个封装调用（详见 auto-imports.md）：

| Composable | 基于 | SSR | 适用场景 |
|-----------|------|-----|---------|
| `useApi()` | `useFetch` | 支持 | setup 阶段、需要响应式 |
| `useApiFetch()` | `$fetch` | 不支持 | 事件处理函数 (onClick 等) |

**重要陷阱**：两者都自动提取 `data` 字段，不要 `response?.data?.xxx`，直接 `response?.xxx`。

### SSE (Server-Sent Events)

用于案件分析工作流的实时通信。由 `server/services/sse/sse.service.ts` 中的 `SSEConnectionManager` 管理。

支持的消息类型（定义在 `shared/types/case.ts` 的 `SSEMessageType` 枚举）：

| 消息类型 | 用途 |
|---------|------|
| `CONNECTED` / `HEARTBEAT` / `CLOSED` | 连接生命周期管理 |
| `WORKFLOW_START` / `WORKFLOW_COMPLETE` | 工作流开始/完成 |
| `TASK_START` / `TASK_PROGRESS` / `TASK_COMPLETE` | 任务级别进度 |
| `TEXT_DELTA` / `REASONING` | AI 流式文本输出 |
| `TOOL_CALL` / `TOOL_RESULT` | 工具调用与结果 |
| `INTERRUPT` | 工作流中断（等待用户输入） |
| `ERROR` | 错误事件 |

SSE 连接特性：
- 心跳保活（默认 30 秒间隔）
- 可配置连接超时
- 客户端断开自动清理
- 通过 `formatSSEMessage()` 统一 JSON 序列化

## 关键第三方服务

| 服务 | 用途 | 配置位置 | 集成代码 |
|------|------|---------|---------|
| 阿里云 OSS | 文件存储（STS 临时凭证） | `runtimeConfig.storage.aliyunOss` | `server/lib/oss/`, `server/lib/storage/adapters/aliyun-oss.ts` |
| 阿里云 SMS | 短信验证码 | `runtimeConfig.aliyun.sms` | `server/lib/aliSms.ts` |
| 微信支付 | 会员购买（API v3） | `runtimeConfig.wechatPay` | `server/lib/payment/adapters/wechat-pay.ts` |
| 微信 OAuth | 公众号登录 | `runtimeConfig.public.wechatAppId` | `server/services/wechat/wechat.service.ts` |
| MinerU | PDF/文档解析 | 回调 URL 配置 | `server/services/material/mineru*.ts` |
| ASR | 音频转文字 | 任务配置 | `server/services/material/asr*.ts` |
| Redis | 缓存 + Agent 事件桥 | `runtimeConfig.redis.url` | `server/lib/redis.ts` |
| LangChain/LangGraph | AI Agent 工作流 | 模型配置 | `server/services/workflow/`, `server/services/node/` |
| Embedding | 向量嵌入 | `runtimeConfig.embedding` | text-embedding-v3，维度 1536 |

### 适配器工厂模式

三个基础设施服务采用工厂模式，支持多供应商切换：

```
server/lib/
├── payment/
│   ├── base.ts          # IPaymentAdapter 接口
│   ├── factory.ts       # 工厂：根据 PaymentChannel 创建适配器
│   ├── adapters/
│   │   └── wechat-pay.ts  # 微信支付实现
│   └── types.ts         # 配置类型
├── storage/
│   ├── base.ts          # StorageAdapter 抽象类
│   ├── factory.ts       # StorageFactory：单例管理适配器
│   ├── adapters/
│   │   ├── aliyun-oss.ts  # 阿里云 OSS 实现
│   │   ├── qiniu.ts       # 七牛云（预留）
│   │   └── tencent-cos.ts # 腾讯 COS（预留）
│   └── callback/        # 上传回调处理
└── redis.ts             # Redis 客户端
```

## 服务模块一览

| 模块 | 路径 | 职责 |
|------|------|------|
| agent | services/agent/ | Agent 任务队列 + Redis SSE 事件桥（agentRuns 表 + agentWorker） |
| agent-platform | services/agent-platform/ | 自研 LangGraph 适配层（middleware/factory/registry/skills/sse/state/subAgent/tools/nodeConfig/context/diagnostics 等） |
| ai | services/ai/ | AI 通用 helper（如 `generateSummaryService`） |
| assistant | services/assistant/ | 通用问答 / 文书 / 合同 用户端业务 |
| audit | services/audit/ | 审计日志（订单 / 支付 / 权限变更） |
| auth | services/auth/ | JWT 认证、Cookie 管理 |
| campaign | services/campaign/ | 营销活动 |
| case | services/case/ | 案件管理、案件材料、案件会话、init-analysis |
| dashboard.service.ts | services/dashboard.service.ts | 用户工作台聚合数据接口（顶级文件） |
| files | services/files/ | 文件元数据管理（含 ossFileVerify 兜底校验） |
| legal | services/legal/ | 法律条文、法律文章、向量存储 |
| material | services/material/ | 材料处理（OCR/Mineru/ASR/嵌入） |
| membership | services/membership/ | 会员等级、权益 |
| memory | services/memory/ | 案件记忆系统（自动提取 + 用户记录） |
| model | services/model/ | 模型配置、Provider 管理、API Key |
| node | services/node/ | AI 节点（prompt 4 类 / 模型 / 访问控制） |
| payment | services/payment/ | 订单、支付事务、微信支付 |
| point | services/point/ | 积分系统 |
| product | services/product/ | 产品管理 |
| rbac | services/rbac/ | 角色权限、路径匹配、权限缓存 |
| redemption | services/redemption/ | 兑换码 |
| retrieval | services/retrieval/ | 检索服务（语义/全文/混合搜索 + rerank） |
| security | services/security/ | 风控（验证码、登录风险） |
| sms | services/sms/ | 短信发送、验证码 |
| sse | services/sse/ | SSE 连接管理、心跳 |
| storage | services/storage/ | 统一存储适配器（OSS/七牛/腾讯 COS）+ getStorageAdapterService |
| system | services/system/ | 系统配置 |
| users | services/users/ | 用户 CRUD |
| wechat | services/wechat/ | 微信公众号 OAuth |
| workflow | services/workflow/ | LangGraph 工作流编排（caseAnalysisV2 入口、moduleAgent 等） |

## 模块依赖关系

### 核心业务链路

```
                     ┌──────────────────┐
                     │   case (案件)     │
                     └──────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │ material │   │ workflow │   │  legal   │
      │ (素材)    │   │ (工作流) │   │ (法规)   │
      └─────┬────┘   └─────┬────┘   └────┬─────┘
            │              │             │
            ▼              ▼             ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │ storage  │   │  agent   │   │retrieval │
      │ (存储)    │   │ (Agent)  │   │ (检索)    │
      └──────────┘   └─────┬────┘   └──────────┘
                           │
                     ┌─────┴─────┐
                     ▼           ▼
              ┌──────────┐ ┌──────────┐
              │  model   │ │   node   │
              │ (模型)    │ │ (节点)    │
              └──────────┘ └──────────┘
```

### 详细依赖说明

| 上游模块 | 依赖的下游模块 | 依赖说明 |
|---------|-------------|---------|
| workflow | node | 工作流中的每个节点由 node 模块定义 |
| workflow | case | 工作流执行需要案件上下文 |
| workflow | retrieval | 节点执行时调用检索服务获取法律依据 |
| agent | model | Agent 执行时调用模型服务获取 LLM 实例 |
| agent | sse | Agent 执行过程通过 SSE 实时推送 |
| case | material | 案件关联素材 |
| material | storage | 素材文件存储 |
| retrieval | legal | 检索法律法规知识库 |
| payment | membership | 支付完成后激活会员权益 |
| payment | product | 创建订单时查询产品 |
| auth | rbac | 认证后验证权限 |
| rbac | users | 查询用户角色关系 |

### 横向支撑模块

```
  ┌──────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ ┌──────┐ ┌──────┐
  │ auth │ │membership│ │ payment  │ │ point │ │ rbac │ │  sse │
  │(认证)│ │ (会员)    │ │ (支付)    │ │(积分) │ │(权限)│ │(推送)│
  └──────┘ └──────────┘ └──────────┘ └───────┘ └──────┘ └──────┘
```

## 构建与部署

- 构建命令：`bun build`（NODE_OPTIONS='--max-old-space-size=8192'）
- 类型检查：`npx nuxi typecheck`（不要用 `tsc`）
- 可选代码混淆：`ENABLE_OBFUSCATOR=true`（rollup-plugin-obfuscator）
- Prisma 数据库连接使用 `@prisma/adapter-pg`，通过 `-c TimeZone=UTC` 设置会话时区

## 数据库设计要点

- **模块化 Schema**：`prisma/models/` 下 28 个独立 `.prisma` 文件，按业务域拆分（user / case / materials / file / membership / order / product / point / rbac / apiPermission / router / node / model / recognition / storage / campaign / redemption / sms / system / legal / agentRun / contractReview / contractPlaybook / contractReviewVersion / contractRiskAndAnnotation / contractReviewLegacyBackup / document / skill）
- **主 schema**：`prisma/schema.prisma` 仅包含 generator 和 datasource 声明，模型通过 Prisma 的多文件 schema 功能自动合并
- **生成路径**：Prisma Client 生成到 `generated/prisma/client`，类型导入使用 `~~/generated/prisma/client`
- **时区处理**：Prisma 连接设置 `TimeZone=UTC`（通过 `@prisma/adapter-pg` 的 connection options），避免 Date 值双偏移 bug
- **Decimal 处理**：Prisma 返回的 Decimal 类型需要使用 `shared/utils/decimalToNumber.ts` 转换为 number
- **向量检索**：使用 PostgreSQL 的 `pgvector` 扩展，用于法规和素材的语义检索

## 安全机制

| 安全层面 | 实现方式 |
|---------|---------|
| 认证 | JWT (jsonwebtoken)，支持 Bearer Token 和 HttpOnly Cookie 双通道 |
| 密码存储 | bcryptjs 哈希 |
| 权限控制 | 数据库驱动的 RBAC，角色-API 权限映射，支持路径模式匹配（:param, *, **） |
| 文件加密 | age-encryption + Web Worker 隔离，客户端加解密 |
| 代码保护 | 生产构建可选 JavaScript 混淆 (rollup-plugin-obfuscator) |
| 输入验证 | 所有 API 入口使用 Zod schema 验证 |
| Token 管理 | 支持 Token 黑名单机制（登出/密码修改时失效） |
| 主题防闪烁 | 内联脚本在页面渲染前应用颜色模式，避免 FOUC |
