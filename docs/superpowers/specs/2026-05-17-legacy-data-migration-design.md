# LexSeek 历史数据迁移方案（LexSeekApi → LexSeek）

> 设计日期：2026-05-17
> 状态：待评审

## 1. 背景与目标

LexSeek 是旧项目 LexSeekApi 的全栈重构版（Express+gRPC → Nuxt 4）。重构期间数据库做了大幅调整，上线前需要把旧库（LexSeekApi 生产库）的用户业务数据迁移到新库（LexSeek）。

**目标**：把旧库的用户业务数据完整迁移到新库；配置数据以新库出厂 seed 为准；通过蓝绿切换上线，停写窗口 1-2 小时。

**非目标**：迁移旧库的配置数据、已下线功能的数据、法律法规库数据（见 §18）。

## 2. 关键决策记录

| 决策项 | 结论 |
|---|---|
| 迁移范围 | 全部用户业务数据；配置表以新库出厂 seed 为准，不从旧库覆盖 |
| 技术路线 | 独立的 TypeScript ETL 脚本（非纯 SQL、非 pg_dump） |
| 工具形态 | 根目录独立小项目 `legacy-migration/`，迁移完成后整体删除 |
| 主键 ID 策略 | 业务表保留旧库 ID；业务表→配置表的外键按名称重映射 |
| 历史 AI 产物 | 尽力完整迁移，结构对不上的做兜底标记，不丢用户数据 |
| 切换方式 | 蓝绿切换：新库+新版应用提前备好 → 切换时旧系统停写 1-2 小时 → 切域名 |
| 向量数据 | 迁移后重新生成，不搬运旧向量 |
| 法律法规库 | 不纳入迁移范围，新库自建 |
| `system_configs` | 迁移（结构两边一致） |
| `level_node_access` | 不迁移，新库后台重新配置 |
| `case_type` | 配置表，不迁移（新库已 seed `case_types`） |

## 3. 新旧库总体对比

- 旧库 LexSeekApi：40 张表（单文件 `schema.prisma`）
- 新库 LexSeek：约 75 张表（`prisma/models/` 模块化拆分）

变化分五类：

1. **改名表**：`materials_embeddings`→`case_material_embeddings`、`case_type`→`case_types`
2. **拆分/合并表**：`payment_orders`→`orders`+`payment_transactions`；`analysis_modules` 概念并入 `nodes`；旧 `payment_transactions` 与新 `payment_transactions` 同名但语义不同
3. **旧有、新删除表**：`resource_usage_log`、`case_type_analysis_module`、`case_session_messages`、`level_module_access`、`analysis_modules`
4. **全新表**：合同审查、文书起草、法律法规库、RBAC 权限、利率库、案件记忆、Agent 运行记录等约 40 张（无旧数据可迁）
5. **同名、字段有改动表**：约 30 张（最常见，逐字段对齐）

**关键前提**：新库通过 `prisma/seeds/seedData.sql` 出厂预置了配置数据（节点、模型、商品、会员级别、案件类型、权限、合同审查清单等）以及 4 个真实账号（ID 1-4）和 6 条角色绑定。因此配置表在新库已有权威数据，迁移只搬"用户产生的业务数据"。

## 4. 表迁移分类（旧库 40 张表）

### A 类 · 直接迁移（15 张）
单表 → 单表，逐字段对齐（含少量类型转换、字段增删、外键重映射）。

`users` `cases` `case_sessions` `user_memberships` `point_records` `point_consumption_records` `user_benefits` `redemption_codes` `redemption_records` `membership_upgrade_records` `oss_files` `asr_records` `asr_tasks` `doc_recognition_records` `image_recognition_records`

### B 类 · 结构转换迁移（4 张源表）
- `case_materials` → `case_materials` + `text_content_records`（内容字段外移、拆行）
- `case_analyses` → `case_analyses`（回填必填的 `nodeId`、`sessionId`）
- `payment_orders` + 旧 `payment_transactions` → 新 `orders` + 新 `payment_transactions`（拆分重组）

### system_configs · 单独迁移（1 张）
结构两边完全一致，一对一直拷。

