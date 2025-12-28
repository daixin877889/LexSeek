# RBAC 权限模块测试

## 模块说明

测试角色和用户角色 DAO 功能，包括角色查询、用户角色关联、路由权限等。

## 测试文件列表

| 文件 | 说明 | 测试类型 |
|------|------|----------|
| rbac.test.ts | RBAC 权限模块测试 | 集成测试 + 属性测试 |

## 测试用例详情

### rbac.test.ts

#### 角色 DAO 测试

##### findRoleByIdsDao - 通过 ID 列表查询角色
- 应能通过 ID 列表查询到角色
- 查询不存在的角色 ID 应返回空数组
- 不应返回禁用状态的角色
- 部分 ID 存在时应只返回存在的角色

#### 用户角色 DAO 测试

##### createUserRoleDao - 创建用户角色关联
- 应能创建用户角色关联

##### findUserRolesByUserIdDao - 查询用户角色
- 应能查询用户的所有角色
- 查询结果应包含角色详情
- 没有角色的用户应返回空数组

##### findUserRolesRouterByUserIdDao - 查询用户角色路由权限
- 应能查询用户的角色路由权限
- 应支持按角色 ID 筛选

#### 属性测试
- **Property: 用户角色关联一致性** - 创建的用户角色关联应能被正确查询到

## 运行命令

```bash
# 运行 RBAC 模块测试
npx vitest run tests/server/rbac --reporter=verbose

# 运行单个测试文件
npx vitest run tests/server/rbac/rbac.test.ts --reporter=verbose
```

## 依赖

- 使用 `tests/server/membership/test-db-helper.ts` 提供的数据库辅助函数
- 导入实际的业务函数进行测试
