# 加密系统测试模块

本模块包含文件加密相关的所有测试用例，涵盖加密元数据保留、解密输出格式等功能。

## 测试文件列表

| 文件 | 说明 |
|------|------|
| `encryption-metadata.test.ts` | 文件加密元数据保留和解密输出格式测试 |

## 测试用例详情

### encryption-metadata.test.ts - 文件元数据保留

**文件元数据保留**
- 加密文件应保留原始文件名（不含 .age）
- 加密文件应保留原始 MIME 类型
- 非加密文件不应设置 originalMimeType
- 加密文件路径应以 .age 结尾

**解密输出格式正确性**
- 解密后的 Blob 应具有正确的 MIME 类型
- text/plain 类型的 Blob 应正确创建

## 运行测试

```bash
# 运行加密模块所有测试
npx vitest run tests/server/crypto --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/crypto/encryption-metadata.test.ts --reporter=verbose
```
