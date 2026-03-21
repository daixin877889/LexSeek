---
paths:
  - "tests/**"
---

# 测试规范

本项目使用 Vitest（非 Jest）。不要使用 jest.setTimeout() 或其他 Jest 专属 API。在 vitest.config.ts 中配置超时。

## 测试框架

- **vitest** - 测试运行器
- **fast-check** - 属性测试库
- **vibium** - UI 浏览器测试工具

## 环境配置

测试使用独立的测试数据库，配置如下：

- **环境变量文件**：`.env.testing`
- **测试数据库**：`ls_new_testing`（`postgresql://daixin:daixin88@localhost:5432/ls_new_testing`）
- **全局配置**：`vitest.config.ts` 中通过 `dotenv` 加载 `.env.testing`
- **测试账号**：`13064768490`，密码：`daixin88`

新模块添加测试时，需在对应的 `test-db-helper.ts` 中加载测试环境变量：

```typescript
import { config } from 'dotenv'
import { resolve } from 'node:path'

// 加载测试环境变量
config({ path: resolve(__dirname, '../../../../.env.testing') })
```

## 测试目录

```
tests/
├── server/
│   ├── membership/     # 会员系统测试
│   ├── storage/        # 存储系统测试
│   ├── payment/        # 支付系统测试
│   ├── crypto/         # 加密系统测试
│   ├── utils/          # 工具函数测试
│   └── services/       # 业务服务测试
```

## 测试模板

```typescript
/**
 * [功能名称]测试
 *
 * **Feature: [feature-name]**
 * **Validates: Requirements X.Y, X.Z**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

describe("[功能名称]", () => {
  it("[测试用例描述]", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (value) => {
        expect(value).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
```

## 编写要求

1. 文件命名：`*.test.ts`
2. 测试描述使用中文
3. 属性测试配置 `{ numRuns: 100 }`
4. 日期生成器过滤无效日期：`.filter(d => !isNaN(d.getTime()))`
5. 字典键排除保留字：`['__proto__', 'constructor', 'prototype']`

## 禁止模式

### ❌ 占位符测试
```typescript
// ❌ 错误
it('should work', () => {
  expect(true).toBe(true)
})
```

### ❌ ORM 代理测试
```typescript
// ❌ 错误 - Prisma 已被充分测试
it('should save user', async () => {
  const user = await prisma.user.create({ data: ... })
  expect(user.id).toBeDefined()
})

// ✅ 正确 - 测试自定义业务逻辑
it('should hash password before saving', async () => {
  const user = await userService.createUser(...)
  expect(user.password).not.toBe('plain_password')
})
```

### ❌ 脚本式测试
不使用 `process.exit()`、`console.log` 驱动的独立文件。

## 质量检查清单

- [ ] **独立性**：测试用例相互独立
- [ ] **清理**：副作用在 `afterEach` 或 `afterAll` 中清理
- [ ] **断言**：验证核心业务结果
- [ ] **覆盖**：覆盖快乐路径和边缘情况

## 终极规则

- 必须是真正的单元测试，不是模拟测试
- 涉及数据库操作和网络请求必须真实执行
- 测试实际业务代码，不在测试脚本中重新实现功能
- 测试完成必须清除测试数据，不允许残留测试数据
- 全量测试命令使用 `bun run test` 执行，不要使用 `bun test` 执行
- 修复 bug 时，应用修复后运行全量测试套件（vitest），所有 1586+ 测试必须通过后才能视为完成。