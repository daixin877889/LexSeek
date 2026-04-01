# LexSeek (法律检索与发现平台) - GEMINI.md

## 项目概览
LexSeek 是一个基于 AI 的法律检索与发现平台，旨在利用先进的大模型技术（LLM）和向量检索提供高效的法律知识库服务、案件分析及法律文档处理工具。

**始终用简体中文和用户交互**

## 核心技术栈
- **前端框架**: [Nuxt 4](https://nuxt.com/) (Compatibility Mode) + [Vue 3](https://vuejs.org/)
- **语言**: [TypeScript](https://www.typescriptlang.org/)
- **样式方案**: [Tailwind CSS v4](https://tailwindcss.com/) + [Shadcn Vue](https://www.shadcn-vue.com/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **后端引擎**: [Nitro](https://nitro.unjs.io/) (Nuxt Server)
- **数据库/ORM**: [PostgreSQL](https://www.postgresql.org/) + [Prisma ORM](https://www.prisma.io/) (支持模块化模型)
- **包管理工具**: [Bun](https://bun.sh/)
- **测试框架**: [Vitest](https://vitest.dev/) + [fast-check](https://fast-check.dev/) (属性测试)
- **AI 框架**: [LangChain](https://js.langchain.com/) + [Vercel AI SDK](https://sdk.vercel.ai/)
- **基础设施**: 阿里云 OSS (文件存储), 阿里云 SMS (短信服务), 微信支付 (支付系统)

## 项目架构
```text
LexSeek/
├── app/                    # 前端应用核心
│   ├── components/         # Vue 组件 (业务组件与 UI 组件)
│   ├── composables/        # 组合式函数 (业务逻辑抽象)
│   ├── layouts/            # 布局模板
│   ├── pages/              # 基于文件的路由
│   ├── store/              # Pinia 状态仓库 (自动导入)
│   └── utils/              # 客户端工具函数
├── server/                 # 服务端代码
│   ├── api/                # API 接口路由 (Nitro)
│   ├── services/           # 业务逻辑服务层 (自动导入)
│   ├── lib/                # 核心库 (支付、OSS、存储适配器)
│   ├── middleware/         # H3 中间件
│   ├── plugins/            # Nitro 插件
│   └── utils/              # 服务端工具函数
├── shared/                 # 前后端共享代码
│   ├── types/              # TypeScript 类型/接口定义
│   └── utils/              # 共享工具类
├── prisma/                 # 数据库定义
│   ├── models/             # 模块化 Prisma 模式文件 (*.prisma)
│   ├── seeds/              # 数据库种子脚本
│   └── schema.prisma       # 主模式入口
├── tests/                  # 测试套件
│   ├── server/             # 服务端集成/单元测试
│   ├── client/             # 客户端组件测试
│   └── shared/             # 共享逻辑测试
└── public/                 # 静态资源
```

## 关键开发指令
- **启动开发环境**: `bun run dev` (监听 `0.0.0.0`)
- **构建生产版本**: `bun run build`
- **运行全量测试**: `bun run test`
- **运行服务端测试**: `bun run test:server`
- **Prisma 操作**:
  - 生成客户端: `bun run prisma:generate`
  - 数据库推送: `bun run prisma:push`
  - 创建迁移: `bun run prisma:migrate`
- **类型检查**: `bun run typecheck`

## 核心规范与约定

### 1. 响应格式 (Standard Response)
所有 API 返回必须遵循统一格式：
```typescript
{
  code: number,    // 状态码 (200 为成功)
  message: string, // 提示信息
  data?: any       // 业务数据
}
```

### 2. UI 组件规范
- 使用 **Shadcn Vue** 作为基础 UI 库，位于 `app/components/ui/`。
- **允许并鼓励**根据业务需求直接修改 `ui/` 目录下的组件源码（Shadcn Vue 的本质是源码分发），无需通过包装组件来实现自定义。修改时需确保样式系统与全局保持一致。
- 组件引用**不使用**任何前缀 (如直接使用 `<Button />`, `<Badge />`)。
- 优先利用 Nuxt 的自动导入机制，避免在组件中手动导入 `ui/` 下 service 或组件。

### 3. 测试规范
- **必须真实执行**: 严禁过度 Mock。涉及数据库的操作必须在真实测试库中运行。
- **属性测试**: 核心逻辑优先使用 `fast-check` 进行边界情况覆盖。
- **环境隔离**: 测试使用专用的 `.env.testing` 文件及 `ls_new_testing` 数据库。
- **清理机制**: 确保测试后数据状态被正确回滚或清理。

### 4. 自动导入 (Auto-imports)
- **Frontend**: `store/` 目录下的所有 Pinia stores 自动导入。
- **Backend**: `server/services/` 下的二级目录服务自动导入。

### 5. 存储与安全
- 文件上传采用 **Aliyun OSS**，支持多提供者适配。
- 敏感文档使用 `age-encryption` 进行端到端或服务端加密。
- 用户认证基于 JWT + Cookie。

## 环境变量
核心配置项（通过 `.env` 管理）：
- `DATABASE_URL`: PostgreSQL 连接字符串。
- `NUXT_EMBEDDING_API_KEY`: 向量嵌入模型 API Key。
- `WECHAT_PAY_*`: 微信支付相关密钥。
- `ALIYUN_OSS_*`: 阿里云 OSS 配置。

---
*注：本文件由 Gemini CLI 生成，作为后续开发交互的基础上下文参考。*
