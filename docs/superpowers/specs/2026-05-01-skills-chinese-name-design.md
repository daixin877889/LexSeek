# Skills 中文名管理设计

## 背景

`.deepagents/skills/<name>/SKILL.md` 扫描入库的 skill 当前只有英文标识（`name`，如 `evidence-defense` / `anjian-dashiji`），用户在以下三处看到的也是英文：

- 后台 Skills 管理页（`/admin/skills`）
- 后台节点配置 → Skill 选择器（`AdminNodesNodeSkillSelector`）
- 用户对话工具卡片（`RunSkillScriptTool` / `ReadSkillFileTool` / `WriteSkillFileTool`）

需求：

1. 每个 skill 能有一个**中文展示名**
2. 管理员可在后台**自定义**中文名（覆盖代码预设）
3. 后台与用户对话**两侧**都按中文名显示

## 既有现状（别重做）

- `prisma/models/skill.prisma` 已有 `title String?` 字段——本设计不复用，原因见 §3。
- `skillSync.service.ts` 启动时扫描入库；`buildUpsertSkillOp` 的 update 段会**覆盖** title 与 status，导致：
  - title 实际等于 `fm.name`（即英文名）
  - **启用开关 bug**：管理员手动停用某 skill → 下次扫描（或服务重启自动扫描）把 status 重置为 ENABLED → 停用立刻失效。本期顺手修。
- 后台 `SkillList.vue` 已显示 `title` 列但只读、没有编辑入口。
- 后台 API 已存在：`GET /admin/skills`、`POST /admin/skills/resync`、`PATCH /admin/skills/status/:name`；**没有**通用编辑接口。
- 节点 Skill 选择器现状：英文 `name` 大字 mono + `title` 小字（小字其实也是英文，因为 title 被同步覆盖了）。
- 工具卡片现状：从工具调用 input 直接拿英文 `skillName` 显示。

## 三项决策（已和用户对齐）

1. **范围**：后台 + 用户端两侧都显示中文名。
2. **真理源**：代码 `SKILL.md` 写默认值 + 后台编辑覆盖；后台改过的不会被扫描覆盖。
3. **本次只做中文名**，不开放 description 等其他字段的后台编辑。

## 数据模型改动

`prisma/models/skill.prisma` 新增**独立的覆盖列**，不复用现有 `title` 字段：

| 字段 | 来源 | 写入时机 |
|---|---|---|
| `title String?` | SKILL.md frontmatter.title（缺失则兜底英文 name） | 启动扫描 / `resync` 时由 service 写 |
| `customTitle String?`（**新增**） | 管理员在后台编辑 | 仅后台 PATCH 接口写；扫描永不写入 |

**为什么不复用 `title` 字段**：独立列保留代码默认层、覆盖层各自独立——DBA / SRE 直接读库可一眼看出 frontmatter 默认值与后台覆盖值的差异，运维可读性更好；且未来若新增"恢复默认"按钮，无需重新解析 SKILL.md 即可读出代码默认值。复用 `title` 字段需额外的"是否被覆盖"标志位或隐式约定，运维诊断成本更高。

**实际显示** = `customTitle ?? title ?? name`。

清空 `customTitle`（前端 input 留空）→ 数据库 set NULL → 显示退回到 `title`（代码默认）。

## SKILL.md frontmatter 扩展

加一个可选字段 `title`：

```yaml
---
name: evidence-defense
title: 证据辩护策略           # 新增，可选
description: |
  ...
---
```

`shared/types/skill.ts` 的 `SkillFrontmatter` 接口加 `title?: string`；`parseSkillFrontmatterFromMarkdown` 解析时**必须做 string 类型守卫**，与现有 `description` / `version` 字段守卫风格保持一致：

```typescript
title: typeof data.title === 'string' ? data.title : undefined
```

**为什么必须守卫**：YAML 不带引号的数字 / 布尔 / 数组会被 gray-matter 解析为对应原生类型（如 `title: 123` → number），后续 `.trim()` 会抛 TypeError。现有 `description` 写的是 `typeof data.description === 'string' ? ... : undefined`（`skillSync.service.ts` L50），新字段对齐这一守卫习惯。

