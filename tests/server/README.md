# 服务端测试

本目录包含所有服务端测试用例，按功能模块组织。

## 目录结构

```
tests/server/
├── membership/     # 会员系统测试（16个文件）
├── storage/        # 存储系统测试（6个文件）
├── payment/        # 支付系统测试（1个文件）
├── crypto/         # 加密系统测试（1个文件）
└── utils/          # 工具函数测试（1个文件）
```

## 模块说明

| 模块 | 说明 | 测试文件数 |
|------|------|-----------|
| [membership](./membership/README.md) | 会员级别、用户会员、积分、兑换码、营销活动等 | 16 |
| [storage](./storage/README.md) | 阿里云 OSS 集成、签名、回调处理 | 6 |
| [payment](./payment/README.md) | 支付适配器、状态转换、订单一致性 | 1 |
| [crypto](./crypto/README.md) | 文件加密元数据、解密输出格式 | 1 |
| [utils](./utils/README.md) | 数据序列化等通用工具函数 | 1 |

## 运行测试

```bash
# 运行所有服务端测试
bun run test:server

# 运行特定模块测试
bun run test:membership
bun run test:storage
bun run test:payment
bun run test:crypto
bun run test:utils

# 运行单个测试文件
npx vitest run tests/server/membership/membership-level.test.ts --reporter=verbose

# 监听模式（开发时使用）
npx vitest tests/server
```

## 测试框架

- **vitest** - 测试运行器
- **fast-check** - 属性测试库

## 编写测试规范

1. 测试文件命名：`*.test.ts`
2. 测试描述使用中文
3. 每个测试文件顶部添加功能说明注释
4. 使用 `describe` 分组相关测试
5. 使用 `it` 描述具体测试用例
