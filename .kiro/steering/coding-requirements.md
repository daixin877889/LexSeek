# 编码要求

## 基本要求

1. 采用 bun 管理包
2. 类型定义放在 `shared/types` 目录中
3. 使用 shadcn-vue 构建前端页面，UI 组件的用法使用 shadcn 工具查询，
4. 不允许修改 app/components/ui 中的组件，这是 shadcn 的组件，重新安装可能会被覆盖。
5. 请注意，必须遵守 CLAUDE.md 中的项目架构文档和编码规范。
6. 生成的代需要添加简介明了的中文注释
7. 所有的代码实现都应该简洁明了，对人类程序员友好。
8. API 接口的参数验证统一使用 zod
9. Nuxt 有自动导入功能，如果发现实现的方法没有被自动导入，你应该首先执行 bun install 看是否成功导入，如果还是有问题，再排查其他问题。
10. tailwind 的版本是 v4 ,注意使用 v4 的语法和类名。
11. 前后端的日期处理都统一使用 dayjs 处理
12. API 接口返回成功使用 resSuccess: (event: H3Event<EventHandlerRequest>, message: string, data: any) => ApiBaseResponse 方法，失败使用 resError: (event: H3Event<EventHandlerRequest>, code: number, message: string) => ApiBaseResponse 方法，方法已经在框架中自己导入。
13. 当你生成的代码超过 500 行时，你应该要考虑将代码拆分成多个文件，避免单个文件代码过长。
14. 使用 shared/utils/decimalToNumber.ts 转换 prisma 的 decimal 类型。
15. 在生成代码时，你使用的方法、数据模型、字段等资源都需要确认存在，不能杜撰不存在的资源。
16. 尽量使用 prisma 官方文档中的类型，避免使用自定义的类型。

## 自动导入

Nuxt 4 配置了自动导入功能，以下内容无需手动 import：

### 服务端自动导入（server/ 目录）

**服务层函数**（`server/services/*/*`）：

- 所有 `server/services/` 子目录下的导出函数自动可用
- 包括：auth、campaign、encryption、files、membership、payment、point、product、rbac、redemption、sms、storage、system、users

**工具函数**（`server/utils/`）：

- `prisma` - Prisma 客户端实例
- `logger` - 日志工具
- `resSuccess(event, message, data)` - API 成功响应
- `resError(event, code, message)` - API 错误响应
- JWT、密码、OSS 等工具函数

**H3 框架函数**：

- `defineEventHandler` - 定义事件处理器
- `getQuery` - 获取查询参数
- `readBody` - 读取请求体
- `getHeader` - 获取请求头
- `setResponseStatus` - 设置响应状态码
- `getRouterParam` - 获取路由参数

## API 用户认证

在 API 接口中获取当前登录用户，必须使用 `event.context.auth?.user`，而不是 `event.context.user`：

```typescript
export default defineEventHandler(async (event) => {
    // ✅ 正确写法
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }
    
    // ❌ 错误写法（user 始终为 undefined）
    // const user = event.context.user
    
    // 使用 user.id 获取用户 ID
    const userId = user.id
})
```

**注意**：使用错误的写法会导致 API 始终返回 401 错误，前端 `useApi` 检测到 401 后会自动跳转到登录页。

### 前端自动导入（app/ 目录）

**Composables**（`app/composables/`）：

- `useApi` - 基于 useFetch 的 API 请求封装（支持 SSR）
- `useApiFetch` - 基于 $fetch 的 API 请求封装
- `useAgeCrypto` - Age 加密工具
- `useFileEncryption` - 文件加密
- `useFileDecryption` - 文件解密
- `useFileUploadWorker` - 文件上传 Worker
- `useUserNavigation` - 用户导航

**Store**（`store/`）：

- 所有 store 目录下的 Pinia store 自动导入

**Vue/Nuxt 核心**：

- `ref`, `reactive`, `computed`, `watch` 等 Vue 响应式 API
- `useState`, `useFetch`, `useRuntimeConfig` 等 Nuxt composables
- `navigateTo`, `useRoute`, `useRouter` 等路由函数