**兜底规则**：service 层 `fm.title?.trim() || fm.name`（`title` 经守卫后已是 `string | undefined`）。frontmatter 没写 title 时，扫描入库的 `title` 仍兜底为英文 name（避免显示空白）。

## 同步逻辑改动

### `skillSync.service.ts`：解析 frontmatter.title

```typescript
input: {
    name: fm.name,
    path: `${SKILLS_FS_ROOT}/${entry}`,
    source: SkillSource.FILESYSTEM,
    title: fm.title?.trim() || fm.name,   // ← 改：之前一律是 fm.name
    description: fm.description ?? null,
    version: fm.version ?? null,
}
```

### `skillSync.dao.ts`：扫描不覆盖"后台说了算"的字段

`buildUpsertSkillOp` 的 `update` 段同时去掉两个字段：

| 字段 | create 段 | update 段 | 原因 |
|---|---|---|---|
| `customTitle` | 不写（NULL） | **不写** | 后台编辑专属 |
| `status` | 写 `ENABLED`（新 skill 默认启用） | **不写**（保留管理员的启停设置） | 修启用开关 bug |
| 其它（path / source / title / description / version / syncedAt） | 写 | 写 | 跟随代码文件 |

文件系统已删除的 skill 仍由 `markSkillsDisabledByNamesDAO` 标 DISABLED——这是合理的（文件没了就该停用），不影响管理员手动停用的语义。

## 后端接口改动

### 新增：管理端编辑中文名

`PATCH /api/v1/admin/skills/:name`

```typescript
// body
{ customTitle: string | null }   // null 或空字符串 = 恢复代码默认
```

**校验**：

- `customTitle` 非 null 时长度 1–200，trim 后写入；空字符串等价于 null。
- skill 不存在 → 404。

**RBAC 注册**：按 `.claude/rules/api.md` 的"管理端 API 注册流程"——路由落盘后，在管理后台「API 权限」扫描入库 + 在「角色」给目标管理类角色授权。**不写 seedData.sql**，**不在中间件里硬编码 super_admin**。

**顺手修注释一致性**：现有 `server/api/v1/admin/skills/status/[name].patch.ts` 头部注释写"依赖中间件 super_admin 拦截"——与项目铁律不符。本期顺手把该文件的鉴权注释改为"由 `03.permission.ts` 按 RBAC 权限表细粒度判定"。仅改注释，不动逻辑。新增的 `[name].patch.ts` 注释直接写新版描述，避免同目录两套表述。

### 新增：用户端中文名映射表

`GET /api/v1/skills/labels`

```typescript
// 响应（实际 = data 字段）
Array<{ name: string; label: string }>
// label = customTitle ?? title ?? name；仅返回 status = ENABLED 的 skill
```

**鉴权**：登录态即可（`event.context.auth?.user`）。**不**加入 `02.auth.ts` 的 `publicApiList`——未登录请求由现有鉴权中间件兜底返回 401。该路由不在 `admin/` 目录下，不进 RBAC 细粒度授权流程；handler 内只读 `event.context.auth?.user`，未取到则 `resError(event, 401, '请先登录')`。

返回**所有**启用的 skill，不按用户/案件过滤——前端拿到对照表后本地查表，命中谁取决于工具事件里出现哪个 `skillName`。

## 前端改动

### 后台 Skills 管理页（`SkillList.vue`）

| 当前列 | 改为 |
|---|---|
| 名称（英文 mono） | 保留 |
| **标题** | **改为 中文名 + 编辑入口**：显示 `customTitle ?? title`，行尾或 cell 内 `Pencil` 图标点击开编辑弹窗 |
| 版本 / 来源 / 路径 / 上次同步 / 启用 | 全部保留 |

**编辑弹窗**：照抄 `app/components/admin/case-types/FormDialog.vue` / `point-items/FormDialog.vue` 的标准结构，仅保留 `customTitle` 单字段：

