# LexSeek - 法律服务AI应用

## 项目

LexSeek 是一个基于 Nuxt.js 4 的全栈法律服务AI应用，旨在通过人工智能技术赋能法律分析，为律师提供全面的案件分析工具，提升工作效率。

## 技术栈

- **前端**: Nuxt 4 + Vue 3 + Tailwind CSS v4
- **UI**: Shadcn-vue
- **后端**: Nuxt Server (Nitro) + TypeScript
- **数据库**: PostgreSQL + Prisma ORM
- **包管理**: Bun

## 模块结构

| 模块 | 路径 | 说明 |
|------|------|------|
| app | /app | 前端页面、组件、UI库 |
| server | /server | API接口、服务端逻辑 |
| shared | /shared | 共享类型和工具 |
| prisma | /prisma | 数据库模式和迁移 |
| tests | /tests | 测试用例 |

## 开发规范

详细规范见 [.claude/rules/index.md](.claude/rules/index.md)：

- @.claude/rules/commands.md - 运行命令
- @.claude/rules/architecture.md - 架构概览
- @.claude/rules/main.md - 核心规范
- @.claude/rules/api.md - API 开发规范
- @.claude/rules/types.md - 类型定义规范
- @.claude/rules/ui.md - UI 组件规范
- @.claude/rules/testing.md - 测试规范
- @.claude/rules/fetch.md - 数据请求规范
- @.claude/rules/git.md - Git 提交规范
