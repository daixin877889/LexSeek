# 法律模块测试

本目录包含法律模块的服务端测试。

## 测试文件

| 文件 | 描述 | 测试用例数 |
|------|------|-----------|
| `article-sorting.test.ts` | 法律条文层级排序算法测试 | 20 |
| `article-sorting-integration.test.ts` | 法律条文层级排序集成测试 | 4 |
| `lawEmbedding.service.test.ts` | 法律条文向量嵌入服务测试 | 5 |
| `legalArticles.service.test.ts` | 法律条文服务层测试 | 9 |
| `legalMain.service.test.ts` | 法律法规服务层测试 | 6 |
| `legalStatistics.service.test.ts` | 法律法规统计信息服务层测试 | 10 |
| `parser.service.test.ts` | 法律内容解析服务测试 | 23 |
| `searchLaw.tool.test.ts` | 法律搜索工具测试 | 14 |
| `vectorStore.service.test.ts` | 向量存储服务测试 | 7 |

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

### parser.service.test.ts

测试法律内容解析服务的正确性，包括：

**中文数字转换测试（5 个用例）**：
- 应正确转换基本中文数字
- 应正确转换十位数
- 应正确转换百位数
- 应正确转换千位数
- 应直接返回阿拉伯数字字符串

**Markdown 文档解析测试（6 个用例）**：
- 应正确解析简单的 Markdown 标题结构
- 应正确处理 header 内容
- 应正确处理 notice 标签
- 应正确处理 annex 标签
- 应正确处理 footer 标签
- 应移除 frontmatter

**司法解释文档解析测试（3 个用例）**：
- 应正确解析中文数字标题
- 应正确解析阿拉伯数字标题
- 应正确处理 header 内容

**自动选择解析器测试（2 个用例）**：
- Markdown 格式应使用系统一解析器
- 中文数字格式应使用系统二解析器

**解析结果结构一致性测试（2 个用例）**：
- 所有解析结果应包含必需字段
- 层级索引应为正整数或 null

**边界情况测试（5 个用例）**：
- 应处理空输入
- 应处理只有空白的输入
- 应处理没有标题的纯文本
- 应处理多级嵌套标题
- 应处理混合标签的复杂文档

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