### 共享类型（`#shared/types/`）

类型定义需要手动导入，使用 `#shared` 别名：

```typescript
import { PaymentTransactionStatus } from "#shared/types/payment";
import type { UserMembershipInfo } from "#shared/types/membership";
```

### 注意事项

1. **不要重复导入**：自动导入的函数无需手动 import，否则会导致类型冲突
2. **类型推断**：Service 层函数返回类型建议让 TypeScript 自动推断，避免显式声明导致类型不匹配
3. **DAO 层关联查询**：如果 DAO 返回包含关联数据（如 `include: { level: true }`），Service 层不要显式声明返回类型
4. **排查导入问题**：如果自动导入不生效，先执行 `bun install` 重新生成类型声明
5. **Zod v4 API 变更**：`ZodError` 使用 `.issues` 而不是 `.errors` 访问验证错误列表

## OSS 回调

1. 回调自定义变量需要通过 `callbackVar` 参数传递，格式为 `{ key: value }`，注意 key 不能包含 `:` 字符，变量名不能包含大写。

## 测试规范
1. UI 测试使用 vibium 工具调用浏览器测试，如需登录，测试账号: 13064768490 密码: daixin88
2. 服务端测试使用 vitest 测试框架

### 目录结构

测试文件按功能模块组织在 `tests/server/` 目录下：

```
tests/server/
├── membership/     # 会员系统测试（级别、用户会员、积分、兑换码、营销活动）
├── storage/        # 存储系统测试（阿里云 OSS、签名、回调）
├── payment/        # 支付系统测试（适配器、状态转换）
├── crypto/         # 加密系统测试（元数据、解密）
└── utils/          # 工具函数测试（序列化等）
```

### 测试框架

- **vitest** - 测试运行器
- **fast-check** - 属性测试库（用于生成随机测试数据）

### 运行测试命令

```bash
# 运行所有服务端测试
bun run test:server

# 运行特定模块测试
bun run test:membership    # 会员模块
bun run test:storage       # 存储模块
bun run test:payment       # 支付模块
bun run test:crypto        # 加密模块
bun run test:utils         # 工具模块

# 运行单个测试文件
npx vitest run tests/server/membership/membership-level.test.ts --reporter=verbose
```

### 编写测试要求

1. 测试文件命名：`*.test.ts`
2. 测试描述使用中文
3. 每个测试文件顶部添加功能说明注释，包含 Feature 和 Validates 标注
4. 使用 `describe` 分组相关测试
5. 使用 `it` 描述具体测试用例
6. 属性测试使用 fast-check，配置 `{ numRuns: 100 }` 运行 100 次
7. 日期生成器需要过滤无效日期：`.filter(d => !isNaN(d.getTime()))`
8. 字典键生成器需要排除 JS 保留字：`['__proto__', 'constructor', 'prototype']`

### 测试文件模板

```typescript
/**
 * [功能名称]测试
 *
 * 使用 fast-check 进行属性测试，验证[功能描述]
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
        // 测试逻辑
        expect(value).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
```

### 模块 README 要求

每个测试模块目录下需要有 `README.md` 文件，包含：

- 模块说明
- 测试文件列表（表格形式）
- 测试用例详情
- 运行命令示例

### 注意事项

1. 每次完成新功能或修改已有功能时，需要创建或更新对应的测试用例
2. 先查看是否已存在对应测试用例，避免重复创建
3. 更新测试后需要同步更新模块 README.md
4. 业务代码中的临时调试代码在任务完成后必须清除
5. 构建前会自动运行测试（`prebuild` 脚本），确保测试通过后才能构建

## 终极规则

**你写的所有测试用例都需要是真正的单元测试，而不是一个模拟测试，涉及到数据库操作和网络请求之类的功能，你必须真实操作数据库和发起网络请求**
**你需要测试的实际的业务代码，而不是根据测试用例在测试脚本中实现对应功能**
