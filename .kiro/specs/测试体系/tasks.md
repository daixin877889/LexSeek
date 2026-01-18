# 实现计划：测试体系

## 任务列表

- [x] 1. 配置测试框架
- [x] 2. 编写单元测试
- [x] 3. 编写集成测试
- [x] 4. 编写属性测试
- [x] 5. 提高测试覆盖率
- [x] 6. 测试质量保证与清理
  - [x] 6.1 删除占位符测试文件 `ocr-logic.test.ts`
  - [x] 6.2 删除 ORM 测试文件 `caseMaterialEmbedding.simple.test.ts`
  - [x] 6.3 删除或重构脚本式测试文件 `test-embedding-status-on-create.ts`
  - [x] 6.4 审查其他测试文件，确保没有类似问题
  - [x] 6.5 更新测试文档，添加测试质量标准

## 任务详情

### 6.1 删除占位符测试文件 `ocr-logic.test.ts`

**目标：** 删除只包含 `expect(true).toBe(true)` 的占位符测试文件。

**原因：** 
- 该文件所有测试用例都只有注释和 `expect(true).toBe(true)`
- 没有验证任何实际的业务逻辑
- 给人虚假的测试覆盖率

**操作：**
1. 删除文件 `tests/server/services/material/ocr-logic.test.ts`
2. 如果需要测试 OCR 逻辑，应该在 `ocr.service.test.ts` 或 `ocr.service.integration.test.ts` 中添加真实的测试用例

### 6.2 删除 ORM 测试文件 `caseMaterialEmbedding.simple.test.ts`

**目标：** 删除只测试 Prisma ORM 功能的测试文件。

**原因：**
- 该文件测试的是 Prisma 能否正确读写数据库
- 没有测试任何业务逻辑
- Prisma 本身已经有完善的测试，我们不需要重复测试它

**操作：**
1. 删除文件 `tests/server/case/caseMaterialEmbedding.simple.test.ts`
2. 如果需要测试 embedding 相关逻辑，应该测试业务服务方法，并使用 mock 隔离数据库

### 6.3 删除或重构脚本式测试文件 `test-embedding-status-on-create.ts`

**目标：** 处理非标准测试文件。

**原因：**
- 该文件不是标准的 Vitest 测试文件
- 使用 `process.exit(1)` 等脚本式控制流
- 无法被测试运行器正确管理和报告

**操作：**
1. 评估该文件的用途：
   - 如果是一次性验证脚本，移到 `scripts/` 目录
   - 如果是持续需要的测试，重构为标准 Vitest 测试文件
2. 推荐：删除该文件，因为相关逻辑应该已经在其他测试文件中覆盖

### 6.4 审查其他测试文件

**目标：** 确保没有其他类似的问题测试文件。

**操作：**
1. 扫描 `tests/` 目录下的所有测试文件
2. 检查是否有以下问题：
   - 只有 `expect(true).toBe(true)` 的占位符测试
   - 只测试 ORM 而不测试业务逻辑
   - 非标准测试文件结构
3. 对发现的问题文件进行清理

### 6.5 更新测试文档

**目标：** 添加测试质量标准文档。

**操作：**
1. 在 `.kiro/steering/` 目录创建 `testing.md` 文档
2. 包含以下内容：
   - 测试反模式及正确示例
   - 测试质量检查清单
   - 测试文件命名和组织规范

## 实现状态

✅ 任务 1-5 已完成
⏳ 任务 6 待实现
