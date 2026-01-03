# 设计文档

## 概述

本设计文档描述会员权益管理系统的技术实现方案，本阶段聚焦于云盘空间权益的管理和校验功能。

## 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层 (Frontend)                         │
├─────────────────────────────────────────────────────────────────┤
│  /dashboard/disk-space.vue    │    /admin/benefits/*            │
│  - 空间使用概览组件            │    - 权益类型管理页面            │
│  - 进度条展示                  │    - 会员权益配置页面            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API 层 (API Routes)                       │
├─────────────────────────────────────────────────────────────────┤
│  GET  /api/v1/users/benefits           - 查询用户权益汇总        │
│  GET  /api/v1/users/benefits/:code     - 查询指定权益详情        │
│  POST /api/v1/storage/presigned-url    - 上传签名（增加校验）    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      服务层 (Service Layer)                      │
├─────────────────────────────────────────────────────────────────┤
│  userBenefit.service.ts                                         │
│  - getUserBenefitSummary()      获取用户权益汇总                 │
│  - getUserStorageQuota()        获取用户云盘空间配额             │
│  - checkStorageQuota()          校验云盘空间是否足够             │
│  - grantMembershipBenefits()    发放会员权益                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      数据访问层 (DAO Layer)                      │
├─────────────────────────────────────────────────────────────────┤
│  userBenefit.dao.ts                                             │
│  - findUserActiveBenefits()     查询用户生效中的权益记录         │
│  - sumUserBenefitValue()        汇总用户指定权益的总值           │
│  - createUserBenefit()          创建用户权益记录                 │
│  - expireUserBenefits()         过期用户权益记录                 │
│                                                                 │
│  benefit.dao.ts (已存在)                                        │
│  - findBenefitByCode()          根据 code 查询权益定义           │
│                                                                 │
│  ossFiles.dao.ts (已存在)                                       │
│  - ossUsageDao()                获取用户 OSS 使用量              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      数据库层 (Database)                         │
├─────────────────────────────────────────────────────────────────┤
│  benefits              - 权益定义表（需修改）                    │
│  membership_benefits   - 会员级别权益关联表（需修改）            │
│  user_benefits         - 用户权益记录表（新增）                  │
│  oss_files             - OSS 文件表（已存在，用于计算使用量）    │
└─────────────────────────────────────────────────────────────────┘
```

## 数据库设计

### 1. benefits 表修改

修改现有 `benefits` 表结构，增加权益计算所需字段：

```prisma
/// 权益定义表
model benefits {
    /// 权益ID，主键，自增
    id              Int       @id @default(autoincrement())
    /// 权益唯一标识码（如 storage_space）
    code            String    @unique @db.VarChar(50)
    /// 权益名称
    name            String    @db.VarChar(100)
    /// 权益描述
    description     String?   @db.VarChar(255)
    /// 单位类型（byte-字节, count-次数）
    unitType        String    @map("unit_type") @db.VarChar(20)
    /// 计算模式（sum-累加, max-取最大值）
    consumptionMode String    @map("consumption_mode") @db.VarChar(20)
    /// 默认值（无会员用户的权益值）
    defaultValue    BigInt    @default(0) @map("default_value")
    /// 状态：1-启用，0-禁用
    status          Int       @default(1)
    /// 创建时间
    createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    /// 最后更新时间
    updatedAt       DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    /// 删除时间，为NULL表示未删除
    deletedAt       DateTime? @map("deleted_at") @db.Timestamptz(6)

    /// 关联的会员权益
    membershipBenefits membershipBenefits[]
    /// 关联的用户权益
    userBenefits       userBenefits[]

    @@index([code], map: "idx_benefits_code")
    @@index([status], map: "idx_benefits_status")
    @@index([deletedAt], map: "idx_benefits_deleted_at")
    @@map("benefits")
}
```

**字段说明：**
- `code`: 权益唯一标识码，用于程序中引用（如 `storage_space`）
- `unitType`: 单位类型，`byte` 表示字节，`count` 表示次数
- `consumptionMode`: 计算模式，`sum` 表示累加所有记录，`max` 表示取最大值
- `defaultValue`: 无会员用户的默认权益值

**删除字段：**
- `type`: 原有的类型字段，由 `code` 替代
- `value`: 原有的 JSON 值字段，由 `defaultValue` 替代

### 2. membership_benefits 表修改

修改现有 `membership_benefits` 表，增加权益值字段：

```prisma
/// 会员权益关联表
model membershipBenefits {
    /// 会员权益关联ID，主键，自增
    id           Int       @id @default(autoincrement())
    /// 会员级别ID
    levelId      Int       @map("level_id")
    /// 权益ID
    benefitId    Int       @map("benefit_id")
    /// 权益值
    benefitValue BigInt    @map("benefit_value")
    /// 创建时间
    createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    /// 最后更新时间
    updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    /// 删除时间，为NULL表示未删除
    deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(6)

    /// 关联的会员级别
    level   membershipLevels @relation(fields: [levelId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    /// 关联的权益
    benefit benefits         @relation(fields: [benefitId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@unique([levelId, benefitId])
    @@index([levelId], map: "idx_membership_benefits_level_id")
    @@index([benefitId], map: "idx_membership_benefits_benefit_id")
    @@index([deletedAt], map: "idx_membership_benefits_deleted_at")
    @@map("membership_benefits")
}
```

**新增字段：**
- `benefitValue`: 该会员级别对应的权益值（如 10GB = 10737418240 字节）

### 3. user_benefits 表新增

新增用户权益记录表：

```prisma
/// 用户权益记录表
model userBenefits {
    /// 用户权益记录ID，主键，自增
    id           Int       @id @default(autoincrement())
    /// 用户ID
    userId       Int       @map("user_id")
    /// 权益ID
    benefitId    Int       @map("benefit_id")
    /// 权益值
    benefitValue BigInt    @map("benefit_value")
    /// 来源类型：membership_gift-会员赠送, benefit_package-权益包购买, redemption_code-兑换码, admin_gift-管理员赠送
    sourceType   String    @map("source_type") @db.VarChar(50)
    /// 来源ID（关联到具体的会员记录、订单、兑换码等）
    sourceId     Int?      @map("source_id")
    /// 生效时间
    effectiveAt  DateTime  @map("effective_at") @db.Timestamptz(6)
    /// 过期时间
    expiredAt    DateTime  @map("expired_at") @db.Timestamptz(6)
    /// 状态：1-有效，0-无效
    status       Int       @default(1)
    /// 备注
    remark       String?   @db.VarChar(255)
    /// 创建时间
    createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    /// 最后更新时间
    updatedAt    DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    /// 删除时间，为NULL表示未删除
    deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(6)

    /// 关联的用户
    user    users    @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)
    /// 关联的权益
    benefit benefits @relation(fields: [benefitId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@index([userId], map: "idx_user_benefits_user_id")
    @@index([benefitId], map: "idx_user_benefits_benefit_id")
    @@index([sourceType], map: "idx_user_benefits_source_type")
    @@index([effectiveAt], map: "idx_user_benefits_effective_at")
    @@index([expiredAt], map: "idx_user_benefits_expired_at")
    @@index([status], map: "idx_user_benefits_status")
    @@index([deletedAt], map: "idx_user_benefits_deleted_at")
    @@map("user_benefits")
}
```

**字段说明：**
- `sourceType`: 权益来源类型枚举
  - `membership_gift`: 会员赠送（购买会员时自动发放）
  - `benefit_package`: 权益包购买
  - `redemption_code`: 兑换码兑换
  - `admin_gift`: 管理员赠送
- `sourceId`: 关联到具体来源记录的 ID
- `effectiveAt` / `expiredAt`: 权益生效和过期时间
- `status`: 权益状态，用于手动禁用权益

## API 设计

### 1. 获取用户权益汇总

**接口：** `GET /api/v1/users/benefits`

**响应：**
```typescript
interface UserBenefitSummaryResponse {
  benefits: {
    code: string           // 权益标识码
    name: string           // 权益名称
    totalValue: number     // 权益总额（原始值）
    usedValue: number      // 已使用量（原始值）
    remainingValue: number // 剩余量（原始值）
    unitType: string       // 单位类型
    formatted: {           // 格式化后的展示值
      total: string        // 如 "10 GB"
      used: string         // 如 "1.5 GB"
      remaining: string    // 如 "8.5 GB"
      percentage: number   // 使用率百分比，如 15
    }
  }[]
}
```

### 2. 获取指定权益详情

**接口：** `GET /api/v1/users/benefits/:benefitCode`

**响应：**
```typescript
interface UserBenefitDetailResponse {
  code: string
  name: string
  totalValue: number
  usedValue: number
  remainingValue: number
  unitType: string
  formatted: {
    total: string
    used: string
    remaining: string
    percentage: number
  }
  records: {              // 权益记录列表
    id: number
    benefitValue: number
    sourceType: string
    sourceTypeName: string
    effectiveAt: string
    expiredAt: string
    status: number
  }[]
}
```

### 3. 上传签名接口修改

**接口：** `POST /api/v1/storage/presigned-url`

**修改内容：** 在生成签名前增加云盘空间校验

**错误响应（空间不足）：**
```typescript
{
  success: false,
  code: 400,
  message: "云盘空间不足，已使用 1.5 GB / 总共 2 GB，剩余 0.5 GB，待上传文件 1 GB"
}
```

## 服务层设计

### userBenefit.service.ts

```typescript
/**
 * 获取用户权益汇总
 * @param userId 用户ID
 * @returns 用户所有权益的汇总信息
 */