### C 类 · 不迁移（12 张，新库 seed 为准）
`membership_levels` `benefits` `membership_benefits` `products` `point_consumption_items` `model_providers` `model_api_keys` `models` `nodes` `node_groups` `prompts` `case_type`

### D 类 · 旧库已删除（5 张，不迁移）
`resource_usage_log` `case_type_analysis_module` `case_session_messages` `level_module_access` `analysis_modules`（分析模块概念并入 `nodes`；`case_analyses` 回填 `nodeId` 直接用旧 `analysisType` 字符串匹配新 `nodes.name`）

### level_node_access · 不迁移（1 张）
新库后台重新配置（节点已重新 seed、ID 不对应；会员级别×节点规模小）。

### 向量表 · 迁移后重新生成（2 张，不搬旧数据）
`materials_embeddings`（→新库重建 `case_material_embeddings`）、`law_embeddings`（不纳入，见 §11）。

合计：15 + 4 + 1 + 12 + 5 + 1 + 2 = 40 ✓

## 5. 迁移工具：legacy-migration 小项目

根目录独立文件夹，自包含，迁移完成后整体删除。

```
legacy-migration/
├── README.md                      运行说明、回滚步骤
├── schema.legacy.prisma           旧库 schema 副本（generator output 改指向 ./legacy-client）
├── legacy-client/                 由 schema.legacy.prisma 生成的只读 Prisma client
├── src/
│   ├── index.ts                   编排入口（命令：preflight / migrate / verify）
│   ├── config.ts                  新旧库连接串（环境变量 LEGACY_DATABASE_URL / DATABASE_URL）
│   ├── progress.ts                断点续跑（_migration_progress 表读写）
│   ├── idRemap.ts                 配置外键重映射表构建（启动时按 name 配对）
│   ├── preflight.ts               上线前扫描（§16）
│   ├── verify.ts                  迁移后校验（§13）
│   ├── migrators/<表>.ts          每表迁移器：批量读旧 → 转换 → 批量写新
│   ├── transforms/<表>.ts         纯函数转换（旧行 → 新行）
│   └── reembed.ts                 材料向量批量重嵌入（若新项目无现成能力）
├── tests/transforms/<表>.test.ts  转换函数单元测试
├── vitest.config.ts               独立测试配置（纯函数，不依赖 DB 基建）
└── reports/                       迁移行数统计 / 异常清单 / 校验报告输出
```

- **旧库访问**：复制旧 `prisma/schema.prisma` 到 `schema.legacy.prisma`，generator output 改指向 `./legacy-client`，`prisma generate --schema=...` 生成只读 client。读取带类型。
- **新库访问**：复用仓库的 `generated/prisma` PrismaClient 类，构造一个指向新库的实例。
- **依赖**：无需新增 npm 包（仓库已有 `prisma` / `@prisma/client` / `tsx`）。
- 转换函数操作 Prisma 模型对象，纯列名 `@map` 改动对转换透明，只需处理字段的增/删/改名/类型变化/拆并表。

## 6. 核心机制

### 6.1 保留旧 ID + 序列重置
- 业务表插入时显式带旧 `id`。
- **前置条件**：迁移前新库所有业务表必须为空（只有 seed 配置数据）。
- 迁移完成后，对每张保留旧 ID 插入的表执行序列重置：
  `SELECT setval(pg_get_serial_sequence('<表>','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM <表>), 1))`
  否则新用户注册等会产生主键冲突。
- **过程中的衍生行**：若某目标表既有"保留旧 ID 的迁移行"又有"自增 ID 的衍生行"（`case_sessions` 的 legacy 会话、`payment_transactions` 的合成交易），必须在该表本体迁移完成后、衍生行插入前，先对其做一次序列重置，避免衍生行 ID 与旧 ID 冲突。

### 6.2 配置外键重映射
业务表对配置表的外键，旧 ID ≠ 新 seed ID，必须重映射。迁移器启动时读旧+新两边配置表，按自然键（name）配对，构建内存 `旧ID → 新ID` 映射表。详见 §10。