- `Dialog` + `DialogContent` + `DialogHeader/Title` + `DialogDescription`（必须有，项目 a11y 铁律；无可见说明则 `class="sr-only"` 兜底）
- `<Input v-model="form.customTitle">` + 占位提示"留空使用代码预设"
- `defineExpose({ openEdit })` 由父组件 `SkillList` 调用
- `@interactOutside="(e) => e.preventDefault()"`（与现有 admin Dialog 一致，避免误关丢失输入）
- 保存 → `useApiFetch('/api/v1/admin/skills/:name', { method: 'PATCH', body: { customTitle } })`

**XSS 防护**：模板里展示 `customTitle` 一律走 `{{ }}` 插值（Vue 默认 HTML 转义），**禁用任何 `v-html`**。后端 zod 限 1–200，前端模板转义即可，无需额外消毒。

### 后台节点 Skill 选择器（`NodeSkillSelector.vue`）

主次互换：

```
当前：
  evidence-defense           ← 大字 mono
  evidence-defense           ← 小字（title，目前等于英文名）

改为：
  证据辩护策略               ← 大字（customTitle ?? title ?? name）
  evidence-defense           ← 小字 mono（永远是英文 name）
```

`/api/v1/admin/skills` 的返回字段补上 `customTitle`（DAO 已 select 全部，handler 透传即可）。

### 用户端"中文名映射表"消费

新增 composable `app/composables/useSkillLabels.ts`，**模块级单 Promise 缓存**（不引入 Pinia store）：

```typescript
// 形态（伪代码）
let cache: Promise<Record<string, string>> | null = null

async function ensureLoaded(): Promise<Record<string, string>> {
    if (!cache) {
        cache = useApiFetch<Array<{ name: string; label: string }>>('/api/v1/skills/labels')
            .then(list => Object.fromEntries((list ?? []).map(s => [s.name, s.label])))
            .catch(() => ({}))   // 失败兜空表，工具卡片 fallback 英文名
    }
    return cache
}

export function useSkillLabels() {
    const map = ref<Record<string, string>>({})
    onMounted(async () => { map.value = await ensureLoaded() })
    return {
        map,
        label: (name: string) => map.value[name] ?? name,
    }
}
```

**为什么不用 Pinia store**：项目 store 服务跨页面共享状态（permission / auth 等），而中文名映射只在 3 个工具卡片消费、单向只读、无写操作 → 模块级 Promise 缓存即可；多个组件同时挂载共享同一 Promise，不重复请求。

**为什么不在 layout `onMounted` 触发**：项目 layouts（`dashboardLayout.vue` / `admin-layout.vue` / `settingsLayout.vue`）均无 `onMounted` 数据预拉取惯例，全局共享数据走 `01.auth.global.ts` 中间件初始化。本特性按"工具卡片首次出现时懒加载"更轻——加上模块级 Promise 共享，并发挂载只触发一次请求。

**缓存失效**：单次会话缓存（刷新页面才重取）。管理员改完中文名，已在用 AI 的用户**刷新页面后看到新值**——这是用户已确认接受的取舍。

### 工具卡片显示中文名

涉及 3 个组件：`RunSkillScriptTool.vue` / `ReadSkillFileTool.vue` / `WriteSkillFileTool.vue`。

每个组件已有从 `props.input` 提取 `skillName`（英文）的 `computed`，在它后面追加：

```typescript
import { useSkillLabels } from '~/composables/useSkillLabels'
const { label } = useSkillLabels()
const skillDisplay = computed(() => {
    const en = skillName.value
    if (!en || en === '_workspace') return en  // 保留 _workspace 等特殊别名
    return label(en)
})
```

模板里展示位置（`subtitle` / 主标题）从 `skillName.value` 改为 `skillDisplay.value`。`_workspace`（"会话工作区"）这类特殊别名保持原逻辑不动；映射表未命中（如老 skill 已被删）时 `label()` 兜底返回英文 name。

## 测试

### 单元 / 集成