export async function getUserBenefitSummaryService(userId: number): Promise<UserBenefitSummary[]>

/**
 * 获取用户云盘空间配额
 * @param userId 用户ID
 * @returns 云盘空间配额信息（总额、已用、剩余）
 */
export async function getUserStorageQuotaService(userId: number): Promise<StorageQuotaInfo>

/**
 * 校验用户云盘空间是否足够
 * @param userId 用户ID
 * @param requiredSize 需要的空间大小（字节）
 * @returns 校验结果，包含是否足够和详细信息
 */
export async function checkStorageQuotaService(userId: number, requiredSize: number): Promise<StorageQuotaCheckResult>

/**
 * 发放会员权益
 * @param userId 用户ID
 * @param membershipId 会员记录ID
 * @param levelId 会员级别ID
 * @param startDate 开始日期
 * @param endDate 结束日期
 */
export async function grantMembershipBenefitsService(
  userId: number,
  membershipId: number,
  levelId: number,
  startDate: Date,
  endDate: Date
): Promise<void>
```

### userBenefit.dao.ts

```typescript
/**
 * 查询用户生效中的权益记录
 * @param userId 用户ID
 * @param benefitCode 权益标识码（可选）
 */
export async function findUserActiveBenefitsDao(
  userId: number,
  benefitCode?: string
): Promise<UserBenefitRecord[]>