### 6.3 幂等 + 断点续跑
- 全量跑一次（停写窗口内）。脚本每张表分批（500–1000 行/批），每批一个事务。
- 进度表 `_migration_progress(table_name, last_id, status, updated_at)` 建在新库。
- `--resume`：崩溃后重跑，从进度表读 `last_id` 继续。
- 幂等：保留旧 ID 的表用 `createMany({ skipDuplicates: true })`，按主键冲突跳过；衍生表（`text_content_records` / `user_roles` / 合成的 `payment_transactions`）用各自的自然唯一键去重。

### 6.4 用户角色衍生
旧库用 `users.role`（VARCHAR）表达管理员；新库用 RBAC。迁移时：
- 旧 `users.role='admin'` → 衍生一条 `user_roles`，绑定到新库基础 admin 角色。
- 旧 `users.role='user'` → 不产生 `user_roles`。
- 关键账号（dx/Leslie 等需要 super_admin/多角色）→ 迁移末尾按手机号配置补绑（小型映射配置）。

## 7. 迁移顺序（阶段 0–6）

每张表必须在它依赖的所有业务表迁移完成后才迁移。配置表（新库已 seed）始终存在，不构成顺序约束。下表是基于新库 `@relation` 外键约束逐表提取的依赖清单——即迁移顺序的依据，**实施时不得打乱**。

| 阶段 | 表 | 依赖的业务表（须在本表之前迁移） | 指向的配置表（已 seed） |
|---|---|---|---|
| 0 | `system_configs` | 无 | 无 |
| 1 | `users` | 无 | 无 |
| 1 | `user_roles`（衍生） | `users` | `roles` |
| 2 | `oss_files` | 无（新库此表无任何外键） | 无 |
| 2 | `asr_tasks` | 无 | 无 |
| 2 | `asr_records` | `users`、`asr_tasks` | 无 |
| 2 | `doc_recognition_records` | `users` | 无 |
| 2 | `image_recognition_records` | `users` | 无 |
| 3 | `cases` | `users` | `case_types` |
| 3 | `case_sessions` | `cases`、`users` | 无 |
| 3 | `case_materials` | `cases` | 无（`document_drafts` 为空表，`draftId` 恒为 null） |
| 3 | `text_content_records` | 无（新库此表无外键；逻辑上随 `case_materials`） | 无 |
| 3 | `case_analyses` | `cases`、`case_sessions` | `nodes` |
| 4 | `user_memberships` | `users` | `membership_levels` |
| 4 | `orders` | `users` | `products` |
| 4 | `payment_transactions` | `orders` | 无 |
| 4 | `membership_upgrade_records` | `users`、`user_memberships`、`orders` | 无 |
| 4 | `point_records` | `users`、`user_memberships` | 无 |
| 4 | `point_consumption_records` | `users`、`point_records` | `point_consumption_items` |
| 4 | `user_benefits` | `users` | `benefits` |
| 5 | `redemption_codes` | 无 | `membership_levels` |
| 5 | `redemption_records` | `users`、`redemption_codes` | 无 |
| 6 | 收尾 | 全表序列重置 → 管理员角色补绑 → 数据校验 | — |

**说明**：
- 同阶段内按上表自上而下执行即满足依赖；跨阶段严格按阶段号递增。
- `payment_transactions` 阶段内顺序：旧表迁移（保留旧 ID）→ 序列重置 → 合成补充行（自增 ID），见 §6.1、§8.2 B-3。
- `case_analyses.sessionId` 外键指向 `case_sessions.sessionId`（非主键的唯一字段）；为 `sessionId` 为空的旧分析新建的 legacy 会话，在该分析行写入前先 insert（见 §8.2 B-2、§6.1 衍生行规则）。
- 业务表之间的外键因"保留旧 ID"零成本平移；指向配置表的外键经 §10 重映射。
- **顺序正确是必要条件，但不充分**——若某父行被跳过 / 失败，引用它的子行仍会 FK 报错，需配合 §12 的业务外键预校验。

## 8. 逐表转换规则

