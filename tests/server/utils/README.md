# 工具函数测试模块

本模块包含通用工具函数相关的所有测试用例，涵盖数据序列化等功能。

## 测试文件列表

| 文件 | 说明 |
|------|------|
| `serialization.test.ts` | 数据序列化往返测试 |

## 测试用例详情

### serialization.test.ts - 数据序列化往返

**会员级别序列化**
- 序列化后再反序列化应得到等价对象
- 批量序列化应保持顺序

**用户会员记录序列化**
- 序列化后再反序列化应得到等价对象
- 日期字段应正确格式化
- 批量序列化应保持顺序

**JSON 序列化边界情况**
- 空字符串描述应正确处理
- null 值应正确保留
- 特殊字符应正确处理
- 布尔值应正确序列化

## 运行测试

```bash
# 运行工具模块所有测试
npx vitest run tests/server/utils --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/utils/serialization.test.ts --reporter=verbose
```
