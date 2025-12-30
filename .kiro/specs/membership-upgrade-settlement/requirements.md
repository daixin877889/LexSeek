# 需求文档

## 简介

重构会员升级功能，实现完整的结算逻辑。当用户升级会员时，需要对旧会员记录和关联的积分记录进行结算，生成新的会员记录和积分记录，确保数据的完整性和可追溯性。

## 术语表

- **User_Membership**: 用户会员记录，包含开始日期、结束日期和状态
- **Point_Record**: 积分记录，包含积分数量、生效时间、过期时间和状态
- **Settlement**: 结算，指将旧记录标记为已结算状态，并生成新的记录
- **Transfer_Points**: 转入积分，从旧会员记录转移到新会员记录的积分
- **Compensation_Points**: 补偿积分，升级时根据补差价赠送的积分
- **Membership_Upgrade_Service**: 会员升级服务

## 需求

### 需求 1：会员记录结算

**用户故事：** 作为系统，我希望在用户升级会员时对旧会员记录进行结算，以便保持数据的完整性和可追溯性。

#### 验收标准

**场景 A：预购场景（结算日期在原会员开始日期之前）**

1. WHEN 用户执行会员升级且结算日期在原会员开始日期之前 THEN Membership_Upgrade_Service SHALL 保持旧会员记录的结束日期不变
2. WHEN 用户执行会员升级且结算日期在原会员开始日期之前 THEN Membership_Upgrade_Service SHALL 将旧会员记录的状态更新为"已结算"（status = 2），并记录 settlementAt
3. WHEN 用户执行会员升级且结算日期在原会员开始日期之前 THEN Membership_Upgrade_Service SHALL 创建新会员记录，开始日期为原会员的开始日期
4. WHEN 用户执行会员升级且结算日期在原会员开始日期之前 THEN 新会员记录的结束日期 SHALL 等于旧会员记录原来的结束日期

**场景 B：正常升级场景（结算日期在原会员有效期内）**

5. WHEN 用户执行会员升级且结算日期在原会员有效期内 THEN Membership_Upgrade_Service SHALL 将旧会员记录的结束日期更新为结算日期前一天
6. WHEN 用户执行会员升级且结算日期在原会员有效期内 THEN Membership_Upgrade_Service SHALL 将旧会员记录的状态更新为"已结算"（status = 2），并记录 settlementAt
7. WHEN 用户执行会员升级且结算日期在原会员有效期内 THEN Membership_Upgrade_Service SHALL 创建新会员记录，开始日期为结算日期
8. WHEN 用户执行会员升级且结算日期在原会员有效期内 THEN 新会员记录的结束日期 SHALL 等于旧会员记录原来的结束日期

### 需求 2：积分记录结算

**用户故事：** 作为系统，我希望在用户升级会员时对旧积分记录进行结算，以便准确追踪积分的流转。

#### 验收标准

1. WHEN 用户执行会员升级 THEN Membership_Upgrade_Service SHALL 将旧会员关联的所有积分记录状态更新为"已结算"（status = 2）
2. WHEN 用户执行会员升级 THEN Membership_Upgrade_Service SHALL 将旧积分记录的 remaining 设为 0
3. WHEN 用户执行会员升级 THEN Membership_Upgrade_Service SHALL 记录旧积分记录的 transferOut（转出积分数量）
4. WHEN 用户执行会员升级 THEN Membership_Upgrade_Service SHALL 记录旧积分记录的 transferToRecordId（转出目标记录 ID）

### 需求 3：转入积分记录生成

**用户故事：** 作为用户，我希望升级会员后原有会员关联的剩余积分能够转移到新会员记录，以便继续使用。

#### 验收标准

1. WHEN 用户执行会员升级且旧会员关联的积分记录有剩余积分 THEN Membership_Upgrade_Service SHALL 创建一条新的转入积分记录
2. THE 转入积分记录的 pointAmount SHALL 等于旧会员记录关联的所有积分记录的 remaining 之和（不是用户所有积分之和）
3. THE 转入积分记录的 effectiveAt SHALL 根据场景确定：
   - 预购场景：等于原会员记录的 startDate
   - 正常升级场景：等于结算日期
