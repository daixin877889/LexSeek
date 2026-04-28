# LexSeek 开发规范索引

> 注意：所有规范文件通过 `.claude/rules/` 自动加载（带 paths 限定），无需手动引用。

## 通用规范（所有文件触发）

- **commands.md** — 开发、测试（含 `test:fast`）、Prisma、维护脚本
- **architecture.md** — 目录结构、技术栈、模块说明、中间件链路
- **main.md** — 语言要求、TDD 模式、框架约定、自动导入与显式 import 规则
- **git.md** — Git 提交规范（conventional commit + 中文）
- **types.md** — `shared/types` 组织、Prisma 类型派生、导入规范
- **database.md** — 数据库迁移强制规则（schema + migrate dev + 禁止手工改 migrations）

## 范围限定规范

| 规范 | 触发路径 |
|------|---------|
| `api.md` | `server/**` |
| `ui.md` | `app/components/**`、`app/pages/**`、`app/**/*.vue` |
| `testing.md` | `tests/**` |
| `fetch.md` | `app/**` |
| `tech-docs.md` | `server/services/**`、`server/lib/**`、`prisma/**` |
| `tech-docs-frontend.md` | `app/components/**`、`app/composables/**`、`app/store/**`、`app/layouts/**`、`app/pages/**` |
| `agent-platform.md` | `server/services/agent-platform/**`、`server/agents/**`、`server/services/memory/**` |

## 用法

新增功能 / 改 bug 时，规范文件按 paths 自动加载到 AI 上下文，无需手动 `@` 引用。