> 说明：列名 `@map` 差异对 Prisma 对象级转换透明，下表只列字段级语义改动。
>
> **时间戳兜底（跨表通用规则）**：旧库 11 张迁移表的 `createdAt`/`updatedAt` 为可空、新库对应字段为必填（`user_memberships`/`user_benefits`/`redemption_codes`/`redemption_records`/`orders`/`membership_upgrade_records`/`asr_records`/`asr_tasks`/`doc_recognition_records`/`image_recognition_records`/`case_analyses`）。迁移时 `createdAt` 为 NULL → 兜底为 `updatedAt`（仍 NULL 则迁移时刻）；`updatedAt` 为 NULL → 兜底为 `createdAt`。

### 8.1 A 类转换规则

| 表 | 转换规则 |
|---|---|
| `users` | 直拷大部分字段；丢弃 `role`（→衍生 `user_roles`）、`apiKey`；`contractExportSignature`=null |
| `cases` | 丢弃 `caseNumber`/`completedAt`/`closedAt`；`caseTypeId` 走配置重映射；新增字段 `summary`/`extractedInfo`/`courtName`/`firstInstanceCaseNo`/`secondInstanceCaseNo`/`firstInstanceJudge`/`secondInstanceJudge`=null、`isDemo`=false、`stance`='plaintiff' |
| `case_sessions` | 直拷 `id`/`sessionId`/`caseId`/时间戳；`scope`='case'、`userId`=反查 `cases.userId`、`status`=2、`type`=1、`title`/`metadata`=null |
| `user_memberships` | `levelId` 走配置重映射；`autoRenew` null→false；`sourceType` null→99；丢弃 `upgradedFromId`/`upgradedToId`/`upgradePrice`/`isUpgrade`；`settlementAt`/`remark`=null |
| `point_records` | 直拷全部；新增 `transferOut`=0、`transferToRecordId`=null |
| `point_consumption_records` | `itemId` 走配置重映射；新增 `batchId`=null；`status` 值直拷 |
| `user_benefits` | `benefitId` 走配置重映射；`benefitValue` Decimal→BigInt（四舍五入取整）；`sourceType` Int→String（枚举映射表，见 §9）；`effectiveAt` null→`createdAt`、`expiredAt` null→`2099-12-31`；丢弃 `consumedValue`/`remainingValue`/`unit` |
| `redemption_codes` | `levelId` 走配置重映射；`code` 长度 50→32（见 §16 扫描）；`type`：旧 `giftPoint`>0 → 3（会员+积分），否则 → 1（仅会员）；`pointAmount`：旧 `giftPoint`>0 → `giftPoint`，否则 null；`expiredAt`=null；丢弃 `createdBy` |
| `redemption_records` | 仅保留 `id`/`userId`/`codeId`/时间戳；丢弃 `redeemedAt`/`expiresAt`/`status`/`membershipId` |
| `membership_upgrade_records` | `paymentOrderId`→`orderId`（旧值保留可用）；`toMembershipId`/`orderId` 为 null 的行进异常清单跳过；`pointCompensation` 旧可空→新必填，null→0；丢弃 `fromLevelId`/`toLevelId`/`originalRemainingDays`/`status`；`transferPoints`=0、`details`=null |
| `oss_files` | 直拷全部；新增 `encrypted`=false、`originalMimeType`=null |
| `asr_records` | 直拷其余字段；新增 `tempFilePath`=null；`vectorIds` 重置为 `[]`、`lastEmbeddingAt` 重置为 null（见 §11） |
| `asr_tasks` | 直拷其余字段；新增 `isEncrypted`=false |
| `doc_recognition_records` | 直拷其余字段；`vectorIds`=`[]`、`lastEmbeddingAt`=null |
| `image_recognition_records` | 直拷其余字段；`vectorIds`=`[]`、`lastEmbeddingAt`=null；注意 `imageType` 字段 100→50 收窄 |

### 8.2 B 类转换规则

**B-1 · `case_materials` → `case_materials` + `text_content_records`**

