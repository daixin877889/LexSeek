# 运行命令

## 开发命令

```bash
bun install          # 安装依赖
bun dev             # 启动开发服务器
bun build           # 构建生产版本
bun preview         # 预览生产版本
```

## 测试命令

```bash
bun test            # 运行所有测试
bun test:ui        # UI 模式运行测试
bun test:server    # 所有服务端测试
bun test:membership # 会员模块
bun test:storage   # 存储模块
bun test:payment   # 支付模块
bun test:crypto    # 加密模块
bun test:utils     # 工具模块
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
