# 短信验证码模块测试

## 模块说明

测试短信验证码 DAO 和验证服务功能，包括验证码创建、查询、验证、锁定机制等。

## 测试文件列表

| 文件 | 说明 | 测试类型 |
|------|------|----------|
| sms.test.ts | 短信验证码模块测试 | 集成测试 + 属性测试 |

## 测试用例详情

### sms.test.ts

#### 短信验证码 DAO 测试

##### createSmsRecordDao - 创建短信验证码
- 应能创建短信验证码记录
- 应能创建不同类型的验证码

##### findSmsRecordByPhoneAndTypeDao - 查询短信验证码
- 应能通过手机号和类型查询验证码
- 查询不存在的记录应返回 null
- 不同类型的验证码应独立查询

##### deleteSmsRecordByIdDao - 删除短信验证码
- 应能删除验证码记录

#### 时间安全字符串比较测试
- 相同字符串应返回 true
- 不同字符串应返回 false
- 长度不同的字符串应返回 false

#### 验证失败锁定机制测试
- 初始状态不应被锁定
- 记录验证失败应增加失败计数
- 重置失败计数应清除记录

#### 属性测试
- **Property: 时间安全比较对称性** - 比较结果应与参数顺序无关
- **Property: 时间安全比较自反性** - 任意字符串与自身比较应返回 true
- **Property: 验证码 CRUD 往返一致性** - 创建的验证码应能被正确查询到

## 运行命令

```bash
# 运行短信模块测试
npx vitest run tests/server/sms --reporter=verbose

# 运行单个测试文件
npx vitest run tests/server/sms/sms.test.ts --reporter=verbose
```

## 依赖

- 使用 `tests/server/membership/test-db-helper.ts` 提供的数据库辅助函数
- 导入实际的业务函数进行测试
