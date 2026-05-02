# 数据模型

LexSeek 使用 Prisma ORM + PostgreSQL 管理数据，采用模块化 schema 拆分，共 28 个 `.prisma` 模型文件，覆盖用户、案件、会员、支付、权限、AI 模型、法律知识库、合同审查、文书起草、Agent skills 等核心业务域。

---

## 1. Prisma 模块化模型列表

所有模型文件位于 `prisma/models/` 目录，由 `prisma/schema.prisma` 统一引用。

| 文件 | 包含的表 | 业务域 |
|------|---------|--------|
| `user.prisma` | `users`, `tokenBlacklist` | 用户与认证 |
| `case.prisma` | `caseTypes`, `cases`, `caseSessions`, `caseMaterials`, `caseAnalyses`, `demoCases`, `caseMaterialEmbeddings` | 案件管理 |
| `materials.prisma` | `textContentRecords` | 材料内容 |
| `file.prisma` | `ossFiles` | 文件存储 |
| `membership.prisma` | `membershipLevels`, `userMemberships`, `benefits`, `membershipBenefits`, `userBenefits` | 会员与权益 |
| `order.prisma` | `orders`, `paymentTransactions`, `membershipUpgradeRecords` | 订单与支付 |
| `product.prisma` | `products` | 商品 |
| `point.prisma` | `pointRecords`, `pointConsumptionItems`, `pointConsumptionRecords` | 积分 |
| `rbac.prisma` | `roles`, `roleRouters`, `userRoles` | 角色权限 |
| `apiPermission.prisma` | `apiPermissionGroups`, `apiPermissions`, `roleApiPermissions`, `permissionAuditLogs` | API 权限 |
| `router.prisma` | `routers`, `routerGroups` | 路由管理 |
| `node.prisma` | `nodeGroups`, `nodes`, `prompts`, `levelNodeAccess` | 分析节点与提示词 |
| `model.prisma` | `modelProviders`, `modelApiKeys`, `models` | AI 模型管理 |
| `recognition.prisma` | `docRecognitionRecords`, `imageRecognitionRecords`, `asrTasks`, `asrRecords`, `mineruTokens`, `mineruTasks` | 文档/图片/语音识别 |
| `storage.prisma` | `storageConfigs` | 存储配置 |
| `campaign.prisma` | `campaigns` | 营销活动 |
| `redemption.prisma` | `redemptionCodes`, `redemptionRecords` | 兑换码 |
| `sms.prisma` | `smsRecords` | 短信验证码 |
| `system.prisma` | `systemConfigs` | 系统配置 |
| `legal.prisma` | `legalMain`, `legalArticles`, `lawEmbeddings` | 法律知识库 |
| `agentRun.prisma` | `agentRuns` | Agent 任务队列 |
| `contractReview.prisma` | `contractReviews` | 合同审查主表 |
| `contractPlaybook.prisma` | `contractPlaybooks` | 合同审查规则库（playbook 要点） |
| `contractReviewVersion.prisma` | `contractReviewVersions` | 合同审查版本快照（律师保存 / 客户回传） |
| `contractRiskAndAnnotation.prisma` | `contractRisks`, `contractAnnotations` | 合同审查风险点与批注 |
| `contractReviewLegacyBackup.prisma` | `contractReviewLegacyRisksBackup` | 合同审查历史风险数据备份（迁移期保留） |
| `document.prisma` | `documentTemplates`, `documentDrafts`, `documentDraftSnapshots`, `documentDraftVersions` | 文档起草（模板 + 草稿版本） |
| `skill.prisma` | `skills`, `node_skills` | Agent skills 注册表与节点关联 |

---

## 2. 核心表关系

### 2.1 用户 - 案件 - 材料 - 文件

```
users (1) ──────┬──> (N) cases ──────┬──> (N) caseMaterials ──> (0..1) ossFiles
                │                    ├──> (N) caseSessions ──> (N) caseAnalyses
                │                    └──> (N) caseAnalyses ──> (1) nodes
                │
                ├──> (N) docRecognitionRecords ──> ossFiles (via ossFileId)
                ├──> (N) imageRecognitionRecords ──> ossFiles (via ossFileId)
                ├──> (N) asrRecords ──> ossFiles (via ossFileId)
                └──> (N) mineruTasks ──> ossFiles (via ossFileId)
```

