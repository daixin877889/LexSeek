# 需求文档

## 简介

本文档定义了 LexSeek 法律服务 AI 应用的会员系统需求。该系统基于 lexseekApi 项目的会员逻辑进行重构，支持多种会员获取方式、会员级别管理、权益分配、会员升级等功能，与现有的积分系统深度集成。

## 术语表

- **会员系统 (Membership_System)**: 管理用户会员状态、级别、权益的核心系统
- **会员级别 (Membership_Level)**: 定义不同等级的会员，包含名称、描述、排序等属性
- **用户会员记录 (User_Membership)**: 记录用户的会员信息，包括级别、有效期、来源等
- **权益 (Benefit)**: 会员可享受的特定功能或服务
- **营销活动 (Marketing_Campaign)**: 用于配置会员和积分赠送规则的活动，支持设置起止日期
- **兑换码 (Redemption_Code)**: 用于兑换会员或积分的唯一代码
- **商品 (Product)**: 可购买的会员商品或积分商品
- **支付订单 (Payment_Order)**: 用户购买商品时创建的订单记录
- **会员升级 (Membership_Upgrade)**: 用户从低级别会员升级到高级别会员的过程

## 需求

### 需求 1：会员级别管理

**用户故事：** 作为系统管理员，我希望能够管理会员级别，以便为不同等级的用户提供差异化服务。

#### 验收标准

1. THE Membership_System SHALL 支持创建、查询、更新会员级别
2. WHEN 创建会员级别时，THE Membership_System SHALL 要求提供名称、描述、排序顺序
3. THE Membership_System SHALL 通过 sortOrder 字段确定级别高低，数字越小级别越高
4. WHEN 查询会员级别列表时，THE Membership_System SHALL 按 sortOrder 升序返回
5. THE Membership_System SHALL 支持启用或禁用会员级别

### 需求 2：用户会员记录管理

**用户故事：** 作为用户，我希望能够查看我的会员状态和历史记录，以便了解我的会员权益。

#### 验收标准

1. THE Membership_System SHALL 为每个用户维护会员记录，包含级别、开始日期、到期日期、来源类型
2. WHEN 用户查询会员信息时，THE Membership_System SHALL 返回当前有效的会员记录
3. WHEN 用户查询会员历史时，THE Membership_System SHALL 返回所有会员记录列表
4. THE Membership_System SHALL 支持以下会员来源类型：兑换码兑换、直接购买、管理员赠送、活动奖励、试用、注册赠送、邀请注册赠送、会员升级
5. WHEN 会员到期时，THE Membership_System SHALL 自动将会员状态标记为无效

### 需求 3：营销活动管理

**用户故事：** 作为系统管理员，我希望能够统一管理各类营销活动，以便灵活配置会员和积分的赠送规则。

#### 验收标准

1. THE Membership_System SHALL 支持创建营销活动，包含活动名称、活动类型、起止日期、状态
2. THE Membership_System SHALL 支持以下营销活动类型：注册赠送、邀请注册奖励、活动奖励
3. THE Membership_System SHALL 支持为每个营销活动配置奖励内容，包括会员级别、会员时长、积分数量
4. WHEN 活动未开始或已结束时，THE Membership_System SHALL 不执行该活动的奖励逻辑
5. WHEN 活动状态为禁用时，THE Membership_System SHALL 不执行该活动的奖励逻辑
6. THE Membership_System SHALL 支持查询活动列表和活动详情

### 需求 4：注册赠送活动

**用户故事：** 作为新用户，我希望注册后能获得试用会员，以便体验系统功能。

#### 验收标准

1. WHEN 存在有效的注册赠送活动且新用户注册成功时，THE Membership_System SHALL 自动创建会员记录
2. WHEN 注册赠送活动配置了赠送积分时，THE Membership_System SHALL 同时创建积分记录
3. IF 当前时间不在活动有效期内，THEN THE Membership_System SHALL 不创建任何会员或积分记录
4. IF 不存在有效的注册赠送活动，THEN THE Membership_System SHALL 不创建任何会员或积分记录

### 需求 5：邀请注册奖励活动

**用户故事：** 作为老用户，我希望邀请新用户注册后能获得奖励，以便激励我推广产品。

#### 验收标准

1. WHEN 存在有效的邀请奖励活动且被邀请人注册成功时，THE Membership_System SHALL 为邀请人创建会员记录
2. WHEN 邀请奖励活动配置了奖励积分时，THE Membership_System SHALL 同时为邀请人创建积分记录
3. IF 当前时间不在活动有效期内，THEN THE Membership_System SHALL 不创建任何邀请奖励记录
4. IF 用户没有邀请人，THEN THE Membership_System SHALL 不创建任何邀请奖励记录

### 需求 6：兑换码兑换会员

**用户故事：** 作为用户，我希望能够使用兑换码获取会员或积分，以便通过活动或购买获得权益。

#### 验收标准

