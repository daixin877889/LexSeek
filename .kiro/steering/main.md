# 项目核心规范

## 语言要求
- 所有回复和对话使用中文（简体中文）
- 代码注释使用中文
- 技术术语可保留英文，但需提供中文解释
- 创建 Spec 文档时永远使用中文

## 基本编码规范
- 使用 bun 管理包
- 类型定义放在 `shared/types` 目录
- API 参数验证使用 zod
- 日期处理使用 dayjs
- 代码超过 500 行需拆分文件
- API 和 路由的 params 参数必须在最末尾
- 文件 mimetype 请使用项目已经配置好的 `mime` 方法
- 避免代码多层嵌套，
- **采用 TDD 开发模式，先编写单元测试，再写代码，代码完成后运行测试，确保代码通过单元测试。**
- **请注意：你需要编写的是生产级别的代码，不是 demo ，所以代码实现必须使用简洁且健壮的方案，严禁使用 demo 级别的简单实现。**

## 框架约定
- Nuxt 4 + Vue 3 + Tailwind v4
- Prisma ORM（Decimal 类型使用 `shared/utils/decimalToNumber.ts` 转换）
<!-- - 遵守 CLAUDE.md 中的项目架构文档 -->
- 在定义数据类型、方法、UI 组件时，需先查看项目中是否已有实现，如果有不要重复造轮子。公共数据结构放在 `shared/types` 目录，公共方法放在 `shared/utils` 目录。

## 自动导入
Nuxt 配置了自动导入，无需手动 import：
- 服务端：`prisma`、`logger`、`resSuccess`、`resError`、H3 函数
- 前端：Vue 响应式 API、Nuxt composables、Pinia stores
- 类型需手动导入：`import type { X } from "#shared/types/xxx"`

## 数据读取
- 如果要验证数据库的数据，你需要查找 postgres 的 docker 容器，进入容器后执行查询命令。

## spec 创建规范
- 创建前先查找现有 .kiro/specs 文件夹中是否有对应的 spec ,如果有，直接在现有的 spec 中新增需求、设计和任务，不要创建新 spac ,以保持相同功能的需求在同一个 spac 中管理。

## API 用户认证
```typescript
// ✅ 正确：event.context.auth?.user
const user = event.context.auth?.user

// ❌ 错误：event.context.user（始终 undefined）
```

## 专项文档索引
以下文档按需加载，在相关场景下自动生效：

| 场景 | 文档 | 触发条件 |
|------|------|---------|
| 编写测试 | `#testing` | 操作 `tests/**` 文件 |
| UI 组件开发 | `#ui-components` | 操作 `app/components/**` 或 `app/pages/**` 文件 |
| API 接口开发 | `#api-development` | 操作 `server/**` 文件 |
| 数据请求封装 | `#fetch` | 操作 `app/composables/**` 文件或涉及 useApi/useApiFetch |
