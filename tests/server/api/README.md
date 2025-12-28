# API 集成测试

本目录包含所有 API 端点的集成测试，发送真实的 HTTP 请求到运行中的服务器进行测试。

## 测试文件列表

| 文件 | 说明 | 测试内容 |
|------|------|----------|
| test-api-client.ts | API 测试客户端 | HTTP 请求封装 |
| test-api-helpers.ts | 测试辅助函数 | 数据创建、认证、清理 |
| 01-health.test.ts | 健康检查测试 | 服务状态检查 |
| 02-auth.test.ts | 认证流程测试 | 注册、登录、登出、重置密码 |
| 03-sms.test.ts | 短信验证码测试 | 发送验证码、频率限制 |
| 04-users.test.ts | 用户信息测试 | 获取/更新用户信息 |
| 05-memberships.test.ts | 会员系统测试 | 等级、权益、升级 |
| 06-points.test.ts | 积分系统测试 | 积分信息和记录 |
| 07-redemption.test.ts | 兑换码测试 | 查询和使用兑换码 |
| 08-campaigns.test.ts | 营销活动测试 | 活动列表、邀请奖励 |
| 09-products.test.ts | 产品信息测试 | 产品列表和详情 |
| 10-payments.test.ts | 支付系统测试 | 订单创建、状态查询 |
| 11-storage.test.ts | 文件存储测试 | 上传下载文件 |
| 12-encryption.test.ts | 加密配置测试 | 加密设置管理 |

## 运行测试

```bash
# 运行所有 API 测试
bun run test:api

# 运行特定测试文件
npx vitest run tests/server/api/02-auth.test.ts --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/server/api --coverage
```

## 测试前提条件

1. **服务器运行**: 测试需要 Nuxt 服务器在 `http://localhost:3000` 运行
2. **数据库连接**: 需要配置 `DATABASE_URL` 环境变量
3. **环境变量**: 可通过 `TEST_API_BASE_URL` 自定义服务器地址

## 测试原则

1. **真实请求**: 所有测试发送真实的 HTTP 请求，不使用 mock
2. **场景驱动**: 测试按用户使用场景组织
3. **数据隔离**: 每个测试使用独立的测试数据
4. **自动清理**: 测试后自动清理测试数据

## 测试数据标记

- 测试用户手机号前缀: `199`
- 测试数据会在测试结束后自动清理

## 编写新测试

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestHelper, connectTestDb, disconnectTestDb } from './test-api-helpers'

describe('API 测试示例', () => {
    const helper = createTestHelper()

    beforeAll(async () => {
        await connectTestDb()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    afterEach(async () => {
        await helper.cleanup()
    })

    it('应该返回成功响应', async () => {
        const client = helper.getClient()
        const response = await client.get('/api/health')
        expect(response.success).toBe(true)
    })
})
```
