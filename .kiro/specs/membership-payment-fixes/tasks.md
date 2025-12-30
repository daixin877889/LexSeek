# 实现计划: 会员支付系统修复

## 概述

本实现计划将会员支付系统的修复工作分解为可执行的任务,按照后端修复 → 前端修复 → 测试验证的顺序进行。

## 任务列表

- [x] 1. 修复订单号格式
  - [x] 1.1 修改订单号生成函数
    - 修改 `server/services/payment/order.dao.ts` 中的 `generateOrderNo` 函数
    - 将前缀从 `ORD` 改为 `LSD`
    - 确保格式为: LSD + YYYYMMDDHHMMSS + NNNNNN (总长度 23 位)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ]* 1.2 编写订单号格式属性测试
    - **Property 3: 订单号格式正确性**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  - [x] 1.3 验证订单号唯一性
    - 确保数据库中 orderNo 字段有唯一索引
    - _Requirements: 3.6_

- [x] 2. 修复微信支付商户订单号传递
  - [x] 2.1 检查微信支付适配器
    - 检查 `server/lib/payment/adapters/wechat-pay.ts` 中所有支付方式的实现
    - 确保 `out_trade_no` 字段正确传递系统订单号
    - 添加调试日志记录 `out_trade_no` 的值
    - _Requirements: 4.1, 4.2, 4.5_
  - [x] 2.2 验证微信支付请求参数
    - 在创建支付前打印请求参数
    - 确认 `out_trade_no` 不为空且等于系统订单号
    - _Requirements: 4.2, 4.3, 4.6_
  - [ ]* 2.3 编写微信支付订单号传递属性测试
    - **Property 4: 微信支付订单号传递正确性**
    - **Validates: Requirements 4.1, 4.2, 4.6**

- [x] 3. 检查点 - 验证订单号修复
  - 创建测试订单,验证订单号格式是否正确
  - 在微信商户后台查询订单号,确认可以查到
  - 如有问题请询问用户

- [x] 4. 修复会员有效期显示
  - [x] 4.1 检查会员信息 API
    - 检查 `server/api/v1/memberships/me.get.ts`
    - 确保返回 `expiresAt` 字段
    - 确保 `expiresAt` 为 ISO 8601 格式字符串
    - _Requirements: 1.4, 1.5_
  - [x] 4.2 检查会员 DAO 查询逻辑
    - 检查 `server/services/membership/userMembership.dao.ts` 中的 `getCurrentUserMembershipDao` 函数
    - 确保查询条件为: status=1 且 endDate > 当前时间
    - 如果有多个有效会员,返回最晚到期的
    - _Requirements: 1.1, 1.2_
  - [x] 4.3 检查前端会员信息展示组件
    - 检查 `app/components/membership/MembershipCurrentInfo.vue`
    - 确保正确显示 `expiresAt` 字段
    - 使用 dayjs 格式化日期为 YYYY-MM-DD 格式
    - 免费用户显示"暂无会员"
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ]* 4.4 编写会员信息 API 响应属性测试
    - **Property 1: 会员信息 API 响应完整性**
    - **Validates: Requirements 1.4, 1.5**

- [x] 5. 修复订单时长单位
  - [x] 5.1 检查商品数据模型
    - 检查 `prisma/models/product.prisma`
    - 确保 `defaultDuration` 字段存在且有默认值
    - 如果不存在,添加该字段: `defaultDuration Int @default(2) @map("default_duration")`
    - _Requirements: 5.1, 5.2, 5.5_
  - [x] 5.2 更新现有商品数据
    - 检查数据库中现有商品的 `defaultDuration` 值
    - 按月购买的商品设置为 1
    - 按年购买的商品设置为 2
    - _Requirements: 5.1, 5.2_
  - [x] 5.3 检查前端购买逻辑
    - 检查 `app/pages/dashboard/membership/level.vue` 中的 `buy` 函数
    - 确保根据商品的 `defaultDuration` 正确设置 `durationUnit`
    - defaultDuration=1 时使用 DurationUnit.MONTH
    - defaultDuration=2 时使用 DurationUnit.YEAR
    - _Requirements: 2.1, 2.2, 2.5_
  - [x] 5.4 检查后端订单创建逻辑
    - 检查 `server/api/v1/payments/create.post.ts`
    - 确保正确使用前端传递的 `durationUnit` 参数
    - 检查 `server/services/payment/order.service.ts`
    - 确保订单记录中正确保存 `durationUnit`
    - _Requirements: 2.4, 2.5_
  - [ ]* 5.5 编写订单时长单位属性测试
    - **Property 2: 订单时长单位一致性**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5**
  - [ ]* 5.6 编写商品默认购买周期属性测试
    - **Property 5: 商品默认购买周期有效性**
    - **Validates: Requirements 5.1, 5.2, 5.5**

- [x] 6. 检查点 - 验证所有修复
  - 测试会员有效期是否正确显示
  - 测试按月购买是否创建月度订单
  - 测试按年购买是否创建年度订单
  - 测试订单号格式是否正确
  - 测试微信商户后台是否能查到订单
  - 如有问题请询问用户

- [x] 7. 集成测试
  - [ ]* 7.1 端到端购买流程测试
    - 测试从选择商品到支付成功的完整流程
    - 验证订单号在微信商户后台可查询
    - _Requirements: 3.1, 4.1_
  - [ ]* 7.2 会员页面显示测试
    - 测试会员有效期是否正确显示
    - 测试免费用户是否显示"暂无会员"
    - 测试多段会员记录时显示当前有效会员的有效期
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 8. 最终检查点
  - 确保所有测试通过
  - 确保所有修复已验证
  - 如有问题请询问用户

## 注意事项

- 修改订单号格式后,需要确保不影响现有订单的查询
- 微信支付相关修改需要在测试环境验证后再部署到生产环境
- 商品数据模型修改需要执行数据库迁移
- 所有修改都需要添加适当的日志记录,便于问题排查
- 测试时需要使用真实的微信支付环境,确保订单号可以在商户后台查询到