/**
 * 汇总用户指定权益的总值
 * @param userId 用户ID
 * @param benefitCode 权益标识码
 * @param consumptionMode 计算模式（sum/max）
 */
export async function sumUserBenefitValueDao(
  userId: number,
  benefitCode: string,
  consumptionMode: 'sum' | 'max'
): Promise<bigint>

/**
 * 创建用户权益记录
 */
export async function createUserBenefitDao(
  data: CreateUserBenefitInput,
  tx?: Prisma.TransactionClient
): Promise<userBenefits>

/**
 * 批量创建用户权益记录
 */
export async function createUserBenefitsDao(
  data: CreateUserBenefitInput[],
  tx?: Prisma.TransactionClient
): Promise<userBenefits[]>

/**
 * 过期用户权益记录（根据来源）
 */
export async function expireUserBenefitsBySourceDao(
  userId: number,
  sourceType: string,
  sourceId: number,
  tx?: Prisma.TransactionClient
): Promise<void>
```

## 类型定义

### shared/types/benefit.ts

```typescript
/** 权益标识码 */
export enum BenefitCode {
  /** 云盘空间 */
  STORAGE_SPACE = 'storage_space',
  /** 日案件分析限额（预留） */
  // DAILY_ANALYSIS_QUOTA = 'daily_analysis_quota',
  /** 月案件分析限额（预留） */
  // MONTHLY_ANALYSIS_QUOTA = 'monthly_analysis_quota',
  /** 案件分析并发数（预留） */
  // ANALYSIS_CONCURRENCY = 'analysis_concurrency',
}

