# 需求文档

## 简介

本文档定义了 LexSeek 法律服务 AI 应用的营销活动管理系统需求。系统支持兑换码管理、营销活动配置等功能。

本文档整合自以下原始 spec：
- admin-redemption-codes（兑换码管理）
- admin-product-campaign-management（商品活动管理）

## 术语表

- **Marketing_Campaign**: 营销活动，用于配置会员和积分赠送规则
- **Redemption_Code**: 兑换码，用于兑换会员或积分的唯一代码
- **Campaign_Type**: 活动类型，包括注册赠送、邀请奖励、活动奖励等

## 需求

### 需求 1：营销活动管理

**用户故事：** 作为系统管理员，我希望能够统一管理各类营销活动，以便灵活配置会员和积分的赠送规则。

#### 验收标准

1. THE System SHALL 支持创建营销活动，包含活动名称、活动类型、起止日期、状态
2. THE System SHALL 支持以下营销活动类型：注册赠送、邀请注册奖励、活动奖励
3. THE System SHALL 支持为每个营销活动配置奖励内容，包括会员级别、会员时长、积分数量
4. WHEN 活动未开始或已结束时，THE System SHALL 不执行该活动的奖励逻辑
5. WHEN 活动状态为禁用时，THE System SHALL 不执行该活动的奖励逻辑
6. THE System SHALL 支持查询活动列表和活动详情

### 需求 2：注册赠送活动

**用户故事：** 作为新用户，我希望注册后能获得试用会员，以便体验系统功能。

#### 验收标准

1. WHEN 存在有效的注册赠送活动且新用户注册成功时，THE System SHALL 自动创建会员记录
2. WHEN 注册赠送活动配置了赠送积分时，THE System SHALL 同时创建积分记录
3. IF 当前时间不在活动有效期内，THEN THE System SHALL 不创建任何会员或积分记录
4. IF 不存在有效的注册赠送活动，THEN THE System SHALL 不创建任何会员或积分记录

### 需求 3：邀请注册奖励活动

**用户故事：** 作为老用户，我希望邀请新用户注册后能获得奖励，以便激励我推广产品。

#### 验收标准

1. WHEN 存在有效的邀请奖励活动且被邀请人注册成功时，THE System SHALL 为邀请人创建会员记录
2. WHEN 邀请奖励活动配置了奖励积分时，THE System SHALL 同时为邀请人创建积分记录
3. IF 当前时间不在活动有效期内，THEN THE System SHALL 不创建任何邀请奖励记录
4. IF 用户没有邀请人，THEN THE System SHALL 不创建任何邀请奖励记录

### 需求 4：兑换码管理

**用户故事：** 作为系统管理员，我希望能够管理兑换码，以便通过活动或销售渠道发放权益。

#### 验收标准

1. THE System SHALL 支持创建兑换码，包含兑换码、兑换类型、会员级别、会员时长、积分数量
2. THE System SHALL 支持以下兑换类型：仅会员、仅积分、会员和积分
3. THE System SHALL 支持批量生成兑换码
4. THE System SHALL 支持设置兑换码过期时间
5. THE System SHALL 支持作废兑换码
6. THE System SHALL 支持查询兑换码列表和使用记录

### 需求 5：兑换码兑换

**用户故事：** 作为用户，我希望能够使用兑换码获取会员或积分，以便通过活动或购买获得权益。

#### 验收标准

1. WHEN 用户使用有效兑换码且兑换类型包含会员时，THE System SHALL 创建会员记录
2. WHEN 用户使用有效兑换码且兑换类型包含积分时，THE System SHALL 创建积分记录
3. WHEN 兑换类型为会员和积分时，THE System SHALL 将积分有效期设置为与会员有效期相同
4. WHEN 兑换类型为仅积分时，THE System SHALL 将积分有效期设置为从兑换时刻起1年
5. WHEN 兑换成功时，THE System SHALL 将兑换码标记为已使用
6. IF 兑换码已使用、已过期或已作废，THEN THE System SHALL 拒绝兑换并返回相应错误

### 需求 6：后台管理界面

**用户故事：** 作为系统管理员，我希望能够在后台管理界面管理营销活动和兑换码。

#### 验收标准

1. THE System SHALL 提供营销活动管理页面，支持创建、编辑、启用/禁用活动
2. THE System SHALL 提供兑换码管理页面，支持创建、批量生成、作废兑换码
3. THE System SHALL 提供兑换记录查询页面

## 实现状态

所有需求已完成实现和测试。
