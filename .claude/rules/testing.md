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

测试使用独立的测试数据库 + worker 级 DB 隔离：

- **环境变量文件**：`.env.testing`
- **源测试库**：`ls_new_testing`（`postgresql://daixin:daixin88@localhost:5432/ls_new_testing`）—— 维护 schema + seed 的"模板源"，**不会被测试代码直接连**
- **Worker 级 DB**：每个 vitest worker 启动时，`tests/_infra/global-setup.ts` 通过 `CREATE DATABASE ls_test_w<id> TEMPLATE ls_new_testing` 物理拷贝出独立 DB（PG buffer 级，~200ms/库）
- **测试代码连接**：`tests/_infra/worker-setup.ts` 在每个 worker 进程启动时改写 `process.env.DATABASE_URL` 为 `ls_test_w<id>`，并设置 `globalThis.prisma`；业务代码 `import { prisma } from '~~/server/utils/db'` 自动拿到 worker 专属客户端
- **测试账号**：`13064768490`，密码：`daixin88`（每个 worker DB 都有，互不冲突）
- **配置文件**：`vitest.config.ts` 顶部通过 `dotenv` 加载，`globalSetup`/`setupFiles` 各自再加载一次

### Worker DB 生命周期

```
vitest 启动
  ↓
master 进程跑 globalSetup（tests/_infra/global-setup.ts）
  ├─ DROP 上次残留的 ls_test_w*
  ├─ 校验 ls_new_testing 无活跃连接
  └─ 并行 CREATE DATABASE ls_test_w1..N TEMPLATE ls_new_testing
  ↓
4 个 fork worker 启动，各自加载 setupFiles（tests/_infra/worker-setup.ts）
  ├─ 改写 process.env.DATABASE_URL 为 ls_test_w<VITEST_POOL_ID>
  ├─ getWorkerPrisma() 创建 PrismaClient
  └─ globalThis.prisma = workerPrisma
  ↓
测试文件加载、跑测试
  ↓
所有测试结束 → master 跑 globalSetup 返回的 teardown → DROP 所有 ls_test_w*
```

### 修改 schema 后流程

业务流程不变：跑 `bun run prisma:migrate` 或 `bun run prisma:push`（更新源 `ls_new_testing`），下次跑 `bun run test` 时 globalSetup 会用最新的 schema 重新拷贝出 worker DB。

### 编写带 DB 操作的测试

直接 `import { prisma } from '~~/server/utils/db'` 即可，**无需关心 worker DB**：

```typescript
import { prisma } from '~~/server/utils/db'

it('应成功创建会员级别', async () => {
  const level = await prisma.membershipLevels.create({ data: { name: '测试_' + Date.now() } })
  // 测试结束后，worker DB 整体被 DROP，不需要手动 cleanup
  // 但同 worker 内多个 test 文件**串行**共享同一 DB——afterEach 仍需清理本测试文件的数据
})
```

### 已知限制

- **同 worker 内测试串行共享 DB**：4 个 worker DB，但 vitest 把 N 个测试文件分配到 N/4 个 worker 内串行跑。如果同 worker 内 fileA 没清理干净，fileB 可能受污染。仍需在 `afterEach` / `afterAll` 清理本测试创建的数据。
- **`bun run prisma:migrate` 必须 commit 到 prisma/migrations/**：见 `.claude/rules/database.md`，源 DB 也是这套流程同步的。

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

- 编写的测试用例必须是真正的单元测试，不是模拟测试
- 涉及数据库操作和网络请求必须真实执行
- 测试实际业务代码，不在测试脚本中重新实现功能
- server 和 shared 的测试覆盖率必须达到 90% 以上
- 测试完成必须清除测试数据，不允许残留测试数据，每次测试完成都需要检查数据库是否有残留测试数据。
- 全量测试命令使用 `bun run test` 执行，不要使用 `bun test` 执行
- 修复 bug 时，修复后先运行单元测试，确保修复完成，确认后运行全量测试套件（vitest），所有测试必须通过后才能视为完成。
- E2E 测试优先使用 `chrome-devtools` 调用浏览器