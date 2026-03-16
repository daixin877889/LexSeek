# 项目架构

## 技术栈

- **前端**: Nuxt 4 + Vue 3 + Tailwind CSS v4
- **UI**: Shadcn-vue
- **后端**: Nuxt Server (Nitro) + TypeScript
- **数据库**: PostgreSQL + Prisma ORM
- **包管理**: Bun
- **测试**: Vitest

## 目录结构

```
LexSeek/
├── app/                    # 前端应用
│   ├── components/         # Vue 组件
│   │   ├── ui/           # shadcn-vue 组件（禁止修改）
│   │   └── */            # 业务组件
│   ├── composables/       # 组合式函数
│   ├── pages/            # 页面路由
│   ├── layouts/          # 布局模板
│   ├── store/            # Pinia 状态管理
│   └── utils/           # 工具函数
├── server/               # 服务端 API
│   ├── api/             # API 路由 (v1)
│   ├── services/        # 业务逻辑层
│   ├── lib/             # 库文件 (payment, oss, storage)
│   ├── middleware/     # 中间件
│   └── utils/          # 工具函数
├── shared/              # 共享代码
│   ├── types/           # 类型定义
│   └── utils/          # 共享工具
├── prisma/              # 数据库模型
│   ├── models/         # 模块化模型
│   └── schema.prisma   # 主模式文件
└── tests/              # 测试用例
```

## 模块说明

| 模块 | 路径 | 说明 |
|------|------|------|
| app | /app | 前端页面、组件、UI库 |
| server | /server | API接口、服务端逻辑 |
| shared | /shared | 共享类型和工具 |
| prisma | /prisma | 数据库模式和迁移 |
| tests | /tests | 测试用例 |

## 响应格式

```typescript
// 成功
{ code: 200, message: '操作成功', data: any }

// 错误
{ code: 400, message: '错误信息' }
```
