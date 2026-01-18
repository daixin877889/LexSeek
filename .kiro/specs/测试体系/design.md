# 设计文档

## 概述

本设计文档描述了 LexSeek 测试体系的技术方案。

## 架构

### 目录结构

```
tests/
├── server/                    # 服务端测试
│   ├── [module].test.ts       # 单元测试
│   └── [module]-integration.test.ts # 集成测试
└── setup.ts                   # 测试配置
```

## 测试策略

### 单元测试

- 测试 Service 层业务逻辑
- 测试工具函数
- 使用 mock 隔离依赖

### 集成测试

- 测试 API 接口
- 测试完整业务流程
- 使用测试数据库

### 属性测试

- 使用 fast-check 库
- 测试核心业务逻辑
- 每个测试至少 100 次迭代

## 测试质量保证

### 测试反模式识别

#### 反模式 1：占位符测试
```typescript
// ❌ 错误：没有实际验证
it('应该验证某个逻辑', () => {
    expect(true).toBe(true)
})

// ✅ 正确：验证实际逻辑
it('应该验证某个逻辑', () => {
    const result = myFunction(input)
    expect(result).toBe(expectedOutput)
})
```

#### 反模式 2：测试 ORM 而非业务逻辑
```typescript
// ❌ 错误：测试数据库能否工作
it('应该创建记录', async () => {
    const record = await prisma.table.create({ data: {...} })
    expect(record.field).toBe('value')
})

// ✅ 正确：测试业务服务方法
it('应该创建记录', async () => {
    const result = await myService.createRecord(input)
    expect(result.success).toBe(true)
    expect(result.data.field).toBe('expectedValue')
})
```

#### 反模式 3：非标准测试文件
```typescript
// ❌ 错误：脚本式测试
async function test() {
    // ... 测试逻辑
    if (failed) process.exit(1)
}
test()

// ✅ 正确：标准 Vitest 测试
describe('功能测试', () => {
    it('应该满足某个条件', async () => {
        const result = await testFunction()
        expect(result).toBe(expected)
    })
})
```

### 测试质量检查清单

在编写或审查测试时，确保：

1. **测试目标明确**
   - 每个测试文件开头有清晰的注释说明测试目标
   - 测试用例名称清晰描述被测试的行为

2. **测试真实逻辑**
   - 测试调用实际的业务方法，而不是直接操作数据库
   - 使用 mock/stub 隔离外部依赖（数据库、API、文件系统等）

3. **测试结构标准**
   - 使用 `describe` 和 `it` 组织测试
   - 使用 `beforeEach`/`afterEach` 管理测试状态
   - 避免使用 `process.exit()` 等非测试框架的控制流

4. **断言有意义**
   - 避免 `expect(true).toBe(true)` 这样的无意义断言
   - 断言验证实际的业务结果，而不是中间状态

### 测试文件清理策略

对于问题测试文件，采用以下策略：

1. **占位符测试**：删除或完全重写
2. **ORM 测试**：改为测试业务服务方法，使用 mock 隔离数据库
3. **脚本式测试**：改为标准 Vitest 测试文件，或移到 `scripts/` 目录

## 实现状态

- 单元测试、集成测试、属性测试：已完成实现和测试
- 测试质量保证：待实现

### 相关文件

- `tests/server/*.test.ts`
- `vitest.config.ts`