`case_materials`（每条旧材料 → 一条新行）：
- 直拷 `id`/`caseId`/`name`/`type`/`ossFileId`/时间戳
- `isEncrypted`=false、`status`=3（已完成）、`draftId`=null
- 丢弃字段 `userId`/`content`/`asrRecordId`/`materialGroup`/`keywords`/`summary`/`vectorIds`/`lastEmbeddingAt`/`lastEditAt`
- `type` 值域 1→1/2→2/3→3/4→4；旧 `type=5`（视频）新库无对应，preflight 扫描，若存在需用户决定
- 文档/图片/音频类材料的解析内容**不外移**——已在 `doc_recognition_records`/`image_recognition_records`/`asr_records` 表里（靠 `ossFileId` 关联）

`text_content_records`（仅旧 `type=1` 文本材料额外衍生一行）：
- `userId`=旧 `case_materials.userId`、`caseId`、`materialId`=旧 `case_materials.id`
- `content`=旧 `content`、`htmlContent`=null、`summary`=旧 `summary`、`status`=2
- `vectorIds`=`[]`、`lastEmbeddingAt`=null（待重嵌入）
- `id` 自增；幂等按 `materialId` 判存在

**B-2 · `case_analyses` → `case_analyses`**

- 直拷 `id`/`caseId`/`analysisResult`/`version`/`summary`/时间戳
- `analysisType`：直拷字符串，同时作为 `nodeId` 回填的查找键
- `nodeId`（旧无→新必填）：旧 `analysisType` 在新库 `nodes` 按 `name` 匹配 → `nodeId`；匹配失败 → 占位 node + 异常清单
- `sessionId`（旧可空→新必填，且有 FK 到 `case_sessions.sessionId`）：旧非空直拷；旧为空 → 为该 `caseId` 创建/复用一条 legacy `case_sessions` 行，取其 `sessionId`（legacy 会话为自增 ID 衍生行，遵循 §6.1 衍生行序列重置规则）
- `isActive`：Int(0/1) → Boolean（`=== 1`）
- `status`：旧 0/1/2/3 → 新 1/1/2/3（旧 0 映射为新 1）
- `pointDeducted`=true（历史已扣积分，防新系统重扣）；`tokens`=旧 `usageToken`；`tokenCount`/`originalResult`=null
- 丢弃 `analysisProcess`/`generationType`/`userId`/`title`/`messageId`/`keywords`/`vectorIds`/`lastEmbeddingAt`/`startedAt`/`completedAt`

**B-3 · `payment_orders` + 旧 `payment_transactions` → 新 `orders` + 新 `payment_transactions`**

`orders`（源 `payment_orders`）：
- 直拷 `id`/`orderNo`/`userId`/`amount`/`duration`/`status`/时间戳
- `productId`（旧可空→新必填）：旧 `productId` 非空 → 走配置重映射；旧 `productId` 空但 `levelId` 非空 → 按会员级别找新库对应会员商品；都失败 → 占位商品 + 异常清单
- `paymentTime`→`paidAt`、`description`→`remark`
- `durationUnit` ← `paymentUnit`（1→`month`、2→`year`）
- `expiredAt`（旧无→新必填）= `createdAt`（历史订单视为已过期）
- `orderType`：该 order 出现在 `membership_upgrade_records.paymentOrderId` → `upgrade`，否则 `purchase`
- `adminRemark`/`adminRemarkUpdatedBy`/`adminRemarkUpdatedAt`=null
- 丢弃 `paymentType`/`paymentWay`/`prepayId`/`levelId`/`quantity`（`quantity` 信息丢失，标记）

`payment_transactions`（源 旧 `payment_transactions`）：
- 直拷 `id`/`orderId`/`amount`/时间戳
- `transactionNo`（旧无→新必填唯一）= `'LEGACY' + 左补零 id`（≤32 字符）
- `transactionId`→`outTradeNo`（注意 100→64 收窄）、`rawData`→`callbackData`、`successTime`→`paidAt`
- `paymentChannel` ← `paymentType`（1→`wechat`、2→`alipay`）
- `paymentMethod` ← `paymentWay`（1→`mini_program`、2→`wap`、3→`app`，对照表实施时按旧项目代码确认）
- `status`：旧 0/1/2 → 新 0/1/2
- `expiredAt`（旧无→新必填）= `createdAt`
- `prepayId`/`errorMessage`/`remark`/`adminRemark*`=null
- 丢弃 `tradeState`/`bankType`/`payerInfo`/`notifyTime`

