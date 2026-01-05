---
inclusion: fileMatch
fileMatchPattern: "**/tests/**"
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
tests/server/
├── membership/     # 会员系统测试
├── storage/        # 存储系统测试
├── payment/        # 支付系统测试
├── crypto/         # 加密系统测试
└── utils/          # 工具函数测试
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

## 终极规则
- **必须是真正的单元测试**，不是模拟测试
- 涉及数据库操作和网络请求必须真实执行
- 测试实际业务代码，不在测试脚本中重新实现功能