/** 权益单位类型 */
export enum BenefitUnitType {
  /** 字节 */
  BYTE = 'byte',
  /** 次数 */
  COUNT = 'count',
}

/** 权益计算模式 */
export enum BenefitConsumptionMode {
  /** 累加（如云盘空间） */
  SUM = 'sum',
  /** 取最大值（如并发数） */
  MAX = 'max',
}

/** 权益来源类型 */
export enum BenefitSourceType {
  /** 会员赠送 */
  MEMBERSHIP_GIFT = 'membership_gift',
  /** 权益包购买 */
  BENEFIT_PACKAGE = 'benefit_package',
  /** 兑换码兑换 */
  REDEMPTION_CODE = 'redemption_code',
  /** 管理员赠送 */
  ADMIN_GIFT = 'admin_gift',
}

/** 用户权益汇总信息 */
export interface UserBenefitSummary {
  code: string
  name: string
  totalValue: number
  usedValue: number
  remainingValue: number
  unitType: string
  formatted: {
    total: string
    used: string
    remaining: string
    percentage: number
  }
}

/** 云盘空间配额信息 */
export interface StorageQuotaInfo {
  totalBytes: number
  usedBytes: number
  remainingBytes: number
  formatted: {
    total: string
    used: string
    remaining: string
    percentage: number
  }
}

/** 云盘空间校验结果 */
export interface StorageQuotaCheckResult {
  allowed: boolean
  quota: StorageQuotaInfo
  requiredSize: number
  requiredFormatted: string
  message?: string
}
```

## 前端组件设计

### disk-space.vue 修改

在页面顶部的存储空间显示区域，调用 `/api/v1/users/benefits/storage_space` 接口获取数据：

```vue
<script setup>
// 获取云盘空间权益信息
const { data: storageData } = await useApi('/api/v1/users/benefits/storage_space')

