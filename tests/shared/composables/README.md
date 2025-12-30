# Composables 测试模块

本模块包含前端 Composables 的属性测试，验证格式化工具和状态处理方法的正确性。

## 测试文件列表

| 文件名 | 说明 | 验证需求 |
|--------|------|----------|
| useFormatters.test.ts | 格式化工具测试 | Requirements 2.2, 2.3, 2.4, 2.5, 2.6 |
| useOrderStatus.test.ts | 订单状态处理测试 | Requirements 3.2, 3.3, 3.4 |
| useMembershipStatus.test.ts | 会员状态处理测试 | Requirements 4.2, 4.3 |
| usePointStatus.test.ts | 积分状态处理测试 | Requirements 5.2, 5.3 |

## 测试用例详情

### useFormatters.test.ts

- **Property 1.1**: 有效日期应返回 YYYY-MM-DD HH:mm 格式
- **Property 1.2**: 有效日期应返回 YY/MM/DD 格式
- **Property 1.3**: 有效日期应返回 YYYY年MM月DD日 HH:mm 格式
- **Property 2**: 任意数字应返回两位小数字符串
- 空值和无效日期边界测试

### useOrderStatus.test.ts

- **Property 3.1**: 所有 OrderStatus 枚举值应返回非空中文文本
- **Property 3.2**: 所有 OrderStatus 枚举值应返回非空 CSS 类名
- **Property 4**: 正整数时长应返回包含数字和单位的中文描述

### useMembershipStatus.test.ts

- **Property 5**: 未来日期应返回 true，过去日期应返回 false
- **Property 6**: 最高 sortOrder 的级别应返回 true
- 空值和无效日期边界测试

### usePointStatus.test.ts

- **Property 7**: 当前时间在 effectiveAt 和 expiredAt 之间时应返回 true
- **Property 8**: effectiveAt 在未来时应返回 true
- isAvailable 和 isNotEffective 的互斥性测试

## 运行命令

```bash
# 运行所有 composables 测试
npx vitest run tests/shared/composables --reporter=verbose

# 运行单个测试文件
npx vitest run tests/shared/composables/useFormatters.test.ts --reporter=verbose
```
