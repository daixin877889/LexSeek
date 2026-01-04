# 法律模块测试

本目录包含法律模块的服务端测试。

## 测试文件

| 文件 | 描述 | 测试用例数 |
|------|------|-----------|
| `article-sorting.test.ts` | 法律条文层级排序算法测试 | 20 |

## 测试详情

### article-sorting.test.ts

测试法律条文层级排序算法的正确性，包括：

**getParentPath 函数测试（8 个用例）**：
- 非层级类型应返回空字符串
- l1 应返回空字符串
- l2 应返回 l1
- l3 应返回 l1/l2
- l3 跳级应返回 l1
- l4 应返回 l1/l2/l3
- l5 应返回 l1/l2/l3/l4
- l5 跳级应返回 l1/l2/l3

**getNodePath 函数测试（5 个用例）**：
- 非层级类型应使用 __type__id 格式
- l1 应返回 l1
- l2 应返回 l1/l2
- l3 应返回 l1/l2/l3
- l3 跳级应返回 l1/l3

**sortArticlesByHierarchy 函数测试（7 个用例）**：
- 应处理空输入
- 应按 order 排序非层级类型
- 应正确排序正常层级结构
- 应正确处理跳级结构
- 应正确处理混合类型
- 应跳过无效条文
- 应将 null order 视为 0

## 运行测试

```bash
# 运行所有法律模块测试
npx vitest run tests/server/legal/ --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/legal/article-sorting.test.ts --reporter=verbose
```

## 测试覆盖率

当前测试覆盖了以下功能：
- ✅ 父级路径计算
- ✅ 节点路径生成
- ✅ 层级排序算法
- ✅ 跳级处理
- ✅ 非层级类型处理
- ✅ 空输入处理
- ✅ 异常输入处理

## 注意事项

1. 测试使用真实的业务逻辑，不使用 mock
2. 测试数据使用中文字符串模拟真实场景
3. 所有测试都应该通过，如果有失败请检查代码实现
