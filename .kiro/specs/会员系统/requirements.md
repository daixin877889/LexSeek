# 需求文档

## 简介

本文档定义了 LexSeek 法律服务 AI 应用的会员系统需求。该系统支持多种会员获取方式、会员级别管理、权益分配、会员升级等功能，与积分系统深度集成。

本文档整合自以下原始 spec：
- membership-system（会员系统核心）
- membership-benefits（会员权益）
- membership-upgrade-calculation（升级计算）
- membership-upgrade-settlement（升级结算）
- membership-payment-fixes（支付修复）

## 术语表

- **会员系统 (Membership_System)**: 管理用户会员状态、级别、权益的核心系统
- **会员级别 (Membership_Level)**: 定义不同等级的会员，包含名称、描述、排序等属性
- **用户会员记录 (User_Membership)**: 记录用户的会员信息，包括级别、有效期、来源等
- **权益 (Benefit)**: 会员可享受的特定功能或服务
- **会员升级 (Membership_Upgrade)**: 用户从低级别会员升级到高级别会员的过程
- **Benefit_Code**: 权益类型标识码，如 `storage_space`
- **Consumption_Mode**: 权益计算模式，累加型（SUM）或取最大值型（MAX）

## 需求

### 需求 1：会员级别管理

**用户故事：** 作为系统管理员，我希望能够管理会员级别，以便为不同等级的用户提供差异化服务。

#### 验收标准

1. THE Membership_System SHALL 支持创建、查询、更新会员级别
2. WHEN 创建会员级别时，THE Membership_System SHALL 要求提供名称、描述、排序顺序
3. THE Membership_System SHALL 通过 sortOrder 字段确定级别高低，数字越大级别越高
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

### 需求 3：会员升级

**用户故事：** 作为会员用户，我希望能够升级到更高级别的会员，以便获得更多权益。

#### 验收标准

1. THE Membership_System SHALL 支持查询当前会员可升级的目标级别列表
2. THE Membership_System SHALL 按以下公式计算升级价格：升级价格 = 目标级别剩余价值 - 原级别剩余价值
3. THE Membership_System SHALL 按以下公式计算积分补偿：积分补偿 = 升级价格 × 10
4. WHEN 用户确认升级并支付成功时，THE Membership_System SHALL 创建新会员记录并失效原会员记录
5. WHEN 会员升级成功时，THE Membership_System SHALL 将原会员剩余积分转移到新会员并发放积分补偿
6. THE Membership_System SHALL 记录会员升级历史

### 需求 4：权益类型定义

**用户故事：** 作为系统管理员，我希望能够定义系统中的权益类型，以便为不同会员级别配置不同的权益。

#### 验收标准

1. THE Benefits 表 SHALL 包含权益的唯一标识码（code）、名称、描述、单位类型、最小单位、计算模式和默认值字段
2. WHEN 创建权益类型时，THE System SHALL 验证权益标识码的唯一性
3. THE System SHALL 支持云盘空间权益类型：`storage_space`，单位为 Byte，计算模式为累加型（SUM）
4. THE Benefits 表 SHALL 包含 `default_value` 字段，用于定义无会员用户的默认权益值

### 需求 5：会员级别权益配置

**用户故事：** 作为系统管理员，我希望能够为每个会员级别配置不同的权益值，以便区分不同级别会员的服务。

#### 验收标准

1. THE Membership_Benefits 表 SHALL 关联会员级别和权益，并存储该级别对应的权益值
2. WHEN 管理员配置会员权益时，THE System SHALL 允许为同一会员级别配置多个不同的权益
3. THE System SHALL 在后台管理界面提供会员权益配置页面
4. WHEN 保存会员权益配置时，THE System SHALL 验证权益值的有效性（非负数）

### 需求 6：用户权益记录

**用户故事：** 作为系统，我希望能够记录每个用户的权益，以便追踪用户的权益来源和有效期。

#### 验收标准

1. THE User_Benefits 表 SHALL 记录用户ID、权益ID、权益值、来源类型、来源ID、生效时间、过期时间
2. WHEN 用户获得新权益时（购买会员、购买权益包、兑换码等），THE System SHALL 创建对应的用户权益记录
3. WHEN 用户会员到期时，THE System SHALL 将对应的会员权益记录标记为过期
4. THE System SHALL 支持以下权益来源类型：会员赠送、权益包购买、兑换码兑换、管理员赠送、系统默认

### 需求 7：用户云盘空间权益计算

**用户故事：** 作为用户，我希望系统能够正确计算我当前可用的云盘空间，以便我了解自己的存储额度。

#### 验收标准

1. WHEN 计算用户云盘空间权益时，THE System SHALL 累加（SUM）所有生效中的云盘空间权益记录的权益值
2. IF 用户没有任何会员且没有购买权益包，THEN THE System SHALL 使用权益定义表中的默认值作为用户的云盘空间权益
3. THE System SHALL 只计算当前时间在生效时间和过期时间范围内的权益记录
4. WHEN 查询用户云盘空间使用量时，THE System SHALL 通过聚合 ossFiles 表中该用户的文件大小来计算

### 需求 8：权益自动发放

**用户故事：** 作为系统，我希望能够在用户获得会员时自动发放对应的权益，以便用户立即享受会员服务。

#### 验收标准

1. WHEN 用户购买会员或通过兑换码获得会员时，THE System SHALL 自动创建该会员级别对应的所有权益记录
2. THE System SHALL 将会员权益的生效时间设置为会员开始时间，过期时间设置为会员结束时间
3. WHEN 用户会员升级时，THE System SHALL 结算旧会员的权益记录，并创建新会员级别的权益记录
4. IF 用户购买独立的权益包，THEN THE System SHALL 创建独立的权益记录，不受会员状态影响

### 需求 9：云盘上传权益校验

**用户故事：** 作为用户，我希望在上传文件前能够知道是否有足够的存储空间，以便避免上传失败。

#### 验收标准

1. WHEN 用户请求生成上传签名时，THE System SHALL 校验用户的云盘空间权益是否足够容纳待上传的文件
2. THE System SHALL 计算用户当前已使用空间（ossFiles 表聚合）和权益总额（user_benefits 表聚合）
3. IF 已使用空间 + 待上传文件大小 > 权益总额，THEN THE System SHALL 拒绝生成上传签名并返回错误信息
4. THE System SHALL 在错误信息中包含：当前已使用空间、权益总额、剩余可用空间、待上传文件大小

### 需求 10：用户权益查询 API

**用户故事：** 作为前端开发者，我希望能够通过 API 查询用户的权益信息，以便在界面上展示用户的权益状态。

#### 验收标准

1. THE System SHALL 提供 `GET /api/v1/users/benefits` 接口，返回当前用户的所有有效权益
2. THE System SHALL 在返回的权益信息中包含：权益名称、权益总额、已使用量、剩余量、单位
3. WHEN 查询用户权益时，THE System SHALL 按权益类型分组返回，并计算每种权益的汇总值
4. THE System SHALL 提供 `GET /api/v1/users/benefits/:benefitCode` 接口，返回指定权益类型的详细信息

### 需求 11：数据序列化

**用户故事：** 作为开发者，我希望会员数据能够正确序列化和反序列化，以便在前后端之间传输。

#### 验收标准

1. THE Membership_System SHALL 将会员级别数据序列化为 JSON 格式
2. THE Membership_System SHALL 将用户会员记录数据序列化为 JSON 格式
3. FOR ALL 有效的会员数据对象，序列化后再反序列化 SHALL 产生等价的对象（往返属性）

## 实现状态

所有需求已完成实现和测试。
