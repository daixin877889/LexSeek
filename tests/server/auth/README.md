# 认证模块测试

## 模块说明

测试认证令牌服务和 Token 黑名单功能。

## 测试文件列表

| 文件 | 说明 | 测试类型 |
|------|------|----------|
| auth.test.ts | 认证模块测试 | 集成测试 + 属性测试 |

## 测试用例详情

### auth.test.ts

#### Token 黑名单 DAO 测试
- 应能添加 token 到黑名单
- 应能查询黑名单中的 token
- 应能软删除黑名单中的 token
- 应能删除过期的 token

#### Cookie 配置测试
- Cookie 配置应包含必要的安全设置
- TokenUserInfo 接口应包含必要字段

#### 属性测试
- **Property: Token 黑名单往返一致性** - 添加的 token 应能被正确查询到

## 运行命令

```bash
# 运行认证模块测试
npx vitest run tests/server/auth --reporter=verbose

# 运行单个测试文件
npx vitest run tests/server/auth/auth.test.ts --reporter=verbose
```

## 依赖

- 使用 `tests/server/membership/test-db-helper.ts` 提供的数据库辅助函数
- 导入实际的业务函数进行测试
