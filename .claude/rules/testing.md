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

### 并发污染测试调试指引

症状：**单跑测试文件 `npx vitest run <file>` 通过，但全量 `bun run test` 跑该文件 fail**。

诊断 3 步：

```bash
# 1. 单跑确认 isolated 通过
npx vitest run tests/server/foo/bar.test.ts

# 2. 跑同目录子集，定位是不是同目录污染
npx vitest run tests/server/foo/

# 3. 二分跑相邻目录寻找污染源
npx vitest run tests/server/foo/ tests/server/baz/
```

3 类常见根因 + 修复套路：

**类型 A：vi.mock 的 module 状态被前面文件污染（mock 残留）**

症状：fail 测试做的是 mock fn assertion（`expect(mockFn).toHaveBeenCalled()`），mock 行为不符合预期。

修复：在 `beforeEach` 用 `vi.resetModules()` + `vi.clearAllMocks()` 强制重置：

```typescript
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()  // 必要时重置 module cache
})
```

**类型 B：数据残留导致 unique 约束冲突**

症状：`prisma.X.create` 抛 `Unique constraint failed`。

修复：测试创建数据时**强制带 timestamp + random 后缀**，避免与前面测试残留数据冲突：

```typescript
// ❌ 错误：固定 name
await prisma.users.create({ data: { phone: '13900000001' } })

// ✅ 正确：动态 name
await prisma.users.create({
  data: { phone: `199${Date.now().toString().slice(-8)}` }
})
```

**类型 C：跨表 FK 残留导致清理失败**

症状：`afterEach` cleanup 时报 `violates foreign key constraint`。

修复：在 `afterEach` 反向（叶表→父表）按 `createdIds` 数组 delete：

```typescript
const createdIds = { users: [], cases: [], materials: [] }

afterEach(async () => {
  // 叶表先删
  await prisma.caseMaterials.deleteMany({ where: { id: { in: createdIds.materials } } })
  await prisma.cases.deleteMany({ where: { id: { in: createdIds.cases } } })
  await prisma.users.deleteMany({ where: { id: { in: createdIds.users } } })
  createdIds.users = []
  createdIds.cases = []
  createdIds.materials = []
})
```

### 全局 fail 但不修的处理

如果某个测试 fail 是 mock 测试本身的 bug（如 ReadableStream / 非数据库错误），**与并发隔离无关**，记录到 `tests/KNOWN_FAILS.md` 并由测试 owner 修复，不阻塞本提速基础设施。

## CI 接入

测试基础设施依赖 3 件事：(1) 一个含 pgvector / pg_trgm / zhparser 扩展的 PG，(2) `ls_new_testing` 源数据库已迁移 + seed，(3) 用 superuser 账号连接（globalSetup 要 CREATE/DROP DATABASE）。

### 前置条件（CI runner 上）

```bash
# 1. 启动 Postgres（复用 docker-compose.dev.yml 里的 pgvector 镜像）
docker-compose -f docker-compose.dev.yml up -d postgres

# 2. 等健康检查通过
until docker-compose -f docker-compose.dev.yml ps postgres | grep -q "healthy"; do sleep 2; done

# 3. 准备 .env.testing（凭据用 CI secret 注入，本地照抄 README 配置）
echo "DATABASE_URL=postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC" >> .env.testing

# 4. 创建源测试库 + 跑迁移 + 跑 seed
docker exec postgres-postgres-1 psql -U daixin -d postgres -c "CREATE DATABASE ls_new_testing"
bun run db:setup
```

### 跑测试

```bash
# 全量并行（默认 4 worker）
bun run test

# 调整并发度（CPU 充足时可拉到 6-8）
VITEST_MAX_WORKERS=8 bun run test
```

### 关键点

- **CI 不需要 `bun run dev`**：测试连的是 `ls_test_w<id>` 而非 `ls_new`（开发库），互不干扰
- **每次测试启动自动 DROP 残留 worker DB**：CI 可以反复跑无残留
- **CI 失败时不需要手动清理**：teardown 在 `vitest` 进程退出前 DROP 所有 `ls_test_w*`；即便 CI runner 强杀进程，下次跑会再 drop
- **多个 CI job 同时跑同一台 runner**：必须用不同 PG 容器或不同 dbname 前缀（当前实现把所有 worker DB 命名为 `ls_test_w<n>`，没有 job-id 隔离）

### GitHub Actions 示例（项目暂未启用，仅供参考）

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      # 项目自定义 PG 镜像含 vector + pg_trgm + zhparser，docker/postgres/Dockerfile 自建
      # 测试方案要求 PG 含 scws + zhparser，纯 pgvector/pg17 不够
      - name: Build & start postgres
        run: |
          docker build -t lexseek-postgres:ci docker/postgres/
          docker run -d --name pg \
            -e POSTGRES_USER=daixin -e POSTGRES_PASSWORD=daixin88 \
            -p 5432:5432 lexseek-postgres:ci
          until docker exec pg pg_isready -U daixin; do sleep 2; done
      - run: bun install --frozen-lockfile
      - name: Prepare test database
        run: |
          echo "DATABASE_URL=postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC" >> .env.testing
          docker exec pg psql -U daixin -d postgres -c "CREATE DATABASE ls_new_testing"
          bun run db:setup
      - run: VITEST_MAX_WORKERS=4 bun run test
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

- 编写的测试用例必须是真正的单元测试，不是模拟测试
- 涉及数据库操作和网络请求必须真实执行
- 测试实际业务代码，不在测试脚本中重新实现功能
- server 和 shared 的测试覆盖率必须达到 90% 以上
- 测试完成必须清除测试数据，不允许残留测试数据，每次测试完成都需要检查数据库是否有残留测试数据。
- 全量测试命令使用 `bun run test` 执行，不要使用 `bun test` 执行
- 修复 bug 时，修复后先运行单元测试，确保修复完成，确认后运行全量测试套件（vitest），所有测试必须通过后才能视为完成。
- E2E 测试优先使用 `chrome-devtools` 调用浏览器