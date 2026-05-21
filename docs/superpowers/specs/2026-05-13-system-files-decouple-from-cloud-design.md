# 系统级文件与用户云盘解耦设计

> 日期：2026-05-13
> 类型：架构调整 + 数据模型变更
> 优先级：P1（生产环境数据语义错误，需修复）
> 修订记录：2026-05-14 经 5 维度审查后，删除 uploaderUserId 字段、把"归属判定"上移到接口层、DAO 改可选参数模式、补充项目内现有先例引用

## 一、业务目标

管理员在后台上传的"全局文书模板"是**面向全体用户的系统资源**，不应该：

1. 占用上传它的管理员账号的云盘配额
2. 出现在管理员账号的"我的云盘"列表里

当前实现把全局模板的源文件错误地挂在了上传它的管理员账号下，导致上述两点都被违反。本设计目标是**从数据层把"系统资源"与"用户私有云盘"彻底剖开**，并建立一套通用规则，使未来新增的系统级文件入口可自动遵守。

## 二、现状问题

### 入口梳理

经穷尽搜索（grep `ossFiles` / `createOssFileDao` 在 `server/api/v1/admin/**`），LexSeek 当前**只有一个**真正直接写入用户文件库的管理端文件上传入口：

- `POST /api/v1/admin/document-templates`（含 PATCH 更新替换文件）
  - 通过 `createDocumentTemplateService` 走 `createOssFileDao` 落库
  - 写入 `ossFiles` 时 `source = FileSource.DOCUMENT_TEMPLATE`，`userId = 管理员账号 ID`

其他系统级资源入口均不直接产生用户云盘文件：

| 入口 | 行为 |
|---|---|
| 示范案例（demo-cases） | 不直接上传文件，引用素材库素材；使用时克隆给真实用户，归属合理 |
| 合同审查清单 / 法律条文 / 法规附件等 | 全部是结构化数据，无文件上传 |

因此本次代码改动**实际只触达"全局文书模板"一个入口**，但同时建立"系统级文件归属"的通用规则，后续如再增系统级上传入口可直接套用。

### 数据语义错误的根因

`ossFiles.userId` 当前承担了"文件归属人"和"上传操作人"两个相互冲突的语义：

- 用户云盘列表（`/api/v1/files/oss/file-list`）和配额计算（`ossUsageDao`）按 `userId` 过滤，意图是查"当前用户的云盘"
- 全局模板的 `userId` 被填成了上传它的管理员，导致这些"系统资源"被错误地划入该管理员的私有云盘

### 关键代码位置

- `server/agents/document/documentTemplate.service.ts`（第 75-149 行：`createDocumentTemplateService`）
- `server/agents/document/documentTemplate.dao.ts`（第 101-138 行：`listDocumentTemplatesDAO`）
- `server/services/files/ossFiles.dao.ts`（第 166-203 行：`ossUsageDao`；第 308-365 行：`findOssFilesByUserIdDao`）
- `prisma/models/file.prisma`：`ossFiles.userId INT NOT NULL`
- `shared/types/file.ts`：`FileSource` 枚举（已有 `DOCUMENT_TEMPLATE` 值）

## 三、设计原则

1. **从数据层剖开归属，不在查询层维护排除黑名单**——避免每个查询点同步维护"排除哪些 source"
2. **归属判定上移到接口层**——`createDocumentTemplateService` 不再感知"管理端 / 用户端"，由调用方显式决定 `ownerUserId` 的值。这与 CLAUDE.md 铁律 5（管理端 / 用户端 API 物理隔离）一致：API 物理分两套，service / DAO 通过参数语义化复用
3. **历史数据通过一次性维护脚本迁移，不入 seedData.sql**——`seedData.sql` 是新环境的原始种子文件，仅包含基础配置数据（如 api_permissions / 节点 / 提示词等），从不承担存量业务数据修复职责；`ossFiles` 是运行时业务数据，不属于 seed 范畴。运行时业务数据的存量修复一律通过 `server/scripts/` 下的一次性脚本完成（与 `rebuildLawEmbeddings.ts` 同模式）
4. **仅"全局文书模板"剥离归属；用户自创的"个人文书模板"维持现状**——个人模板是用户主动上传内容，占用自己存储是合理的（已与产品方确认）

## 四、数据模型变更

### `ossFiles` 表字段调整

| 字段 | 现状 | 调整后 | 说明 |
|---|---|---|---|
| `userId` | `INT NOT NULL`，外键 → `users.id` | `INT NULLABLE`，外键 → `users.id` | 语义改为"归属人"。`NULL = 系统所有，不属于任何个人云盘` |

**仅一处字段变更**（约束放松），无新增字段。

> 经审查放弃新增 `uploaderUserId` 字段：项目已有独立 audit log 体系（`permission_audit_logs` / `agent_tool_audit_logs` 等）专门承担操作员追溯职责，业务表内嵌审计字段会重复、不必要；超出原始需求范围。
>
> 若未来明确出现"必须从模板快速反查上传者"的需求，再单独评估是补独立审计表还是补字段。

### Prisma migrate 行为说明

