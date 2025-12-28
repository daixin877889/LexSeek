# 加密系统测试模块

本模块包含文件加密相关的所有测试用例，涵盖加密元数据保留、解密输出格式等功能。

## 测试文件列表

| 文件 | 说明 | 测试数量 |
|------|------|---------|
| `encryption-metadata.test.ts` | 文件加密元数据保留和解密输出格式测试 | 9 |

## 测试用例详情

### encryption-metadata.test.ts - 文件元数据保留

**Property 7: 文件元数据保留**（使用真实数据库操作）
- 加密文件应保留原始文件名（不含 .age）- 属性测试
- 加密文件应保留原始 MIME 类型 - 属性测试
- 非加密文件不应设置 originalMimeType
- 加密文件路径应以 .age 结尾 - 属性测试

**回调更新元数据测试**（使用真实 DAO 函数）
- 回调应正确更新加密文件的元数据
- 回调应正确处理非加密文件

**Property 8: 解密输出格式正确性**
- 解密后的 Blob 应具有正确的 MIME 类型
- text/plain 类型的 Blob 应正确创建

**数据库连接检查**
- 检查数据库是否可用

## 测试特点

- ✅ **真实数据库操作**：所有测试使用真实的 DAO 函数操作数据库
- ✅ **属性测试**：使用 fast-check 进行属性测试，验证多种输入场景
- ✅ **自动清理**：测试完成后自动清理测试数据

## 使用的业务函数

- `createOssFileDao` - 创建 OSS 文件记录
- `findOssFileByIdDao` - 根据 ID 查询 OSS 文件记录
- `updateOssFileDao` - 更新 OSS 文件记录
- `deleteOssFilesDao` - 批量软删除 OSS 文件记录

## 运行测试

```bash
# 运行加密模块所有测试
bun run test:crypto

# 或使用 vitest 直接运行
npx vitest run tests/server/crypto --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/crypto/encryption-metadata.test.ts --reporter=verbose
```

## 验证的需求

- **Requirements 4.6, 4.7**: 文件元数据保留
- **Requirements 7.8, 7.9**: 解密输出格式正确性
