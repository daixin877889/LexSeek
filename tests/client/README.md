# 客户端测试

本目录包含前端客户端代码的单元测试。

## 目录结构

```
tests/client/
├── composables/   # Composables 测试
├── lib/           # 工具库测试
├── store/         # Pinia Store 测试
├── utils/         # 工具函数测试
└── README.md      # 本文档
```

## 测试模块

| 目录 | 说明 | 测试文件数 |
|------|------|-----------|
| `composables/` | Vue Composables | 6 |
| `lib/` | 工具库（cn 函数等） | 1 |
| `store/` | Pinia 状态管理 | 1 |
| `utils/` | 工具函数 | 2 |

## 测试文件列表

### composables/ - Composables 测试

| 文件 | 说明 | 测试用例数 |
|------|------|-----------|
| `useAgeCrypto.test.ts` | Age 加密核心功能 | 8 |
| `useApi.test.ts` | API 请求封装核心逻辑 | 9 |
| `useFileDecryption.test.ts` | 文件解密状态管理 | 17 |
| `useFileEncryption.test.ts` | 文件加密状态管理 | 14 |
| `useFileUploadWorker.test.ts` | 文件上传 Worker | 14 |
| `useUserNavigation.test.ts` | 用户导航逻辑 | 15 |

### lib/ - 工具库测试

| 文件 | 说明 | 测试用例数 |
|------|------|-----------|
| `utils.test.ts` | cn 函数（tailwind-merge + clsx） | 24 |

### store/ - Pinia Store 测试

| 文件 | 说明 | 测试用例数 |
|------|------|-----------|
| `alertDialog.test.ts` | 全局确认对话框状态管理 | 14 |

### utils/ - 工具函数测试

| 文件 | 说明 | 测试用例数 |
|------|------|-----------|
| `auth.test.ts` | 认证工具（token 存储、登录状态） | 17 |
| `file.test.ts` | 文件工具（类型判断、图标颜色） | 54 |

## 运行测试

```bash
# 运行所有客户端测试
bun run test:client

# 运行特定测试文件
npx vitest run tests/client/utils/file.test.ts --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/client --coverage
```

## 测试框架

- **vitest** - 测试运行器
- **fast-check** - 属性测试库
- **pinia** - 状态管理测试支持

## 注意事项

1. 客户端测试需要模拟浏览器环境（localStorage 等）
2. Pinia Store 测试需要在每个测试前创建新的 Pinia 实例
3. 使用 `vi.stubGlobal` 模拟全局变量
4. 属性测试配置 `{ numRuns: 100 }` 运行 100 次
