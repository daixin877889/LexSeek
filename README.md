# LexSeek — 法律服务 AI 应用

LexSeek 是面向律师与企业法务的全栈 AI 应用，提供案件分析、合同审查、文书起草、法律检索、案件记忆等能力。

## 技术栈

- **前端**：Nuxt 4 + Vue 3 + Tailwind CSS v4 + shadcn-vue
- **服务端**：Nuxt Server (Nitro) + TypeScript
- **AI 编排**：LangChain / LangGraph + LangSmith（自研 `agent-platform` 适配层）
- **数据库**：PostgreSQL（pgvector + pg_trgm + zhparser）+ Prisma ORM
- **包管理**：Bun
- **测试**：Vitest（worker 级 DB 物理隔离）+ fast-check + chrome-devtools E2E

## 快速启动

```bash
# 安装依赖（postinstall 自动跑 nuxt prepare + prisma generate）
bun install

# 启动开发服务器（监听 0.0.0.0:3000）
bun dev

# 类型检查（必须用 nuxi 而不是 tsc）
bun run typecheck

# 全量测试
bun run test
```

> 数据库走 Docker 本地起；详细命令清单见 [`.claude/rules/commands.md`](./.claude/rules/commands.md)。

## 项目结构

```
app/      前端页面、组件、composables、Pinia store
server/   API 路由、业务 Service / DAO、Agent 编排、中间件
shared/   双端共用类型与工具
prisma/   按领域拆分的 .prisma schema、迁移、seed
tests/    Vitest 测试 + worker 级 DB 隔离基建
docs/     模块级技术文档（tech-docs/）+ 规划文档（superpowers/）
```

## 文档

- **AI 协作约定**：[`CLAUDE.md`](./CLAUDE.md)（项目权威）/ [`AGENTS.md`](./AGENTS.md)（Codex 简版）/ [`GEMINI.md`](./GEMINI.md)（Gemini 简版）
- **开发规范**：[`.claude/rules/`](./.claude/rules/)（按 paths 自动加载）
- **架构与模块文档**：[`docs/tech-docs/`](./docs/tech-docs/README.md)
- **数据库迁移规则**：[`.claude/rules/database.md`](./.claude/rules/database.md)（强制走 `prisma migrate dev`）

## License

私有项目，未公开授权。
