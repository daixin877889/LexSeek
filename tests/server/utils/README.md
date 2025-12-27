# 工具函数测试模块

本模块包含通用工具函数相关的所有测试用例，涵盖数据序列化、密码处理、JWT 等功能。

## 测试文件列表

| 文件 | 说明 | 覆盖率 |
|------|------|--------|
| `serialization.test.ts` | 数据序列化往返测试 | 100% |
| `password.test.ts` | 密码加密、验证、邀请码生成 | 100% |
| `jwt.test.ts` | JWT 令牌生成和验证 | 84.21% |

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

### password.test.ts - 密码工具函数

**密码加密 (generatePassword)**
- 应生成加密后的密码
- 相同密码每次加密结果应不同（因为盐值不同）
- 加密后的密码应以 $2a$ 或 $2b$ 开头（bcrypt 格式）

**密码验证 (comparePassword)**
- 正确密码应验证通过
- 错误密码应验证失败
- Property: 加密后验证应始终通过

**密码复杂度验证 (isValidPassword)**
- 有效密码应通过验证
- 少于8个字符的密码应验证失败
- 不包含字母的密码应验证失败
- 不包含数字的密码应验证失败

**随机邀请码生成 (generateRandomCode)**
- 应生成6位字符的邀请码
- 邀请码应只包含数字和大写字母
- 每次生成的邀请码应不同

**唯一邀请码生成 (generateUniqueInviteCode)**
- 首次生成的邀请码不存在时应直接返回
- 邀请码已存在时应重试生成
- 达到最大重试次数时应使用时间戳生成

### jwt.test.ts - JWT 工具函数

**令牌生成 (generateToken)**
- 应成功生成 JWT 令牌
- 禁用状态的用户应无法生成令牌
- 正常状态的用户应能生成令牌
- 生成的令牌不应包含 status 字段

**令牌验证 (verifyToken)**
- 应成功验证有效令牌
- 无效令牌应抛出错误
- 过期令牌应抛出错误
- 使用错误密钥签名的令牌应抛出错误
- 格式错误的令牌应抛出错误

**JWT 往返一致性**
- 生成并验证的令牌应保留原始数据

## 运行测试

```bash
# 运行工具模块所有测试
npx vitest run tests/server/utils --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/utils/serialization.test.ts --reporter=verbose
npx vitest run tests/server/utils/password.test.ts --reporter=verbose
npx vitest run tests/server/utils/jwt.test.ts --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/server/utils --coverage
```