1. THE Membership_System SHALL 支持创建兑换码，包含兑换码、兑换类型、会员级别、会员时长、积分数量
2. THE Membership_System SHALL 支持以下兑换类型：仅会员、仅积分、会员和积分
3. WHEN 用户使用有效兑换码且兑换类型包含会员时，THE Membership_System SHALL 创建会员记录
4. WHEN 用户使用有效兑换码且兑换类型包含积分时，THE Membership_System SHALL 创建积分记录
5. WHEN 兑换类型为会员和积分时，THE Membership_System SHALL 将积分有效期设置为与会员有效期相同
6. WHEN 兑换类型为仅积分时，THE Membership_System SHALL 将积分有效期设置为从兑换时刻起1年
7. WHEN 兑换成功时，THE Membership_System SHALL 将兑换码标记为已使用
8. IF 兑换码已使用、已过期或已作废，THEN THE Membership_System SHALL 拒绝兑换并返回相应错误
9. THE Membership_System SHALL 支持查询兑换码信息和用户的兑换记录

### 需求 7：商品购买会员

**用户故事：** 作为用户，我希望能够购买会员商品，以便获得更多功能和权益。

#### 验收标准

1. THE Membership_System SHALL 支持创建会员商品，包含名称、月度价格、年度价格、关联级别、赠送积分
2. THE Membership_System SHALL 支持创建积分商品，包含名称、单价、积分数量
3. WHEN 用户购买会员商品时，THE Membership_System SHALL 创建支付订单
4. WHEN 支付成功时，THE Membership_System SHALL 创建会员记录并发放赠送积分
5. WHEN 购买积分商品且支付成功时，THE Membership_System SHALL 创建积分记录，有效期为1年

### 需求 8：会员升级

**用户故事：** 作为会员用户，我希望能够升级到更高级别的会员，以便获得更多权益。

#### 验收标准

1. THE Membership_System SHALL 支持查询当前会员可升级的目标级别列表
2. THE Membership_System SHALL 按以下公式计算升级价格：升级价格 = 目标级别剩余价值 - 原级别剩余价值
3. THE Membership_System SHALL 按以下公式计算积分补偿：积分补偿 = 升级价格 × 10
4. WHEN 用户确认升级并支付成功时，THE Membership_System SHALL 创建新会员记录并失效原会员记录
5. WHEN 会员升级成功时，THE Membership_System SHALL 将原会员剩余积分转移到新会员并发放积分补偿
6. THE Membership_System SHALL 记录会员升级历史

### 需求 9：会员权益管理

**用户故事：** 作为系统管理员，我希望能够管理会员权益，以便为不同级别的会员提供差异化服务。

#### 验收标准

1. THE Membership_System SHALL 支持创建权益定义，包含名称、描述、类型、值
2. THE Membership_System SHALL 支持将权益关联到会员级别
3. WHEN 用户获得会员时，THE Membership_System SHALL 自动分配对应级别的权益
4. WHEN 用户查询权益时，THE Membership_System SHALL 返回当前有效的权益列表

### 需求 10：积分系统集成

**用户故事：** 作为用户，我希望会员系统与积分系统无缝集成，以便统一管理我的权益。

#### 验收标准

1. THE Membership_System SHALL 在创建会员记录时关联积分记录的 userMembershipId 字段
2. WHEN 会员升级时，THE Membership_System SHALL 将原会员关联的积分记录转移到新会员
3. THE Membership_System SHALL 支持查询用户的可用积分，区分购买获得和其他来源
4. THE Membership_System SHALL 采用先到期先消耗的策略消耗积分

### 需求 11：支付系统集成

**用户故事：** 作为用户，我希望能够通过多种支付方式购买会员和积分，以便方便快捷地完成支付。

#### 验收标准

1. THE Membership_System SHALL 提供统一的支付接口，支持创建订单、查询订单、处理回调
2. THE Membership_System SHALL 采用适配器模式实现支付渠道，预留扩展能力
3. THE Membership_System SHALL 实现微信支付适配器，支持 JSAPI、Native、H5 等支付方式
4. WHEN 创建支付订单时，THE Membership_System SHALL 调用对应支付适配器生成支付参数
5. WHEN 收到支付回调时，THE Membership_System SHALL 调用对应支付适配器验证签名
6. WHEN 支付验证成功时，THE Membership_System SHALL 更新订单状态并执行业务逻辑
7. THE Membership_System SHALL 支持主动查询订单支付状态
8. THE Membership_System SHALL 采用策略模式处理不同商品类型的支付成功逻辑
9. IF 支付适配器验证失败，THEN THE Membership_System SHALL 记录错误日志并返回失败响应

### 需求 12：数据序列化

**用户故事：** 作为开发者，我希望会员数据能够正确序列化和反序列化，以便在前后端之间传输。

#### 验收标准

1. THE Membership_System SHALL 将会员级别数据序列化为 JSON 格式
2. THE Membership_System SHALL 将用户会员记录数据序列化为 JSON 格式
3. FOR ALL 有效的会员数据对象，序列化后再反序列化 SHALL 产生等价的对象（往返属性）
