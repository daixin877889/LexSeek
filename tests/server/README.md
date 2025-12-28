# 服务端测试

本目录包含所有服务端测试用例，按功能模块组织。

## 测试覆盖率

当前整体覆盖率：**97.19%**

| 模块 | 语句覆盖率 | 分支覆盖率 | 函数覆盖率 |
|------|-----------|-----------|-----------|
| server/lib/oss | 96.93% | 85.49% | 100% |
| server/lib/payment | 100% | 100% | 100% |
| server/lib/payment/adapters | 99.19% | 82.45% | 100% |
| server/lib/storage | 97.83% | 87.93% | 100% |
| server/utils | 93.75% | 70.58% | 100% |

## 目录结构

```
tests/server/
├── api/            # API 集成测试（12个文件）
├── auth/           # 认证模块测试（1个文件）
├── crypto/         # 加密系统测试（1个文件）
├── membership/     # 会员系统测试（16个文件）
├── payment/        # 支付系统测试（4个文件）
├── rbac/           # RBAC 权限模块测试（1个文件）
├── sms/            # 短信验证码模块测试（1个文件）
├── storage/        # 存储系统测试（14个文件）
├── system/         # 系统配置模块测试（1个文件）
├── users/          # 用户模块测试（1个文件）
└── utils/          # 工具函数测试（3个文件）
```

## 模块说明

| 模块 | 说明 | 测试文件数 |
|------|------|-----------|
| [api](./api/README.md) | API 集成测试，发送真实 HTTP 请求测试所有 API 端点 | 12 |
| [auth](./auth/README.md) | 认证令牌服务、Token 黑名单 | 1 |
| [crypto](./crypto/README.md) | 文件加密元数据、解密输出格式 | 1 |
| [membership](./membership/README.md) | 会员级别、用户会员、积分、兑换码、营销活动等 | 16 |
| [payment](./payment/README.md) | 支付适配器、状态转换、订单一致性 | 4 |
| [rbac](./rbac/README.md) | 角色管理、用户角色关联、路由权限 | 1 |
| [sms](./sms/README.md) | 短信验证码创建、验证、锁定机制 | 1 |
| [storage](./storage/README.md) | 阿里云 OSS 集成、签名、回调处理 | 14 |
| [system](./system/README.md) | 系统配置查询、分页、配置组管理 | 1 |
| [users](./users/README.md) | 用户 CRUD、查询、资料更新 | 1 |
| [utils](./utils/README.md) | 密码、JWT、数据序列化等通用工具函数 | 3 |

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
bun run test:api

# 运行新增模块测试
npx vitest run tests/server/auth --reporter=verbose
npx vitest run tests/server/users --reporter=verbose
npx vitest run tests/server/sms --reporter=verbose
npx vitest run tests/server/system --reporter=verbose
npx vitest run tests/server/rbac --reporter=verbose
npx vitest run tests/server/api --reporter=verbose

# 运行单个测试文件
npx vitest run tests/server/membership/membership-level.test.ts --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/server --coverage

# 监听模式（开发时使用）
npx vitest tests/server
```

## 测试框架

- **vitest** - 测试运行器
- **fast-check** - 属性测试库

## 编写测试规范

1. 测试文件命名：`*.test.ts`
2. 测试描述使用中文
3. 每个测试文件顶部添加功能说明注释，包含 Feature 和 Validates 标注
4. 使用 `describe` 分组相关测试
5. 使用 `it` 描述具体测试用例
6. 属性测试使用 fast-check，配置 `{ numRuns: 100 }` 运行 100 次
7. **所有测试必须使用真实数据库操作，禁止使用模拟**

## 测试原则

### ✅ 正确做法（调用实际业务函数）

```typescript
// 导入实际的业务函数
import { createUserDao, findUserByIdDao } from '../../../server/services/users/users.dao'
import { verifySmsCode } from '../../../server/services/sms/smsVerification.service'

// 调用实际的业务函数进行测试
const user = await createUserDao({ name: '测试', phone: '13800138000', password: 'hash' })
const found = await findUserByIdDao(user.id)
expect(found?.id).toBe(user.id)
```

### ❌ 错误做法（模拟实现）

```typescript
// 测试文件中自己直接操作数据库
await prisma.users.create({ data: { ... } })

// 测试文件中自己实现业务逻辑
const isValid = code === '123456'
```

## 未覆盖说明

以下代码未覆盖属于防御性编程或暂不接入的功能：

- `server/lib/oss/index.ts` - 仅包含 re-export 语句
- `server/utils/jwt.ts` 第 54, 74-77 行 - 防御性错误处理分支
- `qiniu.ts` 和 `tencent-cos.ts` - 暂不接入的云存储适配器