合成 `payment_transactions`：
- 遍历已支付（`status=1`）但无对应旧 `payment_transactions` 的 `orders`，用 `payment_order` 自身的 `paymentType`/`paymentWay`/`prepayId`/`paymentTime` 合成一条
- 在旧 `payment_transactions` 迁移完并序列重置后插入，`id` 自增
- `transactionNo` = `'LEGACY-ORD' + orderId`；幂等按 `transactionNo` 唯一键去重

### 8.3 system_configs
全字段一对一直拷（`id`/`configGroup`/`key`/`value`/`description`/`status`/时间戳）。

## 9. 必填字段回填兜底汇总

| 新表.字段 | 兜底规则 |
|---|---|
| `case_sessions.status` / `.type` | 2（已完成）/ 1（普通对话） |
| `case_sessions.userId` | 反查 `cases.userId` |
| `case_analyses.nodeId` | `analysisType` 名称匹配；失配 → 占位 node |
| `case_analyses.sessionId` | 旧为空 → 新建 legacy 会话并取其 sessionId |
| `case_analyses.pointDeducted` | true |
| `user_memberships.sourceType` | null → 99（其他） |
| `user_benefits.effectiveAt` / `.expiredAt` | null → `createdAt` / `2099-12-31` |
| `orders.productId` | 按会员级别推导；失配 → 占位商品 |
| `orders.expiredAt` / `payment_transactions.expiredAt` | = `createdAt` |
| `orders.orderType` | 出现在升级记录中 → `upgrade`，否则 `purchase` |
| `payment_transactions.transactionNo` | `'LEGACY' + id` |
| `redemption_codes.type` / `.pointAmount` | 旧 `giftPoint`>0 → type=3、pointAmount=giftPoint；否则 type=1、pointAmount=null |
| `user_memberships.autoRenew` | null → false |
| `membership_upgrade_records.pointCompensation` | null → 0 |
| 多张表 `createdAt` / `updatedAt` | 旧可空、新必填，见 §8 时间戳兜底规则 |

**枚举映射表**（实施时查旧项目代码确认）：
- `user_benefits.sourceType`：旧 Int → 新 String（`membership_gift`/`benefit_package`/`redemption_code`/`admin_gift`）
- `payment_transactions.paymentMethod`：旧 `paymentWay` Int（1-JSAPI/2-H5/3-APP）→ 新 String（`mini_program`/`wap`/`app`）

## 10. 配置外键重映射明细

迁移器启动时读旧+新配置表，按 `name` 配对，构建 `旧ID → 新ID` 映射。

| 业务字段 | 指向配置表 | 匹配键 | 失配处理 |
|---|---|---|---|
| `cases.caseTypeId` | `case_types` | name | 占位（默认案件类型）+ 异常清单 |
| `user_memberships.levelId` | `membership_levels` | name | 异常清单（会员级别强业务相关，人工核对） |
| `redemption_codes.levelId` | `membership_levels` | name | 异常清单 |
| `orders.productId` | `products` | name（会员商品可辅以 levelId） | 占位商品 + 异常清单 |
| `case_analyses.nodeId` | `nodes` | name（旧 `analysisType`） | 占位 node + 异常清单 |
| `point_consumption_records.itemId` | `point_consumption_items` | name | 异常清单 |
| `user_benefits.benefitId` | `benefits` | name | 异常清单 |

业务表之间的外键（`cases.userId`、`case_analyses.caseId` 等）因保留旧 ID 零成本平移，无需映射。

兜底用的占位配置记录（占位 `nodes`、默认 `case_types`）若需要，在阶段 0 先创建好，确保兜底时外键有效。§16 的配置匹配预检若在演练阶段已清零失配项，迁移时则不会用到占位记录。

## 11. 向量数据与法律法规库

