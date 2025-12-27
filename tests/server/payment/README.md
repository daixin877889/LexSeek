# 支付系统测试模块

本模块包含支付系统相关的所有测试用例，涵盖支付适配器、支付状态转换、订单状态一致性等功能。

## 测试文件列表

| 文件 | 说明 |
|------|------|
| `payment-adapter.test.ts` | 支付适配器接口一致性和状态转换测试 |

## 测试用例详情

### payment-adapter.test.ts - 支付适配器

**支付适配器接口一致性**
- 微信支付适配器应支持小程序、扫码、WAP、APP 支付
- 支持的支付方式应返回成功结果
- 小程序支付需要 openid
- 不支持的支付方式应返回错误
- 小程序支付应返回 prepayId 和 paymentParams
- 扫码支付应返回 codeUrl

**支付状态转换正确性**
- 待支付状态可以转换为成功、失败或过期
- 支付成功状态只能转换为已退款
- 支付失败状态不能转换为其他状态
- 已过期状态不能转换为其他状态
- 已退款状态不能转换为其他状态

**订单状态与支付单状态一致性**
- 支付成功时订单状态应变为已支付
- 支付未成功时订单状态应保持不变

## 运行测试

```bash
# 运行支付模块所有测试
npx vitest run tests/server/payment --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/payment/payment-adapter.test.ts --reporter=verbose
```