关键关系说明：
- `cases.userId` -> `users.id`：用户创建案件
- `cases.caseTypeId` -> `caseTypes.id`：案件类型分类
- `caseMaterials.caseId` -> `cases.id`：案件关联材料
- `caseMaterials.ossFileId` -> `ossFiles.id`（可选）：材料关联 OSS 文件
- `caseAnalyses.caseId` -> `cases.id`：分析结果关联案件
- `caseAnalyses.sessionId` -> `caseSessions.sessionId`：分析关联会话（LangGraph thread_id）
- `caseAnalyses.nodeId` -> `nodes.id`：分析结果关联节点

### 2.2 用户 - 会员 - 权益

```
users (1) ──> (N) userMemberships ──> (1) membershipLevels
                                           │
                                           ├──> (N) membershipBenefits ──> (1) benefits
                                           ├──> (N) levelNodeAccess ──> (1) nodes
                                           ├──> (N) products
                                           ├──> (N) redemptionCodes
                                           └──> (N) campaigns

users (1) ──> (N) userBenefits ──> (1) benefits
```

关键关系说明：
- `userMemberships` 记录用户的会员订阅，关联 `membershipLevels`
- `membershipBenefits` 是会员级别与权益的多对多中间表
- `userBenefits` 记录用户实际获得的权益（来源可以是会员赠送、兑换码、管理员赠送等）
- `levelNodeAccess` 控制不同会员级别可使用的分析节点
- `benefits.consumptionMode` 决定权益计算方式：`sum`（累加）或 `max`（取最大值）

### 2.3 订单 - 支付

```
users (1) ──> (N) orders ──> (1) products
                    │
                    ├──> (N) paymentTransactions
                    └──> (N) membershipUpgradeRecords
                                  ├──> fromMembership (userMemberships)
                                  └──> toMembership (userMemberships)
```

关键关系说明：
- `orders.orderType`：`purchase`（新购）、`upgrade`（升级）、`renew`（续费）
- `paymentTransactions.paymentChannel`：`wechat` / `alipay`
- `membershipUpgradeRecords` 记录会员升级明细，包含价格差额和积分补偿

### 2.4 积分体系

```
users (1) ──> (N) pointRecords ──> (0..1) userMemberships
                    │
                    └──> (N) pointConsumptionRecords ──> (1) pointConsumptionItems
```

关键关系说明：
- `pointRecords` 记录积分的获取（包含 remaining/used 字段实现先进先出扣减）
- `pointConsumptionRecords` 记录积分消耗明细，通过 `batchId` 关联同一次预扣操作
- `pointConsumptionRecords.status`：`0`-无效、`1`-预扣、`2`-已结算

### 2.5 RBAC 权限

```
users (N) <──> (N) roles      (via userRoles)
roles (N) <──> (N) routers    (via roleRouters)
roles (N) <──> (N) apiPermissions (via roleApiPermissions)
```

关键关系说明：
- 路由级权限：`roleRouters` 控制前端页面访问
- API 级权限：`roleApiPermissions` 控制后端接口访问
- `apiPermissions.isPublic`：公开接口无需登录即可访问
- `permissionAuditLogs` 记录所有权限变更操作

### 2.6 AI 模型与分析节点

```
modelProviders (1) ──> (N) models ──> (N) nodes
modelProviders (1) ──> (N) modelApiKeys

nodes (1) ──> (N) prompts
nodes (1) ──> (N) levelNodeAccess
nodes (1) ──> (N) caseAnalyses

nodes (N) <──> (N) skills      (via node_skills, priority 排序)

nodeGroups (1) ──> (N) nodes
```

关键关系说明：
- `models.sdkType` 标识 LangChain 适配器类型：`openai`、`deepseek`、`gemini`、`anthropic`
- `nodes.type` 区分节点功能：`analysis`（分析模块）、`document`（文书模块）、`extraction`（数据提取）、`agent`（主代理）
- `prompts` 支持版本管理，`status=1` 表示当前生效版本
- `node_skills.priority` 决定 skill 在 system prompt 中出现的顺序（数字越小越靠前）；`nodes.useSkillsAsLogic` 控制是否把 skills 注入为可调用工具

### 2.7 法律知识库

```
legalMain (1) ──> (N) legalArticles

lawEmbeddings (独立向量表)
caseMaterialEmbeddings (独立向量表)
```

