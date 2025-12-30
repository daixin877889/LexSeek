# 需求文档

## 简介

本文档定义了会员支付系统的修复需求,主要解决会员页面显示、订单创建、订单号格式和微信支付集成等问题。

## 术语表

- **会员系统 (Membership_System)**: 管理用户会员状态、级别、权益的核心系统
- **订单系统 (Order_System)**: 管理订单创建、支付、状态更新的系统
- **支付系统 (Payment_System)**: 处理支付渠道对接、支付回调的系统
- **订单号 (Order_No)**: 系统内部订单的唯一标识符
- **商户订单号 (Out_Trade_No)**: 传递给第三方支付平台的订单号
- **微信支付 (Wechat_Pay)**: 微信支付平台的支付服务

## 需求

### 需求 1: 会员有效期显示

**用户故事:** 作为用户,我希望在会员页面能看到我的会员有效期,以便了解会员何时到期。

#### 验收标准

1. WHEN 用户访问会员页面时,THE Membership_System SHALL 显示当前会员的有效期
2. WHEN 用户是免费版时,THE Membership_System SHALL 显示"暂无会员"或类似提示
3. WHEN 用户有有效会员时,THE Membership_System SHALL 以易读格式显示到期日期(如"2024-12-31")
4. THE Membership_System SHALL 在会员信息 API 响应中包含 expiresAt 字段
5. THE Membership_System SHALL 确保 expiresAt 字段正确序列化为 ISO 8601 格式

### 需求 2: 订单创建时长单位正确性

**用户故事:** 作为用户,我希望按月购买会员时创建的订单是按月计费的,而不是按年计费。

#### 验收标准

1. WHEN 用户选择按月购买会员商品时,THE Order_System SHALL 创建时长单位为"月"的订单
2. WHEN 用户选择按年购买会员商品时,THE Order_System SHALL 创建时长单位为"年"的订单
3. THE Order_System SHALL 根据商品的 defaultDuration 字段确定默认购买时长单位
4. THE Order_System SHALL 在订单中正确记录 duration 和 durationUnit 字段
5. FOR ALL 订单创建请求,订单的时长单位 SHALL 与用户选择的购买周期一致

### 需求 3: 订单号格式规范

**用户故事:** 作为系统管理员,我希望订单号采用统一的格式规范,以便与老系统保持一致并便于识别。

#### 验收标准

1. THE Order_System SHALL 生成以"LSD"开头的订单号
2. THE Order_System SHALL 在"LSD"后添加时间戳(年月日时分秒,14位数字)
3. THE Order_System SHALL 在时间戳后添加6位随机数字
4. THE Order_System SHALL 确保订单号格式为: LSD + YYYYMMDDHHMMSS + NNNNNN (总长度23位)
5. FOR ALL 生成的订单号,格式 SHALL 符合正则表达式: ^LSD\d{20}$
6. THE Order_System SHALL 确保订单号在系统内唯一

### 需求 4: 微信支付商户订单号传递

**用户故事:** 作为系统管理员,我希望微信商户后台能查询到订单,以便进行对账和问题排查。

#### 验收标准

1. WHEN 创建微信支付订单时,THE Payment_System SHALL 将系统订单号作为 out_trade_no 传递给微信支付
2. THE Payment_System SHALL 确保 out_trade_no 字段不为空
3. THE Payment_System SHALL 确保 out_trade_no 符合微信支付的格式要求(1-32位字符)
4. WHEN 接收微信支付回调时,THE Payment_System SHALL 通过 out_trade_no 查找对应的系统订单
5. THE Payment_System SHALL 在日志中记录传递给微信支付的 out_trade_no 值
6. FOR ALL 微信支付请求,out_trade_no SHALL 等于系统订单号

### 需求 5: 商品默认购买周期

**用户故事:** 作为用户,我希望商品能正确显示默认的购买周期,以便我知道默认是按月还是按年购买。

#### 验收标准

1. THE Product_System SHALL 为每个会员商品配置 defaultDuration 字段
2. THE Product_System SHALL 支持 defaultDuration 值: 1-按月, 2-按年
3. WHEN 用户查看商品列表时,THE Product_System SHALL 返回商品的 defaultDuration 值
4. WHEN 前端显示商品时,THE Product_System SHALL 根据 defaultDuration 默认选中对应的购买周期
5. THE Product_System SHALL 确保 defaultDuration 字段在商品创建时必填

