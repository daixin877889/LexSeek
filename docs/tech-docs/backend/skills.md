# Agent Skills 注册表

LexSeek 的 Skill 系统让 Agent 在对话中按需调用一段封装好的能力（脚本 / 文件 / 提示词组合），由文件系统作为真理来源 + 数据库作为注册表 + LangChain `skillsMiddleware`（`deepagents` 出品）作为运行时挂载点。

每个 skill 由 `.deepagents/skills/<name>/SKILL.md` 描述（frontmatter 元数据 + 可选脚本 / 模板文件），在 Nitro 启动时扫描入库，再由节点（`nodes` 表）通过 `node_skills` 关联表挂载。

---

## 1. 架构概览

```
.deepagents/skills/<name>/SKILL.md       ← 真理来源（git 管理）
                │ frontmatter: name / title / description / version
                ▼
Nitro 启动 plugin (skill-sync.ts)
  └── scanAndSyncSkillsService
        ├── 扫描子目录 + parseSkillFrontmatterFromMarkdown
        ├── 1 次 transaction 批量 upsertSkillOp
        └── 文件系统已删除 → markSkillsDisabledByNamesDAO
                │
                ▼
            skills 表（注册表）
                │
   nodes ──N:M── node_skills ──N:M── skills
                │
                ▼ buildSkillsMiddlewareForNode(nodeId)
        ┌───────────────────────────────────┐
        │ 节点关联了 skill?                  │
        ├── 是 → createSkillsMiddleware     │
        │       + 4 个 skill 工具注入       │
        │       + AllowlistedFilesystemBackend
        │         过滤掉 DISABLED skill     │
        └── 否 → 返回 null（工厂跳过）        │
        └───────────────────────────────────┘
                │
                ▼
        Agent 运行时按节点装配 skillsMiddleware
```

---

## 2. 数据模型

详见 [data-model.md §1 / §2.6](../architecture/data-model.md)。两张表：

| 表 | 主键 | 关键字段 |
|----|------|---------|
| `skills` | `name`（VARCHAR(100)） | `path` / `source`（filesystem/uploaded） / `title`（来自 frontmatter，扫描写入） / `customTitle`（管理后台覆盖） / `description` / `version` / `status`（1 启用 / 0 停用） / `syncedAt` |
| `node_skills` | `(nodeId, skillName)` | `priority`（决定 system prompt 中 skill 出现顺序，越小越靠前） |

**字段语义关键点**：

- `title`：代码默认中文名，由 `SKILL.md` frontmatter `title` 字段写入；frontmatter 缺失时**兜底为 `name`**（英文）
- `customTitle`：管理后台自定义中文名；为 `NULL` 时回退到 `title`
- `status`：扫描时**永不覆盖**——保留管理员手动启停状态
- `customTitle`：扫描时**永不覆盖**——保留管理员自定义值

> 这两个"扫描永不覆盖"的字段在 `skillSync.dao.ts` 的 `buildUpsertSkillOp` 里通过 `update` 段省略实现。详见源码注释。

---

## 3. 文件系统约定

```
.deepagents/skills/<skill-name>/
  ├── SKILL.md              ← 必须，含 frontmatter
  ├── scripts/*.{ts,py,sh}  ← 可选，由 runSkillScript 工具执行
  ├── references/*.md       ← 可选，由 readSkillFile 加载
  └── templates/*.{md,docx,pptx}  ← 可选，业务模板
```

`SKILL.md` frontmatter 字段（解析见 `parseSkillFrontmatterFromMarkdown`）：

```yaml
---
name: evidence-defense        # 必须，与目录名一致；不是 string 或缺失则该 skill 整条丢弃
title: 证据防御               # 可选，中文展示名；缺失或非 string 则 fallback 为 name
description: 当用户...        # 可选，触发说明，会进 system prompt
version: 0.1.0               # 可选
license: MIT                  # 可选
---
```

> 类型守卫：parser 对 `title` / `description` / `version` 等字段做 `typeof === 'string'` 检查，遇到数字 / 数组等异常类型一律降级为 `undefined`，不阻断扫描。

当前已落地 14 个 skill：`anjian-dashiji` / `anjian-gaiyao` / `anyou-xuanze` / `criminal-evidence-review` / `docx` / `kangbian-fenxi` / `legal-document-writer` / `litigation-visualization` / `minimax-pdf` / `minimax-xlsx` / `panjue-qushi` / `pptx` / `qingqiuquan-jichu` / `zhengju-celue`。

---

## 4. 启动期同步

`server/plugins/skill-sync.ts` 在 Nitro 启动时调用 `scanAndSyncSkillsService()`：

1. `readdir('.deepagents/skills')` 列子目录
2. 每个子目录读 `SKILL.md` → `parseSkillFrontmatterFromMarkdown`
3. 解析失败的项进 `errors[]`，不阻塞其他 skill
4. 把所有成功的项 `buildUpsertSkillOp` 收集成 N 条 PrismaPromise
5. **1 次 `prisma.$transaction([...])`** 批量提交（避免 N 次往返）
6. 数据库里有但文件系统已删的 → `markSkillsDisabledByNamesDAO` 把 `status` 标 `0`（保留行做软删除）
7. 异常仅 logger.error，不抛——**绝不阻塞 Nitro 启动**

