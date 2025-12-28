# 系统配置模块测试

## 模块说明

测试系统配置 DAO 功能，包括配置的创建、查询、分页等操作。

## 测试文件列表

| 文件 | 说明 | 测试类型 |
|------|------|----------|
| system.test.ts | 系统配置模块测试 | 集成测试 + 属性测试 |

## 测试用例详情

### system.test.ts

#### 系统配置 DAO 测试

##### getConfigsByGroupAndKeyDao - 通过组和键查询配置
- 应能通过组和键查询到配置
- 查询不存在的配置应返回 null
- 默认不应返回禁用状态的配置

##### getConfigsByKeyDao - 通过键查询所有配置
- 应能通过键查询到所有匹配的配置

##### getConfigsByPageDao - 分页查询配置
- 应能分页查询配置列表
- 不指定组时应查询所有配置

##### getAllConfigGroupsDao - 获取所有配置组
- 应能获取所有不同的配置组

##### getConfigsByGroupDao - 通过组查询所有配置
- 应能通过组查询所有配置

##### getConfigByIdDao - 通过 ID 查询配置
- 应能通过 ID 查询到配置
- 查询不存在的 ID 应返回 null

#### 属性测试
- **Property: 配置 CRUD 往返一致性** - 创建的配置应能被正确查询到

## 运行命令

```bash
# 运行系统配置模块测试
npx vitest run tests/server/system --reporter=verbose

# 运行单个测试文件
npx vitest run tests/server/system/system.test.ts --reporter=verbose
```

## 依赖

- 使用 `tests/server/membership/test-db-helper.ts` 提供的数据库辅助函数
- 导入实际的业务函数进行测试