4. THE 转入积分记录的 expiredAt SHALL 等于新会员记录的 endDate
5. THE 转入积分记录的 remark SHALL 为"会员升级转入积分"
6. THE 转入积分记录的 sourceType SHALL 为 9（会员升级转入）

### 需求 4：补偿积分记录生成

**用户故事：** 作为用户，我希望升级会员补差价时能获得相应的积分补偿，以便获得更多权益。

#### 验收标准

1. WHEN 用户执行会员升级且补偿积分大于 0 THEN Membership_Upgrade_Service SHALL 创建一条补偿积分记录
2. THE 补偿积分记录的 effectiveAt SHALL 根据场景确定：
   - 预购场景：等于原会员记录的 startDate
   - 正常升级场景：等于结算日期
3. THE 补偿积分记录的 expiredAt SHALL 等于新会员记录的 endDate
4. THE 补偿积分记录的 remark SHALL 为"会员升级补偿积分，订单号：{orderNo}"
5. THE 补偿积分记录的 sourceType SHALL 为 8（会员升级补偿）

### 需求 5：数据模型扩展

**用户故事：** 作为系统管理员，我希望积分记录能够追踪转出信息，以便进行数据审计和问题排查。

#### 验收标准

1. THE Point_Record 数据模型 SHALL 包含 transferOut 字段（转出积分数量）
2. THE Point_Record 数据模型 SHALL 包含 transferToRecordId 字段（转出目标记录 ID）
3. WHEN 积分被转出 THEN transferOut SHALL 记录转出的积分数量
4. WHEN 积分被转出 THEN transferToRecordId SHALL 记录转入的积分记录 ID

### 需求 6：会员状态定义

**用户故事：** 作为系统，我希望会员和积分记录有明确的状态定义，以便正确处理各种业务场景。

#### 验收标准

1. THE User_Membership 状态 SHALL 包含：1-有效，0-无效，2-已结算
2. THE Point_Record 状态 SHALL 包含：1-有效，0-无效，2-已结算
3. WHEN 查询有效积分 THEN 系统 SHALL 只返回 status = 1 的记录
4. WHEN 查询有效会员 THEN 系统 SHALL 只返回 status = 1 的记录

### 需求 7：升级记录

**用户故事：** 作为系统管理员，我希望能够追踪所有会员升级记录，以便进行数据审计和问题排查。

#### 验收标准

1. WHEN 用户执行会员升级 THEN Membership_Upgrade_Service SHALL 在 membership_upgrade_records 表中创建一条升级记录
2. THE 升级记录 SHALL 包含 fromMembershipId（原会员记录 ID）
3. THE 升级记录 SHALL 包含 toMembershipId（新会员记录 ID）
4. THE 升级记录 SHALL 包含 orderId（订单 ID）
5. THE 升级记录 SHALL 包含 upgradePrice（升级价格）
6. THE 升级记录 SHALL 包含 pointCompensation（补偿积分数量）
7. THE 升级记录 SHALL 包含 transferPoints（转入积分数量）- 需要新增字段
8. THE 升级记录 SHALL 包含 details（JSON 字段）- 需要新增字段，记录详细的关联关系

### 需求 8：升级记录详情（details JSON 字段）

**用户故事：** 作为系统管理员，我希望能够查看升级过程中所有记录的详细关联关系，以便进行问题排查和数据审计。

#### 验收标准

1. THE details JSON 字段 SHALL 包含 oldMembership 对象（旧会员记录信息）
2. THE details JSON 字段 SHALL 包含 newMembership 对象（新会员记录信息）
3. THE details JSON 字段 SHALL 包含 oldPointRecords 数组（旧积分记录列表，包含 id、remaining、transferOut、transferToRecordId）
4. THE details JSON 字段 SHALL 包含 newPointRecords 对象（新积分记录信息，包含 transferRecordId 和 compensationRecordId）

### 需求 9：事务一致性

**用户故事：** 作为系统，我希望会员升级的所有操作在一个事务中完成，以确保数据一致性。

#### 验收标准

1. WHEN 用户执行会员升级 THEN 所有数据库操作 SHALL 在同一个事务中执行
2. IF 任何操作失败 THEN 事务 SHALL 回滚所有已执行的操作
3. WHEN 事务成功提交 THEN 所有记录 SHALL 保持一致状态
