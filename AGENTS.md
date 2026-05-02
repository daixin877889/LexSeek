# LexSeek - 法律服务AI应用


## 项目

LexSeek 是一个全栈法律服务 AI 应用，通过 AI 赋能法律分析。
项目基于 Nuxt 4（Nitro 服务端）+ Vue 3 + Prisma + PostgreSQL，全栈使用 TypeScript。数据库时区为 Asia/Shanghai；Prisma 连接强制 `TimeZone=UTC` 以避免双偏移 bug。

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
| database.md | 全局 |
| api.md | server/** |
| ui.md | app/components/**, app/pages/**, app/**/*.vue |
| testing.md | tests/** |
| fetch.md | app/** |
| tech-docs.md | server/services/**, server/lib/**, prisma/** |
| tech-docs-frontend.md | app/components/**, app/composables/**, app/store/**, app/layouts/**, app/pages/** |
| agent-platform.md | server/services/agent-platform/**, server/agents/**, server/services/memory/** |

## 技术文档

详细的模块级技术文档（架构、实现、踩坑记录）位于 docs/tech-docs/ 目录：

@docs/tech-docs/README.md

## 文档规范

**langchain 的最新文档地址：https://docs.langchain.com/llms.txt 有关于 langchain langgraph deepagent langsmith 等最新文档需要从这里获取，有可能会遇到文档未及时更新的问题，你可以看源码，除非前两种方法找不到答案，你才可以通过网络搜索相关信息**

**每次完成编码后都使用 `simplify` 技能优化代码**
**用 `npx nuxi typecheck` 而不是 `tsc` 检查类型错误**

## AI 必须遵守的规则
1. 不许修改客户的需求，例如在遇到问题时使用改变原始需求的回退方案，你可以建议，但必须得到客户的同意才能修改
2. 设计任何的功能之前，都必须检查项目中是否已有相关实现，**严禁重复造轮子**
3. **系统 UI 严禁使用 emoji 图标**——所有图标统一使用 `lucide-vue-next` 的 SVG 组件
4. **用产品经理视角沟通，避免技术黑话**——对话对象默认是产品经理 / 业务方，讨论需求和设计用业务语言（用户动作、界面位置、前后效果对比），不暴露组件名 / 服务类名 / 字段名等技术细节；汇报进展讲"用户能感知到的变化"而非"改了哪个文件"
5. **管理端与用户端 API 必须物理隔离**——`server/api/v1/admin/**` 与 `server/api/v1/**` 成对实现，不在同一接口里通过 `checkIsSuperAdmin` 开旁路

## 终极规则
**无论是在新功能开发还是排查 bug ，你都需要遵守先思考，再编码，再测试的步骤，不允许通过你自身的知识库猜测，必须要通过了解项目代码或者搜索相关文档获取到足够上下文再开始编写代码**