// 计算进度条颜色
const progressColor = computed(() => {
  const percentage = storageData.value?.formatted?.percentage || 0
  if (percentage >= 95) return 'bg-red-500'      // 危险色
  if (percentage >= 80) return 'bg-yellow-500'   // 警告色
  return 'bg-primary'                             // 正常色
})
</script>
```

**进度条颜色规则：**
- 使用率 < 80%: 主题色（正常）
- 使用率 >= 80% 且 < 95%: 黄色（警告）
- 使用率 >= 95%: 红色（危险）

## 正确性属性

基于需求文档的验收标准，定义以下正确性属性用于测试验证：

### P1: 权益值计算正确性
- **属性**: 对于 SUM 模式的权益，用户权益总值 = Σ(所有生效中权益记录的 benefitValue)
- **属性**: 对于 MAX 模式的权益，用户权益总值 = MAX(所有生效中权益记录的 benefitValue)
- **属性**: 无权益记录时，使用 benefits 表的 defaultValue

### P2: 权益生效时间正确性
- **属性**: 只有 effectiveAt <= 当前时间 <= expiredAt 且 status = 1 的记录才参与计算
- **属性**: 过期记录不参与权益计算

### P3: 云盘空间校验正确性
- **属性**: 当 usedBytes + requiredSize > totalBytes 时，checkStorageQuota 返回 allowed = false
- **属性**: 当 usedBytes + requiredSize <= totalBytes 时，checkStorageQuota 返回 allowed = true

### P4: 会员权益发放正确性
- **属性**: 发放会员权益后，用户应拥有该会员级别配置的所有权益记录
- **属性**: 权益记录的 effectiveAt 和 expiredAt 应与会员记录的 startDate 和 endDate 一致

### P5: 单位转换正确性
- **属性**: formatByteSize 函数对任意非负整数输入都返回有效的格式化字符串
- **属性**: 转换后的值与原始字节数在数学上等价

## 实现任务清单

### 阶段一：数据库变更
1. 修改 `benefits` 表结构
2. 修改 `membership_benefits` 表结构
3. 创建 `user_benefits` 表
4. 执行数据库迁移
5. 初始化云盘空间权益数据

### 阶段二：后端服务实现
1. 创建 `shared/types/benefit.ts` 类型定义
2. 创建 `userBenefit.dao.ts` 数据访问层
3. 创建 `userBenefit.service.ts` 服务层
4. 修改 `benefit.dao.ts` 增加 `findBenefitByCode` 方法

### 阶段三：API 实现
1. 实现 `GET /api/v1/users/benefits` 接口
2. 实现 `GET /api/v1/users/benefits/:benefitCode` 接口
3. 修改 `POST /api/v1/storage/presigned-url` 增加空间校验

### 阶段四：前端实现
1. 修改 `disk-space.vue` 页面，集成权益查询 API
2. 实现进度条颜色动态变化
3. 处理空间不足的错误提示

### 阶段五：会员权益发放集成
1. 修改会员购买流程，调用 `grantMembershipBenefitsService`
2. 修改兑换码兑换流程，调用 `grantMembershipBenefitsService`

## 测试策略

### 单元测试
- 权益值计算逻辑测试（SUM/MAX 模式）
- 单位转换函数测试
- 权益生效时间判断测试

### 集成测试
- 用户权益查询 API 测试
- 云盘空间校验 API 测试
- 会员权益发放流程测试

### 属性测试
- 使用 fast-check 验证权益计算的正确性属性
- 验证边界条件（空间刚好用完、刚好超出等）

## 后台管理 API 设计

### 1. 权益类型管理 API

#### 获取权益类型列表
**接口：** `GET /api/v1/admin/benefits`

**查询参数：**
- `page`: 页码，默认 1
- `pageSize`: 每页数量，默认 20
- `status`: 状态筛选（可选）
- `keyword`: 关键词搜索（可选）

**响应：**
```typescript
interface BenefitListResponse {
  items: {
    id: number
    code: string
    name: string
    description: string | null
    unitType: string
    consumptionMode: string
    defaultValue: string  // BigInt 转字符串
    status: number
    createdAt: string
    updatedAt: string
  }[]
  total: number
  totalPages: number
}
```

#### 创建权益类型
**接口：** `POST /api/v1/admin/benefits`

**请求体：**
```typescript
interface CreateBenefitRequest {
  code: string           // 唯一标识码
  name: string           // 权益名称
  description?: string   // 描述
  unitType: string       // 单位类型：byte | count
  consumptionMode: string // 计算模式：sum | max
  defaultValue: string   // 默认值（字符串形式的数字）
}
```

#### 更新权益类型
**接口：** `PUT /api/v1/admin/benefits/:id`

**请求体：** 同创建接口（code 不可修改）

#### 删除权益类型
**接口：** `DELETE /api/v1/admin/benefits/:id`

软删除，设置 deletedAt 字段

#### 切换权益状态
**接口：** `PUT /api/v1/admin/benefits/:id/status`

**请求体：**
```typescript
interface UpdateBenefitStatusRequest {
  status: number  // 1-启用，0-禁用
}
```

### 2. 会员级别权益配置 API

#### 获取会员级别权益配置
**接口：** `GET /api/v1/admin/membership-benefits`

**响应：**
```typescript
interface MembershipBenefitsResponse {
  levels: {
    id: number
    name: string
    benefits: {
      benefitId: number
      benefitCode: string
      benefitName: string
      benefitValue: string  // BigInt 转字符串
      unitType: string
      formattedValue: string  // 格式化后的值，如 "10 GB"
    }[]
  }[]
  availableBenefits: {
    id: number
    code: string
    name: string
    unitType: string
  }[]
}
```

#### 配置会员级别权益
**接口：** `PUT /api/v1/admin/membership-benefits/:levelId`

**请求体：**
```typescript
interface UpdateMembershipBenefitsRequest {
  benefits: {
    benefitId: number
    benefitValue: string  // BigInt 字符串
  }[]
}
```

### 3. 用户权益发放 API

#### 搜索用户
**接口：** `GET /api/v1/admin/users/search`

**查询参数：**
- `keyword`: 用户ID或手机号

**响应：**
```typescript
interface UserSearchResponse {
  users: {
    id: number
    phone: string
    nickname: string | null
    avatar: string | null
  }[]
}
```

#### 获取用户权益详情
**接口：** `GET /api/v1/admin/users/:userId/benefits`

**响应：**
```typescript
interface UserBenefitsAdminResponse {
  user: {
    id: number
    phone: string
    nickname: string | null
  }
  summary: UserBenefitSummary[]  // 权益汇总
  records: {
    id: number
    benefitId: number
    benefitName: string
    benefitCode: string
    benefitValue: string
    formattedValue: string
    sourceType: string
    sourceTypeName: string
    effectiveAt: string
    expiredAt: string
    status: number
    statusName: string
    remark: string | null
    createdAt: string
  }[]
}
```

#### 发放用户权益
**接口：** `POST /api/v1/admin/users/:userId/benefits`

**请求体：**
```typescript
interface GrantUserBenefitRequest {
  benefitId: number
  benefitValue: string    // BigInt 字符串
  effectiveAt: string     // ISO 日期字符串
  expiredAt: string       // ISO 日期字符串
  remark?: string
}
```

#### 禁用用户权益记录
**接口：** `PUT /api/v1/admin/users/:userId/benefits/:benefitRecordId/disable`

## 后台管理页面设计

### 1. 权益类型管理页面 `/admin/benefits`

**页面结构：**
```
┌─────────────────────────────────────────────────────────────────┐
│  权益类型管理                                    [+ 新增权益]    │
├─────────────────────────────────────────────────────────────────┤
│  [搜索框] [状态筛选]                                            │
├─────────────────────────────────────────────────────────────────┤
│  表格：                                                         │
│  | 名称 | 标识码 | 单位类型 | 计算模式 | 默认值 | 状态 | 操作 | │
│  |------|--------|----------|----------|--------|------|------| │
│  | 云盘 | storage| byte     | sum      | 1 GB   | 启用 | 编辑 | │
│  | 空间 | _space |          |          |        |      | 删除 | │
├─────────────────────────────────────────────────────────────────┤
│  分页组件                                                       │
└─────────────────────────────────────────────────────────────────┘
```

**新增/编辑对话框：**
- 权益名称（必填）
- 标识码（必填，仅新增时可编辑）
- 描述（可选）
- 单位类型（下拉选择：字节/次数）
- 计算模式（下拉选择：累加/取最大值）
- 默认值（数字输入，带单位转换提示）

### 2. 会员级别权益配置页面 `/admin/benefits/membership`

**页面结构：**
```
┌─────────────────────────────────────────────────────────────────┐
│  会员级别权益配置                                               │
├─────────────────────────────────────────────────────────────────┤
│  表格：                                                         │
│  | 会员级别 | 云盘空间 | 其他权益... | 操作     |               │
│  |----------|----------|-------------|----------|               │
│  | 普通会员 | 5 GB     | -           | [配置]   |               │
│  | 高级会员 | 20 GB    | -           | [配置]   |               │
│  | 专业会员 | 100 GB   | -           | [配置]   |               │
└─────────────────────────────────────────────────────────────────┘
```

**配置对话框：**
- 会员级别名称（只读）
- 权益配置列表（每个权益一行）
  - 权益名称
  - 权益值输入框
  - 单位提示（如 "GB"）
  - 转换后的值预览（如 "= 5368709120 字节"）

### 3. 用户权益发放页面 `/admin/benefits/grant`

**页面结构：**
```
┌─────────────────────────────────────────────────────────────────┐
│  用户权益发放                                                   │
├─────────────────────────────────────────────────────────────────┤
│  用户搜索：[输入用户ID或手机号] [搜索]                          │
├─────────────────────────────────────────────────────────────────┤
│  用户信息卡片（选中用户后显示）：                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 头像  用户名                                            │   │
│  │       手机号: 138****8888                               │   │
│  │       当前权益: 云盘空间 5GB / 已用 1.2GB               │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  发放权益表单：                                                 │
│  - 权益类型（下拉选择）                                         │
│  - 权益值（数字输入 + 单位选择）                                │
│  - 生效时间（日期选择器）                                       │
│  - 过期时间（日期选择器）                                       │
│  - 备注（文本输入）                                             │
│                                              [发放权益]         │
├─────────────────────────────────────────────────────────────────┤
│  用户权益记录：                                                 │
│  | 权益名称 | 权益值 | 来源 | 生效时间 | 过期时间 | 状态 | 操作│
│  |----------|--------|------|----------|----------|------|-----|
│  | 云盘空间 | 5 GB   | 会员 | 2024-01  | 2025-01  | 有效 | 禁用│
└─────────────────────────────────────────────────────────────────┘
```

## 类型定义扩展

### shared/types/benefit.ts 新增类型

```typescript
/** 权益来源类型名称映射 */
export const BenefitSourceTypeNames: Record<string, string> = {
  membership_gift: '会员赠送',
  benefit_package: '权益包购买',
  redemption_code: '兑换码兑换',
  admin_gift: '管理员赠送',
  system_default: '系统默认',
}