关键关系说明：
- `legalMain` 存储法律法规基本信息，`legalArticles` 存储条文内容（支持 5 级标题层级）
- `lawEmbeddings` 和 `caseMaterialEmbeddings` 使用 pgvector 扩展存储向量数据
- 向量字段类型为 `Unsupported("vector")`，Prisma 不直接管理，通过原生 SQL 操作

### 2.8 合同审查

```
users (1) ──> (N) contractReviews
```

关键关系说明：
- `contractReviews.userId` -> `users.id`：用户发起合同审查
- `sessionId` 字段加 UNIQUE 约束（`idx_contract_reviews_session`），对应"合同审查会话 1:1 映射"——一次合同审查对应一个 LangGraph `thread_id`，重审即新建 review、新建 sessionId
- MVP 阶段不含 `caseId` 列，M6+ 通过 `ALTER TABLE` 补齐案件页复用能力
- `status` 状态机：`pending` → `reviewing` → `awaiting_stance` → `reviewing` → `completed` | `failed`

---

## 3. 枚举映射

数据库使用整数枚举，在 `shared/types/` 中定义对应的 TypeScript 枚举和文本映射。

### 3.1 用户状态 (`shared/types/user.ts`)

| 数据库值 | 枚举 | 含义 |
|---------|------|------|
| 0 | `UserStatus.DISABLED` | 禁用 |
| 1 | `UserStatus.ENABLED` | 启用 |

### 3.2 案件状态 (`shared/types/case.ts`)

| 数据库值 | 枚举 | 含义 |
|---------|------|------|
| 1 | `CaseStatus.IN_PROGRESS` | 进行中 |
| 2 | `CaseStatus.COMPLETED` | 已完成 |
| 3 | `CaseStatus.CLOSED` | 已关闭 |

### 3.3 材料类型 (`shared/types/material.ts`)

| 数据库值 | 含义 |
|---------|------|
| 1 | 文本 |
| 2 | 文档 |
| 3 | 图片 |
| 4 | 音频 |

### 3.4 材料/识别状态

| 数据库值 | 含义 |
|---------|------|
| 0 | 待处理 |
| 1 | 处理中 |
| 2 | 成功/已完成 |
| 3 | 失败 |

### 3.5 订单状态

| 数据库值 | 含义 |
|---------|------|
| 0 | 待支付 |
| 1 | 已支付 |
| 2 | 已取消 |
| 3 | 已退款 |

### 3.6 支付事务状态

| 数据库值 | 含义 |
|---------|------|
| 0 | 待支付 |
| 1 | 支付成功 |
| 2 | 支付失败 |
| 3 | 已过期 |
| 4 | 已退款 |

### 3.7 会员来源类型 (`userMemberships.sourceType`)

| 数据库值 | 含义 |
|---------|------|
| 1 | 兑换码 |
| 2 | 直接购买 |
| 3 | 管理员赠送 |
| 4 | 活动奖励 |
| 5 | 试用 |
| 6 | 注册赠送 |
| 7 | 邀请注册赠送 |
| 8 | 会员升级 |

### 3.8 Agent 运行状态 (`agentRuns.status`)

使用字符串枚举：`pending` / `running` / `completed` / `failed` / `cancelled`

### 3.9 枚举文本映射模式

```typescript
// shared/types/ 中的标准模式
export enum CaseStatus {
  IN_PROGRESS = 1,
  COMPLETED = 2,
  CLOSED = 3,
}

export const CaseStatusText: Record<CaseStatus, string> = {
  [CaseStatus.IN_PROGRESS]: '进行中',
  [CaseStatus.COMPLETED]: '已完成',
  [CaseStatus.CLOSED]: '已关闭',
}
```

---

## 4. Decimal 字段处理

Prisma 返回的 `Decimal` 类型是 `Decimal.js` 对象（包含 `s`/`e`/`d` 三个内部属性），不能直接用于 JSON 序列化或数值运算。

### 涉及 Decimal 字段的表

| 表 | 字段 | 精度 |
|---|------|------|
| `ossFiles` | `fileSize` | `Decimal(15, 2)` |
| `orders` | `amount` | `Decimal(10, 2)` |
| `paymentTransactions` | `amount` | `Decimal(10, 2)` |
| `membershipUpgradeRecords` | `upgradePrice` | `Decimal(10, 2)` |
| `products` | `priceMonthly`, `priceYearly`, `unitPrice`, `originalPriceMonthly`, `originalPriceYearly`, `originalUnitPrice` | `Decimal(10, 2)` |
| `pointConsumptionItems` | `discount` | `Decimal(3, 2)` |
| `models` | `inputCostPerMillionTokens`, `outputCostPerMillionTokens` | `Decimal(12, 4)` |

