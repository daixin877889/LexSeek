# Workers 测试模块

本目录包含 `app/workers` 目录下 Web Worker 的单元测试。

## 测试文件

| 文件 | 描述 | 测试用例数 |
|------|------|-----------|
| `fileUpload.worker.test.ts` | 文件上传 Worker 测试 | 18 |
| `crypto.worker.test.ts` | 加密/解密 Worker 测试 | 17 |

## 测试内容

### fileUpload.worker.test.ts

测试文件上传 Worker 的核心逻辑：

- **FormData 构建**：验证签名字段、可选字段、callbackVar 的正确处理
- **响应消息格式**：验证进度、成功、错误响应的格式
- **任务管理**：验证任务的存储、删除和取消
- **HTTP 状态码处理**：验证成功和失败状态码的处理
- **JSON 响应解析**：验证有效/无效 JSON 的解析

### crypto.worker.test.ts

测试加密/解密 Worker 的核心逻辑：

- **消息类型**：验证加密和解密消息的格式
- **响应消息格式**：验证成功、错误、进度响应的格式
- **错误类型分类**：验证不同错误的分类逻辑
- **ArrayBuffer 处理**：验证数据转换的正确性
- **进度报告**：验证进度报告的顺序
- **Transferable 对象**：验证 ArrayBuffer 的传输

## 运行测试

```bash
# 运行所有 Workers 测试
bun run test:workers

# 运行单个测试文件
npx vitest run tests/client/workers/fileUpload.worker.test.ts --reporter=verbose
npx vitest run tests/client/workers/crypto.worker.test.ts --reporter=verbose
```

## 属性测试

测试使用 fast-check 进行属性测试，每个属性测试运行 100 次迭代，验证：

- callbackVar 键值对的正确添加
- 进度值的范围约束
- HTTP 状态码的错误消息生成
- 错误类型分类的一致性
- ArrayBuffer 数据转换的完整性
