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

## 框架约定
- Nuxt 4 + Vue 3 + Tailwind v4
- Prisma ORM（Decimal 类型使用 `shared/utils/decimalToNumber.ts` 转换）
- 遵守 CLAUDE.md 中的项目架构文档

## 自动导入
Nuxt 配置了自动导入，无需手动 import：
- 服务端：`prisma`、`logger`、`resSuccess`、`resError`、H3 函数
- 前端：Vue 响应式 API、Nuxt composables、Pinia stores
- 类型需手动导入：`import type { X } from "#shared/types/xxx"`

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
