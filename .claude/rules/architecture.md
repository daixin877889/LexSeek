# 项目架构

## 技术栈

- **前端**: Nuxt 4 + Vue 3 + Tailwind CSS v4
- **UI**: Shadcn-vue（组件位于 `app/components/ui/`，**禁止修改**）
- **后端**: Nuxt Server（Nitro）+ TypeScript
- **AI 编排**: LangChain / LangGraph + LangSmith，自研 `agent-platform` 适配层
- **数据库**: PostgreSQL（含 pgvector / pg_trgm / zhparser 扩展）+ Prisma ORM
- **包管理**: Bun
- **测试**: Vitest（worker 级 DB 物理隔离）+ fast-check + chrome-devtools E2E

## 目录结构

```
LexSeek/
├── app/                        # 前端应用
│   ├── components/
│   │   ├── ui/                 # shadcn-vue 组件（禁止修改）
│   │   ├── ai-elements/        # AI 对话/流式输出组件（自动注册）
│   │   ├── admin/              # 管理后台组件（NavMain、Breadcrumb、各资源 CRUD 子目录）
│   │   ├── case/, caseDetail/, caseAnalysis/, caseCreation/, initAnalysis/  # 案件相关
│   │   ├── assistant/, agents/                                             # 通用问答 / Agent 平台 UI
│   │   ├── legal/, legal-search/                                            # 法规检索
│   │   ├── membership/, order/, payment/, points/, purchase/, redeem/      # 会员 / 交易
│   │   └── …                   # 其他业务组件
│   ├── composables/            # 全部需要显式 import（自动扫描已关闭）
│   ├── pages/
│   │   ├── dashboard/          # 用户工作台（案件 / 合同 / 文档 / 会员 / 设置 …）
│   │   ├── admin/              # 管理后台（28+ 子模块：orders、payments、audit、models、roles …）
│   │   └── …                   # 公开页（login、register、pricing、reset-password …）
│   ├── layouts/                # 布局模板（dashboard / admin / blank …）
│   ├── store/                  # Pinia store（全部需要显式 import）
│   ├── lib/                    # 客户端工具
│   ├── workers/                # Web Worker（上传、加解密）
│   ├── plugins/                # Nuxt 插件
│   ├── middleware/             # 路由中间件
│   └── utils/                  # 客户端工具函数
├── server/                     # 服务端（Nitro）
│   ├── api/
│   │   └── v1/
│   │       ├── admin/**        # 管理端 API（RBAC 中间件保护）
│   │       └── **/             # 用户端 API（owner-only 严格归属过滤）
│   ├── services/               # 业务 Service + DAO，按领域分目录
│   │   ├── agent-platform/     # 自研 LangGraph 适配层（middleware/factory/registry/skills/sse/state/subAgent/tools/nodeConfig/context/diagnostics…）
│   │   ├── memory/             # 案件记忆系统
│   │   ├── security/           # 风控（验证码、登录风险）
│   │   ├── case/, material/, workflow/, retrieval/, legal/                  # 核心业务
│   │   ├── assistant/, agent/                                               # 通用问答 / Agent 任务调度
│   │   ├── auth/, users/, sms/, rbac/, audit/                               # 身份与权限
│   │   ├── payment/, membership/, point/, product/, redemption/, campaign/  # 交易
│   │   ├── model/, node/, sse/, files/, storage/, system/, wechat/          # 平台基础设施
│   │   ├── ai/                                                              # AI 通用 helper（如 generateSummaryService）
│   │   ├── dashboard.service.ts                                             # 用户工作台聚合数据接口（顶级文件）
│   │   └── …
│   ├── agents/                 # Domain Agent 配置（通过 defineDomainAgent 注册）
│   │   ├── _shared/            # 跨 vertical 共享上下文/工具
│   │   ├── case-analysis/, case-main/, case-module/                         # 案件分析 vertical
│   │   ├── contract/, document/                                             # 合同 / 文档 vertical
│   │   └── legal-assistant/                                                 # 通用问答 vertical
│   ├── lib/                    # 第三方/基建封装（payment、oss、storage、redis、aliSms）
│   ├── middleware/             # 三段式：01.requestId → 02.auth → 03.permission
│   ├── routes/                 # 非 /api 的少量 Nitro 路由
│   ├── scripts/                # 维护脚本（重建嵌入、初始化检索基建）
│   ├── plugins/                # Nitro 插件
│   └── utils/                  # 服务端工具（`db.ts` 是 Prisma 单例，必须显式 import）
├── shared/                     # 双端共用
│   ├── types/                  # 业务类型定义（按领域分文件）
│   └── utils/                  # 共用工具（含 prisma.ts 重导出）
├── prisma/                     # 数据库
│   ├── models/                 # 按领域拆分的 .prisma 文件（28 个）
│   ├── migrations/             # 迁移文件（强制由 prisma migrate dev 生成）
│   ├── seeds/                  # seedData.sql（唯一权威）+ 模板/合同样本
│   ├── seed.ts                 # 运行时基础数据补全
│   └── schema.prisma           # 主入口（仅引用 models/*.prisma）
├── generated/prisma/           # Prisma 生成产物（client + 内部类型）
├── tests/
│   ├── _infra/                 # global-setup / worker-prisma / template-db（worker 级 DB 隔离）
│   ├── server/, shared/, client/, integration/, e2e/, eval/
│   └── KNOWN_FAILS.md          # 已知失败清单
├── docs/tech-docs/             # 模块级技术文档（按需阅读）
├── .claude/rules/              # AI 助手开发规范
├── nuxt.config.ts              # 自动导入策略 / 模块 / runtimeConfig
├── vitest.config.ts            # 全量测试配置（含 globalSetup / setupFiles）
└── vitest.fast.config.ts       # 轻量子集快速测试配置
```

## 模块结构总览

| 模块 | 路径 | 说明 |
|------|------|------|
| app | /app | 前端页面、组件、composables、store |
| server | /server | API、Service、DAO、Agent 编排、中间件 |
| shared | /shared | 双端共用类型与工具 |
| prisma | /prisma | 数据模型、迁移、seed |
| generated | /generated/prisma | Prisma 生成的 client（用 `~~/generated/prisma/client` 引用类型） |
| tests | /tests | 测试用例 + 基建 |
| docs | /docs/tech-docs | 模块级技术文档 |

## 路径别名

- `~/` 与 `@/` → `app/`
- `~~/` 与 `@@/` → 项目根
- `#shared` / `#shared/*` → `shared/`

## 响应格式

```typescript
// 成功
return resSuccess(event, '操作成功', data)
// 错误
return resError(event, 400, '错误信息')
```

> API 永远返回 HTTP 200，业务错误通过响应体内的 `code` 字段区分。

## 中间件链路（请求全生命周期）

`01.requestId.ts` → `02.auth.ts` → `03.permission.ts`

- `02.auth`：解析 cookie/JWT，挂载 `event.context.auth.user`，公开 API 标记 `event.context.isPublicApi`
- `03.permission`：基于 RBAC 权限表细粒度判定。**未在权限表登记的接口默认 403**——管理端新增接口必须同步在 RBAC 配置或数据迁移中授权