返回 `ScanResult`：`{ scanned, added, updated, disabled, errors }`。

---

## 5. 运行时挂载（`buildSkillsMiddlewareForNode`）

`server/services/agent-platform/middleware/skills.ts`：

```ts
async function buildSkillsMiddlewareForNode(nodeId: number) {
  const skills = await listSkillsByNodeIdDAO(nodeId)  // SELECT skills.* JOIN node_skills
  if (skills.length === 0) return null                // 关键：null = 工厂跳过挂载
  const sources = [...new Set(skills.map(s => dirname(s.path)))]  // ".deepagents/skills"
  const allowedSkillNames = new Set(skills.map(s => s.name))
  const backend = getFilesystemBackend(sources, allowedSkillNames)
  return createSkillsMiddleware({ backend, sources })
}
```

要点：

- **deepagents 期望 `sources` 是父目录**（`.deepagents/skills`），它会自己 ls 列子目录加载 `SKILL.md`
- `AllowlistedFilesystemBackend` 装饰原 backend，拦截 `ls()` 把"父目录里"不在白名单的子目录剔除——让被禁用的 skill 不被 LLM 看到
- 工厂判 `null` 时**同时跳过** `readSkillFile` / `writeSkillFile` / `runSkillScript` / `runSkillCommand` 4 个工具的注入——避免出现"工具可见但 backend 不可用"
- `getFilesystemBackend` 带缓存（`filesystemBackendCache.ts`），同 sources 复用同一 backend 实例；管理员改启停后由 `invalidateBackendCache()` 清缓存

---

## 6. API 速查

### 用户端

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/v1/skills/labels` | 取启用 skill 的 `{ name, label }` 数组（label 优先 customTitle / 否则 title）；前端工具卡片 / 节点选择器用 `useSkillLabels` composable 缓存 |

### 管理端

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/v1/admin/skills` | 列全部 skill（含 disabled），按 name 升序 |
| POST | `/api/v1/admin/skills/resync` | 触发一次 `scanAndSyncSkillsService`（开发期手动重扫） |
| PATCH | `/api/v1/admin/skills/:name` | 编辑 `customTitle`（空字符串 / `null` 等价"恢复代码默认"） |
| PATCH | `/api/v1/admin/skills/status/:name` | 启停 skill |

> 管理端接口走 RBAC 细粒度授权——必须在「API 权限」页扫描 + 「角色」页授权后管理类角色才能访问。详见 [api.md 管理端 API 注册流程](../../.claude/rules/api.md)（项目根 rules 目录）。

---

## 7. 前端 composable：`useSkillLabels`

`app/composables/useSkillLabels.ts`：模块级 Promise 缓存的 `name → label` 映射表。

- 单次会话内**只请求一次**（多个组件挂载共享缓存）
- 提供 `label(name)` 同步查表，未命中或未加载时兜底返回原 `name`（不打断 UI）
- 管理员改完 customTitle 后，用户**刷新页面**才看到新值——避免实时拉取放大请求量

使用场景：
- 节点编辑器的 skill 多选 chip
- AI 对话工具卡片的 skill 名展示（`RunSkillScriptTool.vue` / `ReadSkillFileTool.vue` / `WriteSkillFileTool.vue`）
- 管理后台 `SkillList.vue`（中文名优先列）

---

## 8. 设计要点回顾

| 决策 | 原因 |
|------|------|
| 文件系统是真理来源 | skill 内容（脚本 / 模板）随代码 git 管理；DB 仅做注册表 + 元数据缓存 |
| 启动期一次性扫描 + 1 次 transaction | 避免运行时 IO；不写 cron 是因为开发期可以 `POST /admin/skills/resync` 手动触发 |
| `title` vs `customTitle` 双列 | 扫描每次都要刷新 `title`（跟随代码）但**不能**踩掉管理员自定义值；分两列彻底隔离来源 |
| `status` 扫描不覆盖 | 阶段 1 曾把启停开关与扫描混在一起，导致每次重启所有 skill 被强行设回 ENABLED；现拆分 |
| `AllowlistedFilesystemBackend` 而非"启动时只 upsert 启用的" | DISABLED skill 仍要在管理表里可见 + 可恢复，文件系统永不删 |
| `null` 跳过 skillsMiddleware 挂载 | 大多数节点不需要 skill，避免注入空 skillsMiddleware 拖慢图编译 |

---

## 9. 引用关系

| 文档 | 关系 |
|------|------|
| [agent-platform.md](./agent-platform.md) | skillsMiddleware 在中间件栈中的位置（优先级 40） |
| [node.md](./node.md) | `nodes.useSkillsAsLogic` 与 `node_skills` 关联 |
| [data-model.md](../architecture/data-model.md) | `skills` / `node_skills` 表结构 |
| [docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5](../../superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md) | 原始设计文档 |
| [docs/superpowers/specs/2026-05-01-skills-chinese-name-design.md](../../superpowers/specs/2026-05-01-skills-chinese-name-design.md) | `customTitle` 设计与扫描覆盖策略修订 |
