# 实现任务

## 任务 1：数据库模型修改

### 描述
为 `point_records` 表添加 `transferOut` 和 `transferToRecordId` 字段，为 `membership_upgrade_records` 表添加 `transferPoints` 和 `details` 字段。

### 文件
- `prisma/models/point.prisma`
- `prisma/models/order.prisma`

### 验收标准
- [x] `point_records` 表包含 `transfer_out` 字段（Int，可空，默认 0）
- [x] `point_records` 表包含 `transfer_to_record_id` 字段（Int，可空）
- [x] `membership_upgrade_records` 表包含 `transfer_points` 字段（Int，默认 0）
- [x] `membership_upgrade_records` 表包含 `details` 字段（Json，可空）
- [x] 数据库迁移成功执行

**Validates: Requirements 5, 7.7, 7.8**

---

## 任务 2：类型定义更新

### 描述
更新会员和积分相关的类型定义，添加已结算状态和新的积分来源类型。

### 文件
- `shared/types/membership.ts`
- `shared/types/point.types.ts`

### 验收标准
- [x] `MembershipStatus` 包含 `SETTLED = 2`（已结算）
- [x] `PointRecordStatus` 枚举包含 `MEMBERSHIP_UPGRADE_SETTLEMENT = 2`（已在 point.types.ts 中定义）
- [x] `PointRecordSourceType` 枚举包含 `MEMBERSHIP_UPGRADE_COMPENSATION = 9`、`MEMBERSHIP_UPGRADE_TRANSFER = 10`
- [x] 新增 `UpgradeDetails` 接口定义 details JSON 结构

**Validates: Requirements 6, 8**

---

## 任务 3：重构会员升级服务

### 描述
重构 `executeMembershipUpgradeService` 函数，实现完整的结算逻辑。

### 文件
- `server/services/membership/membershipUpgrade.service.ts`
- `server/services/membership/membershipUpgrade.dao.ts`
- `server/api/v1/memberships/upgrade/index.post.ts`

### 验收标准
- [x] 旧会员记录 endDate 更新为结算日期，status 更新为 2
- [x] 新会员记录 startDate 为结算日期，endDate 为旧会员原 endDate
- [x] 旧积分记录 status 更新为 2，remaining 更新为 0
- [x] 旧积分记录 transferOut 记录转出数量，transferToRecordId 指向转入记录
- [x] 创建转入积分记录（sourceType = 10）
- [x] 创建补偿积分记录（sourceType = 9，remark 包含订单号）
- [x] 创建升级记录，包含 transferPoints 和 details JSON
- [x] 所有操作在同一事务中执行
- [x] 更新 API 调用传入 orderNo 参数
- [x] 更新测试文件中的调用

**Validates: Requirements 1, 2, 3, 4, 7, 9**

---

## 任务 4：更新 DAO 查询过滤

### 描述
更新积分和会员相关的 DAO 查询，确保只返回有效记录（status = 1）。

### 文件
- `server/services/membership/userMembership.dao.ts`
- `server/services/point/pointRecords.dao.ts`

### 验收标准
- [x] 查询有效会员时过滤 status = 1（已在 findCurrentUserMembershipDao 中实现）
- [x] 查询有效积分时过滤 status = 1（findPointRecordsByMembershipIdDao 添加可选 status 参数）
- [x] 已结算记录（status = 2）不会被返回（通过传入 status: PointRecordStatus.VALID 过滤）

**Validates: Requirements 6.3, 6.4**

---

## 任务 5：编写属性测试

### 描述
使用 fast-check 编写属性测试，验证会员升级结算逻辑的正确性。

### 文件
- `tests/server/membership/membership-upgrade-settlement.test.ts`

### 验收标准
- [x] 测试会员记录结算正确性（Property 1）
- [x] 测试积分记录结算正确性（Property 2）
- [x] 测试转入积分记录正确性（Property 3）
- [x] 测试补偿积分记录正确性（Property 4）
- [x] 测试升级记录正确性（Property 5）
- [x] 测试积分总量守恒（Property 6）
- [x] 测试状态过滤正确性（Property 7）

**Validates: All Properties**