### 向量数据：迁移后重新生成
- 不搬运旧 `materials_embeddings` / `law_embeddings` 的向量数据。
- 原因：新库两张向量表新增 `tsv` 列（trigger 自动维护）；新表 `metadata` JSON 结构与旧表可能不同；新库 `models` 表新增 `dimensions` 字段，嵌入模型/维度可能已变，旧向量直接拷会导致检索劣化。
- 凡迁移后需重嵌入的表（`asr_records` / `doc_recognition_records` / `image_recognition_records` / `text_content_records`），其 `vectorIds` 重置为 `[]`、`lastEmbeddingAt` 重置为 null，让新库重嵌入流程识别为待处理。
- 核心数据迁移完成后，跑批量重嵌入：读取迁移后的材料文本，用新库 embedding 模型生成 `case_material_embeddings`。若新项目无现成批量重嵌入能力，在 `legacy-migration/` 内附一个重嵌入脚本。重嵌入完成前，历史材料暂不可语义检索。

### 法律法规库：不纳入
- 旧库只有 `law_embeddings`，没有 `legal_main` / `legal_articles` 结构化法规数据，`seedData.sql` 也不含法规数据。
- 法规结构化数据与 `law_embeddings` 由新项目自己的法规导入流程负责，本迁移方案不涉及。

## 12. 异常处理

原则：能迁的尽量迁进，坏行收集到异常清单，不因个别坏数据中止整个迁移。失败处理分三层。

### ① 行级错误（单行数据问题）
转换失败 / 外键目标缺失 / 唯一冲突 / 字段超长等。
→ 跳过该行，写入 `reports/` 异常清单（表名 / 旧行 ID / 原因），继续下一行。**不影响同批其他行、不影响整表、不影响整个迁移。**
- 配置外键失配 → 按 §10 兜底（占位记录）或跳过，记入异常清单。
- 不可迁移行（如失败/未完成的会员升级，关键外键为 null）→ 跳过 + 记入异常清单，由用户事后决定。

### ② 批级失败（`createMany` 整批被拒）
→ **不中止**，将该批**降级为逐行插入**：逐行试，定位坏行按①处理跳过，其余行正常入库——即把批级失败化解为行级跳过。一行坏数据绝不连累同批的好行。
- **业务外键预校验**：子表迁移器写入每行前，校验其业务外键（`userId` / `caseId` / `orderId` / `pointRecordId` / `asrTasksId` 等）目标 ID 在"已成功迁移的父表 ID 集合"中存在；父行因跳过/失败而缺失的子行 → 一并跳过并记入异常清单（级联跳过）。
- §7 正确顺序 + 本预校验，使 FK 类批级失败基本不会发生；逐行降级是兜底。

### ③ 致命错误（系统级问题）
数据库连接中断、磁盘满、配置错误等。
→ 中止整个迁移；靠进度表 + `--resume` 修复后从断点续跑，不必全量重来。

### 熔断
某张表失败率超过阈值（建议 5%，演练阶段校准）→ 主动中止并告警。高失败率通常意味着脚本 bug（schema 理解错 / 配置错）而非个别坏数据，应停下排查，而非跑完产出巨型异常清单。

### 收尾
结束打印每表汇总：读取 N / 成功 M / 跳过 K / 兜底 J；全程结构化日志。

## 13. 数据校验（迁移后）

`verify` 命令，输出校验报告：
1. **行数校验**：每表 新库行数 == 旧库行数 − 异常清单跳过数。
2. **外键完整性**：扫描新库无悬空外键（所有 `userId`/`caseId`/`nodeId`/… 能解析到目标行）。
3. **抽样内容校验**：每表随机抽样逐字段比对转换规则，重点抽 B 类表。
4. **业务聚合校验**：关键聚合值新旧一致——各用户案件数、订单总金额、积分余额等。

## 14. 执行流程（蓝绿切换 runbook）

**演练阶段（上线前，可反复）**
1. 用旧库生产备份恢复出一个测试库。
2. `legacy-migration` 跑 `preflight`（§16 扫描），处理扫描出的问题。
3. 跑 `migrate` + `verify`，实测耗时，校对异常清单，迭代脚本与转换规则。
4. 重复至迁移+校验干净、耗时可接受。

