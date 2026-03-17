# 运行命令

## 开发命令

```bash
bun install          # 安装依赖
bun dev             # 启动开发服务器
bun build           # 构建生产版本
bun preview         # 预览生产版本
```

## 测试命令

**重要**: 使用 `npx vitest run` 而非 `bun test`，因为 Nuxt 自动导入在 vitest 环境下才能正确解析。

```bash
npx vitest run           # 运行所有测试
npx vitest run tests/server/membership  # 会员模块
npx vitest run tests/server/storage     # 存储模块
npx vitest run tests/server/payment    # 支付模块
npx vitest run tests/server/rbac       # RBAC 模块
```

## Prisma 命令

```bash
bun run prisma:studio     # 打开数据库管理界面
bun run prisma:generate  # 生成 Prisma 客户端
bun run prisma:push      # 推送模式到数据库
bun run prisma:migrate   # 运行数据库迁移
```

## 常用开发命令

```bash
# 单个测试文件
npx vitest run tests/server/xxx.test.ts --reporter=verbose
```
