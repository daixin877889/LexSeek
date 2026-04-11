# LexSeek 技术文档体系

LexSeek 是基于 Nuxt 4 全栈架构的法律服务 AI 应用，本文档体系面向 AI 开发助手，提供开发所需的架构、模式、模块和基础设施参考。

## 快速导航

> "我要做 X" → 查看对应文档

| 场景 | 文档 |
|------|------|
| 了解系统整体架构 | [architecture/overview.md](./architecture/overview.md) |
| 理解自动导入机制 | [architecture/auto-imports.md](./architecture/auto-imports.md) |
| 理解请求鉴权流程 | [architecture/middleware-chain.md](./architecture/middleware-chain.md) |
| 查看数据模型关系 | [architecture/data-model.md](./architecture/data-model.md) |
| 了解环境变量配置 | [architecture/config-and-env.md](./architecture/config-and-env.md) |
| 新增一个 API 接口 | [patterns/service-dao.md](./patterns/service-dao.md) |
| 接入新的 AI 模型供应商 | [patterns/adapter-factory.md](./patterns/adapter-factory.md) |
| 理解案件分析工作流 | [patterns/workflow-middleware.md](./patterns/workflow-middleware.md) |
| 实现前后端实时通信 | [patterns/sse-event-bridge.md](./patterns/sse-event-bridge.md) |
| 开发案件分析相关功能 | [backend/case.md](./backend/case.md) + [backend/workflow.md](./backend/workflow.md) |
| 开发素材处理相关功能 | [backend/material.md](./backend/material.md) |
| 开发法律法规检索功能 | [backend/legal.md](./backend/legal.md) + [backend/retrieval.md](./backend/retrieval.md) |
| 开发支付/会员功能 | [backend/payment.md](./backend/payment.md) + [backend/membership.md](./backend/membership.md) |
| 开发权限管理功能 | [backend/rbac.md](./backend/rbac.md) + [backend/auth-users-sms.md](./backend/auth-users-sms.md) |
| 开发 Agent 节点功能 | [backend/agent.md](./backend/agent.md) + [backend/node.md](./backend/node.md) |
| 开发前端页面或组件 | [frontend/overview.md](./frontend/overview.md) + [frontend/components.md](./frontend/components.md) |
| 了解前端状态管理 | [frontend/stores.md](./frontend/stores.md) |
| 了解前端数据请求 | [frontend/composables.md](./frontend/composables.md) |
| 开发案件分析 UI | [frontend/case-analysis-ui.md](./frontend/case-analysis-ui.md) |
| 配置数据库和存储 | [infra/database.md](./infra/database.md) + [infra/storage-oss.md](./infra/storage-oss.md) |
| 排查常见问题 | [guides/pitfalls.md](./guides/pitfalls.md) |
| 新增业务模块 | [guides/new-module-checklist.md](./guides/new-module-checklist.md) |
| 编写测试 | [guides/testing-strategy.md](./guides/testing-strategy.md) |

## 目录结构

```
tech-docs/
├── README.md                          # 本文件 - 文档导航索引
├── architecture/                      # 架构文档
│   ├── overview.md                    # 系统架构总览
│   ├── data-model.md                  # 数据模型与 Prisma 模块化设计
│   ├── auto-imports.md                # 自动导入机制
│   ├── middleware-chain.md            # 中间件链路
│   └── config-and-env.md             # 配置与环境变量
├── patterns/                          # 设计模式
│   ├── service-dao.md                 # Service-DAO 分层模式
│   ├── adapter-factory.md             # 适配器工厂模式（模型、存储、支付）
│   ├── workflow-middleware.md         # LangGraph 工作流与中间件模式
│   └── sse-event-bridge.md           # SSE 事件桥接模式
├── backend/                           # 后端模块文档
│   ├── workflow.md                    # 工作流引擎（LangGraph）
│   ├── case.md                        # 案件管理
│   ├── material.md                    # 素材处理（OCR/ASR/MinerU）
│   ├── agent.md                       # Agent 任务调度
│   ├── retrieval.md                   # 检索服务（混合检索、重排）
│   ├── legal.md                       # 法律法规管理
│   ├── model.md                       # 模型管理（多供应商）
│   ├── node.md                        # 工作流节点与提示词
│   ├── payment.md                     # 支付系统（微信支付）
│   ├── membership.md                  # 会员与权益
│   ├── point.md                       # 积分系统
│   ├── rbac.md                        # 角色权限控制
│   └── auth-users-sms.md             # 认证、用户、短信
├── frontend/                          # 前端模块文档
│   ├── overview.md                    # 前端架构总览
│   ├── composables.md                 # Composables 函数
│   ├── stores.md                      # Pinia 状态管理
│   ├── components.md                  # 组件体系
│   └── case-analysis-ui.md           # 案件分析 UI
├── infra/                             # 基础设施文档
│   ├── database.md                    # 数据库（PostgreSQL + Prisma）
│   ├── storage-oss.md                 # 存储服务（阿里云 OSS）
│   └── deployment.md                 # 部署与构建
└── guides/                            # 开发指南
    ├── pitfalls.md                    # 常见陷阱
    ├── new-module-checklist.md        # 新模块开发清单
    └── testing-strategy.md            # 测试策略
```

## 文档维护约定

1. **文档应与代码同步更新**：修改了架构或新增了模块时，对应文档需要同步更新
2. **面向 AI 开发助手**：文档内容以提供开发上下文为目标，优先说明"怎么做"和"为什么"
3. **代码示例优先**：关键概念必须附带代码示例，从项目源码中提取真实用法
4. **文件大小控制**：单个文档控制在 100-400 行，超过时拆分为子文档
5. **中文编写**：所有文档使用简体中文，技术术语可保留英文原名