执行 `bun run prisma:migrate --name decouple_system_files_from_user_drive` 后自动生成的迁移仅包含一条 SQL：

```sql
ALTER TABLE "ossFiles" ALTER COLUMN "userId" DROP NOT NULL;
```

**安全性**（已查 Prisma 7.7.0 与 PostgreSQL 14+ 官方文档）：
- 该操作仅修改约束元数据，**不触发表 rewrite，零锁表时间**，即便 `ossFiles` 表达到 GB 级体量也是即时返回
- 项目内已有类似先例：`prisma/migrations/20260507102823_add_node_prompts_logical_columns` 中有 `DROP NOT NULL` 改动，无性能问题上报
- 参考：https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations

### `documentTemplates` 表

无字段变化（仍有 `scope` / `userId` / `ossFileId` 字段）。`scope='global'` 时 `documentTemplates.userId` 已经是 NULL（现状），本设计不改动该表。

## 五、接口与服务层改造

### 底层 DAO：`createOssFileDao` —— 可选参数模式（不破坏现有调用点）

现签名接收 `Prisma.ossFilesCreateInput`，包含 `userId: number`。

调整策略：**保持参数形状不变，仅把 `userId` 的类型放宽为 `number | null`**——这样既能传 NULL 表达系统所有，也不需要重命名字段、不破坏其余 6 个调用点（普通文件上传、合同导出、解析回写等场景），它们继续传当前用户 ID 即可。

```ts
// 调整后（仅类型变化，不改字段名）
createOssFileDao({
  userId: number | null,   // null = 系统所有，不属于任何个人云盘
  source: FileSource,
  ...
})
```

> 这种"复用现有字段、放宽类型"的做法借鉴自项目内 nullable 字段的常见模式（如 `case.tokens Int?`、`campaign.duration Int?`、`legal.order Int?`）。

### 文书模板服务：`createDocumentTemplateService`

**关键改造**：service 不再接收 `isAdmin` 也不再判断 `scope`，改为接收语义化的 `ownerUserId: number | null` 参数：

```ts
// 调整后
async function createDocumentTemplateService(params: {
  ownerUserId: number | null   // 由调用方决定：管理端传 null，用户端传当前用户 ID
  scope: 'global' | 'user'
  // ...
}) {
  await createOssFileDao({
    userId: params.ownerUserId,
    source: FileSource.DOCUMENT_TEMPLATE,
    // ...
  })
  // ...
}
```

**归属判定全部上移到接口层**——这是 CLAUDE.md 铁律 5（管理端 / 用户端 API 物理隔离）的延伸应用：API 物理已经分两套接口、不在一个 service 内 `isAdmin` 分支判断；service 与 DAO 是无身份感知的通用层。

```ts
// server/api/v1/admin/document-templates/index.post.ts（管理端）
await createDocumentTemplateService({
  ownerUserId: null,          // 显式表态：系统所有
  scope: 'global',
  // ...
})

// server/api/v1/assistant/document/templates.post.ts（用户端，若已存在）
await createDocumentTemplateService({
  ownerUserId: currentUserId, // 显式表态：用户所有
  scope: 'user',
  // ...
})
```

### 用户云盘相关查询

**完全不需要改动 WHERE 条件**——它们已经写 `WHERE userId = me`，而全局模板的 `userId` 已经是 NULL，天然被排除：

- `findOssFilesByUserIdDao`（`/api/v1/files/oss/file-list` 后端）
- `ossUsageDao`（配额计算）

### 排查 `ossFiles.userId` 非空依赖

由于 `userId` 从 NOT NULL 变成 nullable，TypeScript 类型在 Prisma 生成后会变为 `number | null`。**所有现有代码中假定 `userId` 非空的位置都会立即变成编译错误**，借此反查所有受影响点并逐一处理。

预计影响面（基于代码 grep）：`createOssFileDao` 共 7 个调用点，其中 6 个传具体用户 ID（不需变更逻辑，传 `number` 仍合法），仅 `documentTemplate.service.ts` 一处需要适配新参数；其余 TS 代码中读取 `ossFile.userId` 的位置由编译器逐一暴露。

实施阶段需把这些编译错误全部消化掉，不允许通过 `!` 非空断言糊弄过去。

### 非 TS 路径风险确认

排查结果：`server/services/files/ossFiles.dao.ts` 中存在 `findOrphanOssFilesDAO` 使用 `$queryRaw`，但该查询不依赖 `userId`，本次改动**零风险**。其余裸 SQL / JSON 字段查询无 `userId` 依赖。

## 六、前端影响

| 页面 / 接口 | 用户视角变化 |
|---|---|
| 用户工作台 → 我的云盘 | 普通用户原本就看不到全局模板，**无感知** |
| 管理员账号去自己的"我的云盘" | 之前会看到全局模板污染列表，**改造后干净** |
| 管理后台 → 文书模板管理页 | 按 `documentTemplates` 表查，**不受影响** |
| 用户端 → 选用文书模板（`/api/v1/assistant/document/templates`） | 按 `documentTemplates` 表 + `scope` 过滤，**不受影响** |
| 配额提示（"已用 X / 总量 Y"） | 管理员账号配额扣减恢复准确 |