### 转换工具

文件路径：`shared/utils/decimalToNumber.ts`

```typescript
import { Prisma } from "#shared/types/prisma"

export function decimalToNumberUtils(decimal: Prisma.Decimal | null | undefined): number
```

处理逻辑优先级：
1. `null` / `undefined` -> 返回 `0`
2. 有 `toNumber()` 方法 -> 直接调用
3. 已是 `number` 类型 -> 直接返回
4. 是字符串 -> `parseFloat()`
5. 是 Decimal 内部结构 `{s, e, d}` -> 手动计算（处理序列化后丢失方法的情况）
6. 兜底 -> `Number()` 转换

---

## 5. 时区约定

### 规则

- **数据库时区**：UTC（通过连接参数 `options: '-c TimeZone=UTC'` 设置 PG 会话时区）
- **应用时区**：`Asia/Shanghai`（在业务层使用 dayjs 转换）
- **连接串**：不在 `DATABASE_URL` 中附加 `TimeZone` 参数，而是通过 Prisma adapter 的 PG 连接选项设置

### 为什么使用 UTC

Prisma 在发送 `timestamptz` 值时使用 ISO 8601 格式（带时区偏移）。如果 PG 会话时区为 `Asia/Shanghai`，PG 会对已经带时区的值再做一次偏移，导致"双偏移 bug"。设置会话时区为 UTC 可避免此问题。

### 实现位置

```typescript
// server/utils/db.ts
const adapter = new PrismaPg({
    connectionString,
    options: '-c TimeZone=UTC',
})
```

同样的配置也出现在 `vitest.config.ts` 中的测试 Prisma 客户端。

### 所有时间字段的数据库类型

所有 `createdAt`、`updatedAt`、`deletedAt` 以及业务时间字段统一使用 `@db.Timestamptz()` 或 `@db.Timestamptz(6)`（微秒精度），存储的是 UTC 时间戳。

---

## 6. 软删除约定

所有业务表均包含 `deletedAt` 字段（`DateTime?`），使用软删除模式。`deletedAt` 为 `NULL` 表示记录未删除。查询时需显式添加 `deletedAt: null` 过滤条件。

所有表均对 `deletedAt` 建立了索引（`idx_表名_deleted_at`），确保软删除过滤的查询性能。

---

## 7. 主键策略

| 策略 | 使用场景 |
|------|---------|
| `Int @id @default(autoincrement())` | 大部分业务表（users, cases, orders 等） |
| `String @id @default(uuid(7))` | smsRecords, tokenBlacklist（UUID v7，时间有序） |
| `String @id @default(uuid())` | agentRuns（标准 UUID v4） |
| `String @id @default(dbgenerated("gen_random_uuid()"))` | 向量表（lawEmbeddings, caseMaterialEmbeddings，由 PG 生成） |
| `String @id` | legalMain, legalArticles（UUID v7，无 autoincrement 需求） |

---

## 8. JSON 字段使用

以下表使用了 `Json` 类型字段存储灵活数据：

| 表 | 字段 | 内容 | 类型 |
|---|------|------|------|
| `cases` | `plaintiff`, `defendant` | 当事人信息 | `Json?` |
| `cases` | `extractedInfo` | 全量提取结果 | `@db.JsonB` |
| `caseSessions` | `metadata` | 会话元数据 | `@db.JsonB` |
| `nodes` | `tools` | 工具列表 | `Json @default("[]")` |
| `nodes` | `outputSchema` | 结构化输出 schema | `@db.JsonB` |
| `prompts` | `variables` | 变量列表 | `Json @default("[]")` |
| `demoCases` | `materials` | 预设材料 | `Json @default("[]")` |
| `systemConfigs` | `value` | 配置值 | `Json` |
| `storageConfigs` | `config` | 加密存储的配置 | `Json` |
| `agentRuns` | `input`, `metadata` | 输入参数、系统元数据 | `Json` |
| `paymentTransactions` | `callbackData` | 支付回调原始数据 | `Json?` |
| `membershipUpgradeRecords` | `details` | 升级详情 | `Json?` |
