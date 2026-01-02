# 文件服务测试

## 模块说明

测试文件服务（files）模块的功能，包括 OSS 文件管理和签名生成。

## 测试文件列表

| 文件名 | 说明 |
|--------|------|
| files-service.test.ts | 文件服务测试 |
| oss-files-dao.test.ts | OSS 文件数据访问层测试 |

## 运行命令

```bash
# 运行文件服务测试
npx vitest run tests/server/files --reporter=verbose
```

## 测试用例

### files-service.test.ts

- 批量下载签名生成
- 空文件列表处理
- 按 bucket 分组处理

### oss-files-dao.test.ts

- 创建 OSS 文件记录
- 批量创建 OSS 文件记录
- 根据 ID 查找文件
- 批量查找文件
- 软删除文件
- 获取用户 OSS 用量
- 更新文件记录
- 分页查询用户文件列表