**前端代码零改动**。需要做的是回归测试：管理员账号上传 / 替换 / 删除全局模板后，自己的云盘列表与配额不再感知。

## 七、历史数据迁移

### 为什么走脚本而不走 seedData.sql

`prisma/seeds/seedData.sql` 是新环境的原始种子文件，按项目规则只允许 `INSERT INTO`，仅承载基础配置数据（如 `api_permissions`、节点、提示词等）。**它从不包含 `ossFiles` 的 INSERT 语句**（已实测核实），因为 `ossFiles` 是用户在运行时产生的业务数据，不属于 seed 范畴。

存量业务数据的一次性修复必须走 `server/scripts/` 下的维护脚本（与 `rebuildLawEmbeddings.ts` / `setupRetrievalInfra.ts` 同模式）——这是项目惯例。

### 迁移内容

数据库已有的全局模板对应 `ossFile` 记录需要把归属剥离：

- 范围筛选：`ossFile.source = 'documentTemplate' AND 关联的 documentTemplates.scope = 'global' AND ossFile.userId IS NOT NULL`
  - 不限定模板 / 文件是否软删除：软删除的记录虽然不影响显示和配额，但顺手搬掉保持数据一致
  - `ossFile.userId IS NOT NULL` 同时承担"幂等保护"：已迁移过的记录 `userId` 已为 NULL，再次执行不会被命中
- 数据搬移：将 `ossFile.userId` 直接置为 NULL（不再保留旧值，因为本次决定不引入审计字段）

### 实施方式

新增一次性维护脚本 `server/scripts/migrateGlobalTemplateOwnership.ts`，与项目现有 `rebuildLawEmbeddings.ts` / `setupRetrievalInfra.ts` 同套路：

- 通过 Prisma 客户端执行，不写裸 SQL
- 幂等性由 WHERE 条件保证（`userId IS NOT NULL`）
- 输出报告：搬移条数、影响管理员账号清单（仅日志输出，不落库；用于人工核对）、跳过条数

部署节奏：代码合并 → 上线 → 人工执行一次脚本（与项目其他维护脚本同模式）。该脚本不入 `prisma/migrations/`，不污染 schema 迁移历史。

## 八、测试策略

### 单元 / 集成测试（关键 4 项）

1. **创建路径**
   - 管理端上传全局模板（调用方传 `ownerUserId: null`）→ `ossFile.userId === null`
   - 用户端上传个人模板（调用方传 `ownerUserId: currentUserId`）→ `ossFile.userId === 用户 ID`
2. **云盘列表**
   - 管理员账号自己的云盘列表：不再出现自己上传过的全局模板文件
3. **配额计算**
   - `ossUsageDao(adminUserId)` 返回值不再包含全局模板文件字节数
4. **历史迁移脚本**
   - 准备种子：含已存在的全局模板 ossFile（`userId = 管理员`）+ 一条用户私有文件（`userId = 普通用户`）
   - 执行脚本后：全局模板 `userId === null`、私有文件 `userId === 普通用户`（不被误伤）
   - 重复执行：无变化

### 回归（与单测互补）

- 文书模板管理后台 CRUD 流程跑通
- 用户端"选择文书模板"下拉显示正常

> 已删除"删除路径 / 软删除回归"等非关键单测——删除走现有 `ossFileDao.softDelete`，本次不改逻辑、零新风险。

## 九、上线节奏

1. PR 评审通过、CI 通过
2. 合并至 `main` → 触发自动部署（`prisma migrate deploy` 执行 schema 变更，零锁表）
3. 人工在生产服务器执行 `npx tsx server/scripts/migrateGlobalTemplateOwnership.ts`
4. 观察 5-10 分钟：管理员账号云盘 / 配额表现正常

> 上线时段建议非业务高峰执行；DROP NOT NULL 本身即时返回，但避开高峰可降低任何意外阻塞的影响半径。

## 十、风险与边界

| 风险 | 缓解 |
|---|---|
| `ossFiles.userId` 改为 nullable 后，未发现的查询点假定非空 → 运行时 `Cannot read properties of null` | TypeScript 编译错误反查 + 单元测试覆盖；如有遗漏，错误会在测试 / 预发环境暴露而非生产 |
| 历史迁移脚本漏跑 | 脚本幂等 + 部署清单纳入；管理员云盘配额异常可作为人工观察信号 |
| 未来新增系统级文件入口忘记将 `userId` 设为 NULL | DAO 调用点必传 `userId`，类型 `number | null` 强制开发者显式表态；建议同步在 `.claude/rules/api.md` 中加入一条短备注："系统级文件入口落库时 `ossFiles.userId` 必须为 NULL" |

## 十一、不在本次范围内

- 合同审查模板 / playbook、示范案例素材等**未来可能扩展**的系统级文件入口（当前不存在文件上传，不需要立即处理）
- 用户云盘的整体配额政策调整（仅修复数据语义，不动配额规则）
- 管理后台"系统资源管理"页面（不新增管理界面，模板继续走现有 `/admin/document-templates`）
- 文件上传操作员审计追溯能力（若日后明确需求，单独评估补独立 audit 表的方案）
