# LexSeek - 法律服务AI应用


## 项目

LexSeek 是一个全栈法律服务AI应用，旨在通过人工智能技术赋能法律分析，为律师提供全面的案件分析工具，提升工作效率。
这是一个 Nuxt/Vue 3 + NestJS + Prisma + PostgreSQL 项目，使用 TypeScript。数据库时区为 Asia/Shanghai。Prisma 连接使用 TimeZone=UTC 以避免双偏移 bug。

**这是一个生产级别的项目，不是 Demo，请保证代码的质量，尤其健壮性和可维护性**

## 技术栈

- **前端**: Nuxt 4 + Vue 3 + Tailwind CSS v4
- **UI**: Shadcn-vue
- **后端**: Nuxt Server (Nitro) + TypeScript
- **数据库**: PostgreSQL + Prisma ORM ; 本地开发的环境的数据库运行在 Docker 中
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

规范文件位于 `.claude/rules/` 目录，按需自动加载（通过 paths frontmatter 限定范围）：

| 规范 | 适用范围 |
|------|---------|
| commands.md | 全局 |
| architecture.md | 全局 |
| main.md | 全局 |
| git.md | 全局 |
| types.md | 全局 |
| api.md | server/** |
| ui.md | app/components/**, app/**/*.vue |
| testing.md | tests/** |
| fetch.md | app/** |

## 技术文档

详细的模块级技术文档（架构、实现、踩坑记录）位于 docs/tech-docs/ 目录：

@docs/tech-docs/README.md

## 文档规范

**langchain 的最新文档地址：https://docs.langchain.com/llms.txt 有关于 langchain langgraph deepagent langsmith 等最新文档楼需要从这里获取， 有可能会遇到文档未及时更新的问题，你可以看源码，除非前两种方法找不到答案，你才可以通过网络搜索相关信息**

**每次完成编码后都使用 `simplify` 技能优化代码**
**用 `npx nuxi typecheck` 而不是 `tsc` 检查类型错误**

## AI 必须遵守的规则
1. 不许修改客户的需求，例如在遇到问题时使用改变原始需求的回退方案，你可以建议，但必须得到客户的同意才能修改
2. 设计任何的功能之前，都必须检查项目中是否已有相关实现，**严禁重复造轮子**
3. **管理端与用户端 API 必须物理隔离（系统级设计规则）**
   - 用户端接口：路径位于 `server/api/v1/**`（非 `admin/`），**严格** owner-only / viewer 维度过滤，**不允许在内部通过 `checkIsSuperAdmin` 等方式为超管开旁路**。超管走用户端和普通用户行为完全一致。
   - 管理端接口：路径位于 `server/api/v1/admin/**`，由 `server/middleware/03.permission.ts` 统一拦截（非 super_admin 一律 403），内部可访问任意资源、不做归属校验。
   - 同一业务资源如果两端都要操作，**必须分别实现两套接口**（成对出现：`POST/GET/PATCH/DELETE`），不得用 "一个接口里分支判断 isAdmin" 的方式混用。
   - 前端页面按身份调用对应的那一套：`/dashboard/**` 页面只调用户端接口；`/admin/**` 页面只调管理端接口。
   - 参考实现：`server/api/v1/assistant/document/templates*` 与 `server/api/v1/admin/document-templates/**`。

## 终极规则
**无论是在新功能开发还是排查 bug ，你都需要遵守先思考，再编码，再测试的步骤，不允许通过你自身的知识库猜测，必须要通过了解项目代码或者搜索相关文档获取到足够上下文再开始编写代码**
