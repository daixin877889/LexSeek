# 支付系统测试模块

本模块包含支付系统相关的所有测试用例，涵盖支付适配器、支付状态转换、订单状态一致性等功能。

## 测试文件列表

| 文件 | 说明 | 覆盖率 |
|------|------|--------|
| `payment-adapter.test.ts` | 支付适配器接口一致性和状态转换测试 | - |
| `payment-base.test.ts` | 支付基类测试 | 100% |
| `payment-errors.test.ts` | 支付错误类测试 | 100% |
| `wechat-pay.test.ts` | 微信支付适配器测试 | 99.19% |
| `wechat-pay-utils.test.ts` | 微信支付工具函数测试 | - |
| `order-service.test.ts` | 订单服务层测试 | - |

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

### payment-base.test.ts - 支付基类

**基类方法测试**
- getTimestamp 应返回当前时间戳
- generateNonceStr 应生成32位随机字符串
- 随机字符串应只包含字母和数字

### payment-errors.test.ts - 支付错误类

**错误类测试**
- PaymentConfigError 应正确设置错误信息
- PaymentRequestError 应正确设置错误信息
- PaymentSignatureError 应正确设置错误信息
- PaymentMethodNotSupportedError 应正确设置错误信息

### wechat-pay.test.ts - 微信支付适配器

**配置验证**
- 有效配置应成功创建适配器
- 缺少必填字段应抛出配置错误

**支付方式**
- 应返回正确的支付渠道
- 应支持小程序、扫码、WAP、APP 支付
- 不支持的支付方式应抛出错误

**小程序支付**
- 缺少 openid 应返回错误
- 成功应返回 prepayId 和支付参数

**Native 支付**
- 成功应返回 codeUrl

**H5 支付**
- 成功应返回 h5Url

**APP 支付**
- 成功应返回 prepayId 和支付参数

**订单查询**
- 缺少订单号和交易号应返回错误
- 通过交易号查询成功应返回订单信息
- 通过订单号查询成功应返回订单信息

**关闭订单**
- 成功应返回成功状态

**回调验证**
- 回调参数不完整应返回错误
- 没有配置平台证书时应跳过签名验证
- 配置了平台证书时应验证签名

## 运行测试

```bash
# 运行支付模块所有测试
npx vitest run tests/server/payment --reporter=verbose

# 运行特定测试文件
npx vitest run tests/server/payment/payment-adapter.test.ts --reporter=verbose
npx vitest run tests/server/payment/wechat-pay.test.ts --reporter=verbose

# 运行带覆盖率的测试
npx vitest run tests/server/payment --coverage
```
