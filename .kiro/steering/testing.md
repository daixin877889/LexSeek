---
inclusion: fileMatch
fileMatchPattern: "tests/**"
---
# 测试规范

## 测试框架
- **vitest** - 测试运行器
- **fast-check** - 属性测试库
- **vibium** - UI 浏览器测试工具

## 测试账号
UI 测试登录账号：`13064768490` 密码：`daixin88`

## 目录结构
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

## 运行命令
```bash
bun run test:server          # 所有服务端测试
bun run test:membership      # 会员模块
bun run test:storage         # 存储模块
bun run test:payment         # 支付模块
bun run test:crypto          # 加密模块
bun run test:utils           # 工具模块

# 单个文件
npx vitest run tests/server/xxx.test.ts --reporter=verbose
```

## 编写要求
1. 文件命名：`*.test.ts`
2. 测试描述使用中文
3. 文件顶部添加 Feature 和 Validates 标注
4. 属性测试配置 `{ numRuns: 100 }`
5. 日期生成器过滤无效日期：`.filter(d => !isNaN(d.getTime()))`
6. 字典键排除保留字：`['__proto__', 'constructor', 'prototype']`

## 测试文件模板
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

## 测试质量标准 (Quality Standards)

### 反模式 (Anti-Patterns) - 禁止出现

#### ❌ 占位符测试 (The Placeholder)
**现象**：测试文件中只包含 `expect(true).toBe(true)`。
**问题**：提供虚假的测试覆盖率，掩盖未测试的功能。
**修正**：要么编写真实的测试用例，要么删除测试文件（或使用 `.todo` 标记）。

```typescript
// ❌ 错误示例
it('should work', () => {
  expect(true).toBe(true)
})

// ✅ 正确示例
it.todo('should calculate price correctly')
```

#### ❌ ORM 代理测试 (The ORM Proxy)
**现象**：测试用例仅仅验证 Prisma 是否能存取数据，没有业务逻辑。
**问题**：Prisma 已经被充分测试过，我们不需要测试 ORM 本身。
**修正**：测试 Service 层或 DAO 层中包含的**自定义逻辑**（如事务、数据转换、复杂查询条件）。

```typescript
// ❌ 错误示例
it('should save user', async () => {
  const user = await prisma.user.create({ data: ... })
  expect(user.id).toBeDefined()
})

// ✅ 正确示例
it('should hash password before saving', async () => {
  const user = await userService.createUser(...)
  expect(user.password).not.toBe('plain_password')
})
```

#### ❌ 脚本式测试 (The Script)
**现象**：使用 `process.exit()`、`console.log` 驱动的独立 TS 文件，不使用 `vitest` 结构。
**问题**：无法被测试运行器管理，无法生成报告，难以维护。
**修正**：重构为标准的 Vitest 测试文件（`describe`, `it`, `expect`）。

### 测试质量检查清单 (Checklist)

在提交代码前，请检查：

- [ ] **独立性**：测试用例是否相互独立？（不依赖执行顺序）
- [ ] **清理**：测试产生的副作用（数据库记录、临时文件）是否在 `afterEach` 或 `afterAll` 中清理？
- [ ] **断言**：是否验证了核心业务结果，而不仅仅是"不报错"？
- [ ] **覆盖**：是否覆盖了快乐路径（Happy Path）和边缘情况（Edge Cases）？
- [ ] **描述**：`it` 的描述是否清晰表达了预期行为？

## 终极规则
- **必须是真正的单元测试**，不是模拟测试
- 涉及数据库操作和网络请求必须真实执行
- 测试实际业务代码，不在测试脚本中重新实现功能
- 如果要验证数据库的数据，你需要查找 postgres 的 docker 容器，进入容器后执行查询命令。
