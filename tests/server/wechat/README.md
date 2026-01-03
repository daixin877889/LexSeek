# 微信模块测试

本目录包含微信相关功能的测试用例。

## 测试文件列表

| 文件名 | 说明 |
|--------|------|
| auth-callback.test.ts | 授权回调接口属性测试 |

## 测试用例详情

### auth-callback.test.ts

测试微信授权回调接口的核心功能：

- **Property 4**: State 参数编解码往返一致性
- **Property 5**: 授权回调白名单验证
- **Property 6**: 授权回调 code 参数传递

## 运行命令

```bash
# 运行微信模块测试
npx vitest run tests/server/wechat/ --reporter=verbose
```
