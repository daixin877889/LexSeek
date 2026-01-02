# 积分系统测试

## 模块说明

测试积分系统（point）模块的功能，包括积分消费记录和积分消费项目。

## 测试文件列表

| 文件名 | 说明 |
|--------|------|
| point-consumption.test.ts | 积分消费记录测试 |

## 运行命令

```bash
# 运行积分系统测试
npx vitest run tests/server/point --reporter=verbose
```

## 测试用例

### point-consumption.test.ts

- 创建积分消费记录
- 查询用户积分消费记录列表
- 统计积分记录关联的消耗总量
- 查询启用的积分消耗项目
