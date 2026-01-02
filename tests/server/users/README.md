# 用户模块测试

## 模块说明

测试用户 DAO 和 Service 层功能，包括用户创建、查询、更新等操作。

## 测试文件列表

| 文件 | 说明 | 测试类型 |
|------|------|----------|
| users.test.ts | 用户模块测试 | 集成测试 + 属性测试 |
| token-blacklist.test.ts | Token 黑名单测试 | 集成测试 + 属性测试 |
| user-response.test.ts | 用户响应格式化服务测试 | 单元测试 + 属性测试 |

## 测试用例详情

### users.test.ts

#### 用户 DAO 测试

##### createUserDao - 创建用户
- 应能创建新用户
- 创建用户应包含 userRoles 关联

##### findUserByIdDao - 通过 ID 查询用户
- 应能通过 ID 查询到用户
- 查询不存在的用户应返回 null
- 查询结果应包含 userRoles 关联

##### findUserByPhoneDao - 通过手机号查询用户
- 应能通过手机号查询到用户
- 查询不存在的手机号应返回 null

##### findUserByInviteCodeDao - 通过邀请码查询用户
- 应能通过邀请码查询到用户
- 查询不存在的邀请码应返回 null

##### findUserByUsernameDao - 通过用户名查询用户
- 应能通过用户名查询到用户
- 查询不存在的用户名应返回 null

##### updateUserPasswordDao - 更新用户密码
- 应能更新用户密码

##### updateUserProfileDao - 更新用户资料
- 应能更新用户资料
- 应能更新多个字段

#### 属性测试
- **Property: 用户 CRUD 往返一致性** - 创建的用户应能被正确查询到
- **Property: 用户更新一致性** - 更新后的用户资料应能被正确查询到

## 运行命令

```bash
# 运行用户模块测试
npx vitest run tests/server/users --reporter=verbose

# 运行单个测试文件
npx vitest run tests/server/users/users.test.ts --reporter=verbose
```

## 依赖

- 使用 `tests/server/membership/test-db-helper.ts` 提供的数据库辅助函数
- 导入实际的业务函数进行测试