/** 权益状态名称映射 */
export const BenefitStatusNames: Record<number, string> = {
  1: '有效',
  0: '无效',
}

/** 单位类型名称映射 */
export const BenefitUnitTypeNames: Record<string, string> = {
  byte: '字节',
  count: '次数',
}

/** 计算模式名称映射 */
export const BenefitConsumptionModeNames: Record<string, string> = {
  sum: '累加',
  max: '取最大值',
}

/** 后台权益类型信息 */
export interface BenefitAdminInfo {
  id: number
  code: string
  name: string
  description: string | null
  unitType: string
  unitTypeName: string
  consumptionMode: string
  consumptionModeName: string
  defaultValue: string
  formattedDefaultValue: string
  status: number
  statusName: string
  createdAt: string
  updatedAt: string
}

/** 会员级别权益配置信息 */
export interface MembershipBenefitConfig {
  levelId: number
  levelName: string
  benefits: {
    benefitId: number
    benefitCode: string
    benefitName: string
    benefitValue: string
    formattedValue: string
    unitType: string
  }[]
}

/** 用户权益记录（管理员视图） */
export interface UserBenefitRecordAdmin {
  id: number
  benefitId: number
  benefitName: string
  benefitCode: string
  benefitValue: string
  formattedValue: string
  sourceType: string
  sourceTypeName: string
  effectiveAt: string
  expiredAt: string
  status: number
  statusName: string
  remark: string | null
  createdAt: string
}
```