**正式切换（停写窗口 1-2 小时）**
1. **停写**：旧系统设为只读（或挂维护页），停止一切写入。
2. **旧库快照**：对旧库做备份快照（回滚兜底）。
3. **新库准备**：新库执行 `prisma migrate deploy` + 导入 `seedData.sql`（**剔除 `users` 和 `user_roles` 两表的 INSERT**）+ 跑 `seed.ts`。确认业务表为空。
4. **跑迁移**：`legacy-migration migrate` 按 §7 阶段顺序执行；崩溃可 `--resume`。
5. **序列重置 + 管理员角色补绑**。
6. **校验**：`verify`，检查行数 / 外键 / 抽样 / 业务聚合。
7. **重嵌入**：跑材料向量批量重嵌入（可与冒烟测试并行；重嵌入耗时长时可在切换后继续，期间历史材料不可语义检索）。
8. **冒烟测试**：新系统关键路径手测——登录、看案件、看订单、看会员、看材料。
9. **决策点**：校验+冒烟通过 → 切域名到新版、开放写入；不通过 → 回滚（§15）。
10. **观察期**：开服后监控错误率与关键指标。
11. **清理**：稳定后删 `legacy-migration/` 文件夹 + 删新库 `_migration_progress` 临时表。

## 15. 回滚预案

- 迁移全程旧库只读、不被写入，旧库本身不受影响。
- 回滚 = 放弃新库、域名切回旧版、旧系统恢复写入，零数据损失。
- 回滚窗口：切域名后、新系统产生大量新写入前。一旦新系统已接受大量写入，回滚将丢失这些新数据——故冒烟测试必须在开放写入前完成。
- 新库可重建（`migrate deploy` + `seed`）后重新迁移；迁移脚本幂等 + 断点续跑，局部失败可修复后续跑。

## 16. 风险点与上线前必做扫描

`preflight` 命令，演练阶段先跑：

1. **唯一约束冲突**：`users.username` / `users.email` 重复非空值；`oss_files` 的 `(userId,bucketName,filePath)` 重复组合（新库新增了这些唯一约束）。
2. **类型收窄**：`max(length(orderNo))` ≤32？`max(length(redemption_codes.code))` ≤32？`max(length(transactionId))` ≤64？`max(length(imageType))` ≤50？超长项报告。
3. **视频材料**：`case_materials` 是否存在 `type=5`。
4. **配置匹配预检**：旧 `case_type` / `membership_levels` / `products` / `analysis_modules` / `point_consumption_items` / `benefits` 的 `name` 是否都能在新库找到对应；列出失配项。
5. **必填外键空值**：`membership_upgrade_records` 中 `toMembershipId` / `paymentOrderId` 为 null 的行数。
6. **case_analyses 缺口**：`sessionId` 为空的行数；`analysisType` 在新 `nodes` 无匹配的种类清单。
7. **NULL 时间戳**：扫描各迁移表 `createdAt` / `updatedAt` 为 NULL 的行数（旧可空、新必填，需兜底）。
8. **重复激活版本**：旧 `case_analyses` 同一 `caseId`+`analysisType` 出现多条 `isActive=1` 的情况（新库每组应只有一条 active；不阻塞迁移，但需业务确认）。

扫描结果由用户在演练阶段逐项处理或确认。

## 17. 迁移后清理

迁移上线稳定后：
- 删除根目录 `legacy-migration/` 文件夹。
- 删除新库 `_migration_progress` 临时表。
- 移除迁移期间为读旧库配置的 `LEGACY_DATABASE_URL` 等临时环境变量。

## 18. 不在本方案范围

- 旧库配置表数据（C 类 12 张）——以新库出厂 seed 为准。
- 旧库已下线功能的数据（D 类 5 张）。
- 法律法规库（`legal_main` / `legal_articles` / `law_embeddings`）——新库自建。
- `level_node_access`（会员级别×节点权限）——新库后台重新配置。
- 新库全新表（合同审查、文书起草、利率库等约 40 张）——无旧数据，由新功能运行产生或新库 seed。
- LangGraph checkpoint / 旧 `case_session_messages` 会话消息——由新库 AI 框架接管，不迁移。