| 测试点 | 文件 |
|---|---|
| frontmatter 解析含 title | `tests/server/agent-platform/skills/skillSync.service.test.ts` |
| 扫描时 fm.title 缺失兜底英文 name | 同上 |
| `customTitle` 在重扫后不被覆盖 | 同上 |
| 管理员手动停用的 skill 在重扫后保持 DISABLED（启用开关 bug 修复回归测试） | 同上 |
| 文件系统删除的 skill 仍被标 DISABLED（不被启用开关 fix 误伤） | 同上 |
| `parseSkillFrontmatterFromMarkdown` 对 `title` 字段做 string 类型守卫（数字/数组等异常类型返回 undefined） | 同上 |
| `PATCH /admin/skills/:name` 校验长度 / 空字符串等价 null / skill 不存在 404 | `tests/server/admin/skills/update.api.test.ts`（新增） |
| `GET /skills/labels` 仅返回 ENABLED + label 优先级（custom > title > name）+ 未登录 401 | `tests/server/skills/labels.api.test.ts`（新增） |
| `useSkillLabels` composable：并发挂载共享 Promise（仅触发一次请求）+ `label` 命中 / 兜底 | `tests/client/composables/useSkillLabels.test.ts`（新增） |

### E2E（chrome-devtools，可选）

- 后台改完中文名 → 列表立刻显示新值
- 节点选择器看到中文 + 英文副标
- 用户对话里调用 skill → 工具卡片显示中文名

### 覆盖率

`server/services/agent-platform/**` 在 `vitest.config.ts` 有 ≥90% 阈值（详见 `.claude/rules/agent-platform.md`），新增逻辑必须覆盖到这个标准。

## 数据库迁移

- 新增 `customTitle` 列：`prisma/models/skill.prisma` 加 `customTitle String? @map("custom_title") @db.VarChar(200)`
- 走 `bun run prisma:migrate --name add_skill_custom_title`，**不**手写 SQL，**不**改 `seedData.sql`，**不**改已有 migrations 文件
- 字段 nullable，无需回填

## 影响范围

| 文件 | 改动类型 |
|---|---|
| `prisma/models/skill.prisma` | 新增 `customTitle` 列 |
| `prisma/migrations/<新>/migration.sql` | 新增（由 `prisma migrate dev` 生成，禁止手写） |
| `shared/types/skill.ts` | `SkillFrontmatter` 加 `title?` |
| `server/services/agent-platform/skills/skillSync.service.ts` | `parseSkillFrontmatterFromMarkdown` 解析 title（含 string 类型守卫）；`scanAndSyncSkillsService` 写入用 `fm.title?.trim() \|\| fm.name` |
| `server/services/agent-platform/skills/skillSync.dao.ts` | upsert 的 update 段去掉 `customTitle` 与 `status`（顺手修启用开关 bug）；`listAllSkillsDAO` 已返回全字段无需改 |
| `server/api/v1/admin/skills/[name].patch.ts` | **新增**（管理端编辑中文名） |
| `server/api/v1/skills/labels.get.ts` | **新增**（用户端中文名映射表） |
| `server/api/v1/admin/skills/status/[name].patch.ts` | 仅修头部注释，"super_admin 拦截" → "RBAC 细粒度判定"（逻辑不动） |
| `app/components/admin/skills/SkillList.vue` | 列改"中文名"+ 编辑弹窗 |
| `app/components/admin/skills/SkillEditDialog.vue` | **新增**（照抄 `case-types/FormDialog.vue` 模板，单字段 customTitle） |
| `app/components/admin/nodes/NodeSkillSelector.vue` | 主次互换：中文名大字 + 英文 mono 小字 |
| `app/components/ai/tools/RunSkillScriptTool.vue` | 显示走 `useSkillLabels().label()` |
| `app/components/ai/tools/ReadSkillFileTool.vue` | 同上 |
| `app/components/ai/tools/WriteSkillFileTool.vue` | 同上 |
| `app/composables/useSkillLabels.ts` | **新增** composable + 模块级 Promise 缓存 |
| `.deepagents/skills/*/SKILL.md` | 各 skill frontmatter 补 `title:` 字段（开发者补，本期可分批） |

## 显式不做的事

- 不开放 `description` / `version` / `path` 等其他字段的后台编辑
- 不做"中文名修改历史 / 审计日志"
- 不做"管理员改完中文名实时推送给在线用户"——刷新页面看到即可
- 不做用户端"按中文名搜索 skill"
- 不删 `prisma/models/skill.prisma` 现有 `title` 字段（仍作为代码默认层使用）
- 不动现有 `/admin/skills/status/:name`（启停接口职责单一，保持不动）
