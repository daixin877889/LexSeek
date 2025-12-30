# 需求文档

## 简介

修复购买会员套餐时赠送积分的生效日期问题。当用户购买的会员套餐生效日期在未来时，赠送的积分有效期应该与会员日期同步，而不是从当前时间开始计算。

## 术语表

- **User_Membership**: 用户会员记录，包含开始日期和结束日期
- **Point_Record**: 积分记录，包含生效时间（effectiveAt）和过期时间（expiredAt）
- **Gift_Points**: 购买会员套餐时赠送的积分
- **Membership_Handler**: 会员商品支付成功处理器

## 需求

### 需求 1：赠送积分生效时间同步

**用户故事：** 作为用户，我希望购买会员套餐时赠送的积分生效时间与会员开始时间一致，以便积分有效期与会员有效期保持同步。

#### 验收标准

1. WHEN 用户购买会员套餐且会员开始日期为当前日期 THEN Gift_Points 的 effectiveAt SHALL 等于会员的 startDate
2. WHEN 用户购买会员套餐且会员开始日期为未来日期 THEN Gift_Points 的 effectiveAt SHALL 等于会员的 startDate
3. WHEN 用户购买会员套餐 THEN Gift_Points 的 expiredAt SHALL 等于会员的 endDate

### 需求 2：积分有效期计算规则

**用户故事：** 作为系统管理员，我希望积分有效期计算规则清晰明确，以便用户能够准确了解积分的使用期限。

#### 验收标准

1. THE Point_Record SHALL 记录积分的生效时间（effectiveAt）和过期时间（expiredAt）
2. WHEN 积分来源为会员购买赠送 THEN Point_Record 的有效期 SHALL 与关联的 User_Membership 有效期完全一致
3. WHEN 积分尚未生效（effectiveAt > 当前时间）THEN 系统 SHALL 在积分查询时正确标识该积分状态
