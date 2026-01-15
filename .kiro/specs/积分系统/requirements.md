# 需求文档

## 简介

本文档定义了 LexSeek 法律服务 AI 应用的积分系统功能需求。积分系统是会员体系的核心组成部分，用于记录用户获取和消耗积分的行为，支持多种积分来源和消耗场景。

本文档整合自以下原始 spec：
- point-system（积分系统核心）
- unified-point-service（统一积分服务）
- gift-points-effective-date-fix（赠送积分有效期修复）

## 术语表

- **Point_System**: 积分系统，管理用户积分的获取、消耗和查询
- **pointRecords**: 积分记录表，记录用户获取积分的详细信息
- **pointConsumptionItems**: 积分消耗项目表，定义可消耗积分的功能或服务
- **pointConsumptionRecords**: 积分消耗记录表，记录用户消耗积分的详细信息
- **FIFO_Strategy**: 先进先出策略，即先到期的积分先被消耗

## 需求

### 需求 1：积分记录数据模型

**用户故事：** 作为系统管理员，我希望能够管理用户的积分记录，以便追踪积分的获取和使用情况。

#### 验收标准

1. THE Point_System SHALL 创建 pointRecords 表，包含以下字段：
   - id: 主键，自增
   - userId: 用户ID，外键关联 users 表
   - pointAmount: 积分数量
   - used: 已使用积分数量
   - remaining: 剩余积分数量
   - sourceType: 积分来源类型
   - sourceId: 来源ID，可选
   - userMembershipId: 用户会员记录ID，可选
   - effectiveAt: 生效时间
   - expiredAt: 过期时间
   - status: 积分状态
   - remark: 备注，可选

2. THE Point_System SHALL 支持以下积分来源类型：
   - MEMBERSHIP_GIFT = 1: 购买会员赠送
   - DIRECT_PURCHASE = 2: 直接购买
   - EXCHANGE_CODE_GIFT = 3: 兑换码赠送
   - ACTIVITY_REWARD = 5: 活动奖励
   - REGISTER_GIFT = 7: 注册赠送
   - INVITATION_TO_REGISTER = 8: 邀请注册赠送
   - MEMBERSHIP_UPGRADE_COMPENSATION = 9: 会员升级补偿

3. THE Point_System SHALL 支持以下积分状态：
   - VALID = 1: 有效
   - MEMBERSHIP_UPGRADE_SETTLEMENT = 2: 会员升级结算
   - CANCELLED = 3: 已作废

4. WHEN 创建积分记录时，THE Point_System SHALL 自动设置 remaining 等于 pointAmount，used 为 0

### 需求 2：积分消耗项目数据模型

**用户故事：** 作为系统管理员，我希望能够定义积分消耗项目，以便控制用户可以用积分兑换的功能或服务。

#### 验收标准

1. THE Point_System SHALL 创建 pointConsumptionItems 表，包含以下字段：
   - id: 主键，自增
   - group: 分组名称
   - name: 项目名称
   - description: 项目描述，可选
   - unit: 计量单位
   - pointAmount: 消耗积分数量
   - discount: 折扣，默认为 1
   - status: 状态，1-启用，0-禁用

2. THE Point_System SHALL 支持启用/禁用积分消耗项目

### 需求 3：积分消耗记录数据模型

**用户故事：** 作为系统管理员，我希望能够记录用户的积分消耗行为，以便追踪积分的使用情况。

#### 验收标准

1. THE Point_System SHALL 创建 pointConsumptionRecords 表，包含以下字段：
   - id: 主键，自增
   - userId: 用户ID
   - pointRecordId: 积分记录ID
   - itemId: 消耗项目ID
   - pointAmount: 消耗积分数量
   - status: 状态（无效、预扣、已结算）
   - sourceId: 资源ID，可选
   - remark: 备注，可选

### 需求 4：积分查询接口

**用户故事：** 作为用户，我希望能够查询我的积分信息，以便了解我的积分余额和使用情况。

#### 验收标准

1. WHEN 用户请求 GET /api/v1/points/info 时，THE Point_System SHALL 返回用户的积分汇总信息：
   - pointAmount: 总积分
   - used: 已使用积分
   - remaining: 剩余积分
   - purchasePoint: 购买获得的积分
   - otherPoint: 其他来源积分

2. WHEN 用户请求 GET /api/v1/points/records 时，THE Point_System SHALL 返回分页的积分获取记录列表

3. WHEN 用户请求 GET /api/v1/points/usage 时，THE Point_System SHALL 返回分页的积分消耗记录列表

4. THE Point_System SHALL 仅统计状态为 VALID 且未过期的积分记录

### 需求 5：积分消耗逻辑

**用户故事：** 作为用户，我希望能够使用积分兑换功能或服务，以便获得相应的权益。

#### 验收标准

1. WHEN 用户请求消耗积分时，THE Point_System SHALL 验证用户剩余积分是否足够
2. IF 用户剩余积分不足，THEN THE Point_System SHALL 返回积分不足的错误信息
3. WHEN 消耗积分时，THE Point_System SHALL 采用先到期先消耗（FIFO）策略
4. WHEN 消耗积分时，THE Point_System SHALL 按 expiredAt 升序依次从积分记录中扣除
5. WHEN 积分消耗成功时，THE Point_System SHALL 创建 pointConsumptionRecords 记录
6. WHEN 积分消耗成功时，THE Point_System SHALL 更新相关 pointRecords 的 used 和 remaining 字段
7. WHEN 积分消耗项目被禁用时，THE Point_System SHALL 阻止用户使用该项目消耗积分

### 需求 6：积分发放逻辑

**用户故事：** 作为系统，我希望能够在特定场景下自动发放积分给用户，以便激励用户行为。

#### 验收标准

1. WHEN 用户购买会员时，THE Point_System SHALL 根据商品配置发放赠送积分
2. WHEN 用户使用兑换码时，THE Point_System SHALL 根据兑换码配置发放赠送积分
3. WHEN 新用户注册时，THE Point_System SHALL 根据活动配置发放注册赠送积分
4. WHEN 被邀请用户注册成功时，THE Point_System SHALL 为邀请人发放邀请奖励积分
5. WHEN 用户会员升级时，THE Point_System SHALL 发放补偿积分
6. THE Point_System SHALL 为每次积分发放设置合理的有效期

### 需求 7：积分数据完整性

**用户故事：** 作为系统管理员，我希望积分操作具有事务性，以便确保数据一致性。

#### 验收标准

1. WHEN 执行积分消耗操作时，THE Point_System SHALL 使用 Prisma 事务确保原子性
2. IF 积分消耗过程中发生错误，THEN THE Point_System SHALL 回滚所有相关操作
3. THE Point_System SHALL 确保 pointRecords 的 remaining 字段始终等于 pointAmount 减去 used
4. THE Point_System SHALL 确保 pointConsumptionRecords 的总消耗量与 pointRecords 的 used 字段一致
5. WHEN 积分记录被作废时，THE Point_System SHALL 更新 status 为 CANCELLED 而非物理删除

### 需求 8：赠送积分有效期

**用户故事：** 作为系统，我希望赠送积分能够正确设置生效时间，以便积分在正确的时间可用。

#### 验收标准

1. WHEN 创建赠送积分记录时，THE Point_System SHALL 支持设置 effectiveAt 生效时间
2. THE Point_System SHALL 只统计 effectiveAt <= 当前时间 的积分记录为可用积分
3. WHEN 积分与会员关联时，积分有效期 SHALL 与会员有效期保持一致

## 实现状态

所有需求已完成实现和测试。
