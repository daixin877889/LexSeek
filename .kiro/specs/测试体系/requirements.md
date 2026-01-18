# 需求文档

## 简介

本文档定义了 LexSeek 测试体系相关需求。

本文档整合自以下原始 spec：
- api-integration-tests（API 集成测试）
- server-test-coverage（服务端测试覆盖）
- test-coverage-improvement（测试覆盖改进）
- test-refactoring（测试重构）

## 需求

### 需求 1：单元测试

**用户故事：** 作为开发者，我希望有完善的单元测试。

#### 验收标准

1. THE System SHALL 为 Service 层编写单元测试
2. THE System SHALL 为工具函数编写单元测试
3. THE System SHALL 达到 80% 以上的代码覆盖率

### 需求 2：集成测试

**用户故事：** 作为开发者，我希望有完善的集成测试。

#### 验收标准

1. THE System SHALL 为 API 接口编写集成测试
2. THE System SHALL 测试完整的业务流程
3. THE System SHALL 使用测试数据库

### 需求 3：属性测试

**用户故事：** 作为开发者，我希望使用属性测试验证核心逻辑。

#### 验收标准

1. THE System SHALL 使用 fast-check 进行属性测试
2. THE System SHALL 为核心业务逻辑编写属性测试
3. THE System SHALL 每个属性测试至少运行 100 次

### 需求 4：测试质量保证

**用户故事：** 作为开发者，我希望所有测试都能真实验证业务逻辑，而不是"假测试"。

#### 验收标准

1. THE System SHALL NOT 包含只有 `expect(true).toBe(true)` 的占位符测试
2. THE System SHALL NOT 包含只测试 Prisma ORM 而不测试业务逻辑的测试
3. THE System SHALL NOT 包含非标准测试文件（不使用 describe/it 结构的脚本）
4. THE System SHALL 确保每个测试都验证实际的业务逻辑
5. THE System SHALL 使用 mock 或 stub 来隔离外部依赖，而不是直接操作数据库来验证数据库功能
6. THE System SHALL 为每个测试文件提供清晰的测试目标说明

#### 问题测试文件清单

以下测试文件需要修复或删除：

1. **`tests/server/services/material/ocr-logic.test.ts`**
   - 问题：所有测试用例只有 `expect(true).toBe(true)`，没有实际验证逻辑
   - 严重程度：高
   - 建议：删除或完全重写

2. **`tests/server/case/caseMaterialEmbedding.simple.test.ts`**
   - 问题：测试 Prisma 数据库操作而非业务逻辑
   - 严重程度：高
   - 建议：删除或改为测试实际的业务服务方法

3. **`tests/server/material/test-embedding-status-on-create.ts`**
   - 问题：不是标准测试文件，是一个脚本，包含 `process.exit(1)`
   - 严重程度：高
   - 建议：删除或改为标准的 Vitest 测试文件

## 实现状态

- 需求 1-3：已完成实现和测试
- 需求 4：待实现
