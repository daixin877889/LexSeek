# Skills 中文名管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 skills 拥有中文展示名（代码 SKILL.md 预设默认 + 后台管理员自定义覆盖），后台管理页 / 节点选择器 / 用户对话工具卡片三处都按中文名显示；顺手修复"启用开关被扫描覆盖"的 bug。

**Architecture:** 数据库新增独立列 `customTitle` 存后台覆盖值，原有 `title` 列改为存代码默认（来自 SKILL.md frontmatter.title 或兜底英文 name）；扫描时 update 段不再覆盖 `customTitle` 与 `status`，只更新跟随代码的字段。前端工具卡片用模块级 Promise 缓存的 composable `useSkillLabels` 在首次挂载时拉一次映射表。

**Tech Stack:** Nuxt 4 + Nitro + Vue 3 + Pinia(已有不动)+ Prisma + PostgreSQL + Vitest + shadcn-vue + Tailwind v4

**关联设计文档:** `docs/superpowers/specs/2026-05-01-skills-chinese-name-design.md`

---

## 文件结构

| 文件路径 | 改动类型 | 责任 |
|---|---|---|
| `prisma/models/skill.prisma` | 修改 | 新增 `customTitle` 列 |
| `prisma/migrations/<新>/migration.sql` | 新增（生成）| 迁移文件 |
| `shared/types/skill.ts` | 修改 | `SkillFrontmatter.title?: string` |
| `server/services/agent-platform/skills/skillSync.service.ts` | 修改 | parse 加 title 守卫；写入用 fm.title 兜底 |
| `server/services/agent-platform/skills/skillSync.dao.ts` | 修改 | upsert update 段去掉 customTitle 与 status；新增 `updateSkillCustomTitleDAO`、`listEnabledSkillLabelsDAO` |
| `server/services/agent-platform/skills/skillSync.service.ts` | 修改 | 新增 `updateSkillCustomTitleService`、`listEnabledSkillLabelsService` |
| `server/api/v1/admin/skills/[name].patch.ts` | 新增 | 管理端编辑中文名 |
| `server/api/v1/admin/skills/status/[name].patch.ts` | 修改 | 仅修头部注释 |
| `server/api/v1/skills/labels.get.ts` | 新增 | 用户端中文名映射表 |
| `app/composables/useSkillLabels.ts` | 新增 | 模块级 Promise 缓存 |
| `app/components/admin/skills/SkillEditDialog.vue` | 新增 | 编辑中文名弹窗（照抄 case-types/FormDialog） |
| `app/components/admin/skills/SkillList.vue` | 修改 | 列改"中文名" + 编辑入口 |
| `app/components/admin/nodes/NodeSkillSelector.vue` | 修改 | 主次互换 |
| `app/components/ai/tools/RunSkillScriptTool.vue` | 修改 | 用 useSkillLabels |
| `app/components/ai/tools/ReadSkillFileTool.vue` | 修改 | 同上 |
| `app/components/ai/tools/WriteSkillFileTool.vue` | 修改 | 同上 |
| `tests/server/agent-platform/skills/skillSync.service.test.ts` | 扩展 | 新增多个测试用例 |
| `tests/server/agent-platform/skills/skillSync.dao.test.ts` | 扩展 | 新增 customTitle/status 不覆盖、新 DAO 测试 |
| `tests/server/admin/skills/update.api.test.ts` | 新增 | PATCH 接口测试 |
| `tests/server/skills/labels.api.test.ts` | 新增 | GET labels 接口测试 |
| `tests/client/composables/useSkillLabels.test.ts` | 新增 | composable 单测 |
| `.deepagents/skills/*/SKILL.md` | 修改 | 各 skill 补 title:中文名 |

---

## Task 1：Prisma schema 加 `customTitle` 列 + 迁移

**Files:**
- Modify: `prisma/models/skill.prisma`
- Create: `prisma/migrations/<生成>/migration.sql`

- [ ] **Step 1: 改 schema**

修改 `prisma/models/skill.prisma`，在 `version` 行下方插入：

```prisma
  /// 中文展示名（管理员后台自定义；为 NULL 时回退到 title 字段）
  customTitle String?      @map("custom_title") @db.VarChar(200)
```

完整插入位置（在 `version String? ... ` 后、`status Int @default(1)` 前）：

```prisma
  version     String?      @db.VarChar(50)
  /// 中文展示名（管理员后台自定义；为 NULL 时回退到 title 字段）
  customTitle String?      @map("custom_title") @db.VarChar(200)
  /// 状态：1 启用 / 0 停用
  status      Int          @default(1)
```

- [ ] **Step 2: 跑迁移生成 SQL**

```bash
bun run prisma:migrate --name add_skill_custom_title
```

期望输出：在 `prisma/migrations/<时间戳>_add_skill_custom_title/migration.sql` 看到 `ALTER TABLE "skills" ADD COLUMN "custom_title" VARCHAR(200);`，且本地 dev DB 自动应用。

- [ ] **Step 3: Commit**

```bash
git add prisma/models/skill.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): skills 表新增 customTitle 字段用于后台自定义中文名
EOF
)"
```

---

## Task 2：`SkillFrontmatter` 类型 + `parseSkillFrontmatterFromMarkdown` 加 `title` 守卫

**Files:**
- Modify: `shared/types/skill.ts`
- Modify: `server/services/agent-platform/skills/skillSync.service.ts:43-57`
- Test: `tests/server/agent-platform/skills/skillSync.service.test.ts`

- [ ] **Step 1: 写测试用例（先 fail）**

在 `tests/server/agent-platform/skills/skillSync.service.test.ts` 找到 `parseSkillFrontmatterFromMarkdown` 相关 describe 块（如不存在则新增），在末尾追加：

```typescript
describe('parseSkillFrontmatterFromMarkdown - title 字段', () => {
    it('解析合法 string title', () => {
        const md = `---\nname: foo\ntitle: 案件证据辩护\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBe('案件证据辩护')
    })

    it('title 为数字时返回 undefined（类型守卫）', () => {
        const md = `---\nname: foo\ntitle: 123\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBeUndefined()
    })

    it('title 为数组时返回 undefined（类型守卫）', () => {
        const md = `---\nname: foo\ntitle:\n  - a\n  - b\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBeUndefined()
    })

    it('frontmatter 没写 title 时为 undefined', () => {
        const md = `---\nname: foo\n---\n\n# body`
        const fm = parseSkillFrontmatterFromMarkdown(md)
        expect(fm).not.toBeNull()
        expect(fm!.title).toBeUndefined()
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.service.test.ts -t "title 字段" --reporter=verbose
```

期望：4 个 case 全 FAIL，`title` 属性不存在或值不对。

- [ ] **Step 3: 改类型**

`shared/types/skill.ts` 的 `SkillFrontmatter` 接口加 `title?: string`：

```typescript
export interface SkillFrontmatter {
    name: string
    title?: string
    description?: string
    license?: string
    version?: string
}
```

- [ ] **Step 4: 改解析函数**

`server/services/agent-platform/skills/skillSync.service.ts` 的 `parseSkillFrontmatterFromMarkdown` 函数 return 块，在 `name:` 后加一行 `title:`：

```typescript
return {
    name: String(data.name),
    title: typeof data.title === 'string' ? data.title : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    license: typeof data.license === 'string' ? data.license : undefined,
    version: typeof data.version === 'string' ? data.version : (data.version != null ? String(data.version) : undefined),
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.service.test.ts -t "title 字段" --reporter=verbose
```

期望：4 个 case 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add shared/types/skill.ts server/services/agent-platform/skills/skillSync.service.ts tests/server/agent-platform/skills/skillSync.service.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): SkillFrontmatter 加 title 字段并对解析做 string 类型守卫
EOF
)"
```

---

## Task 3：`scanAndSyncSkillsService` 写入 title 用 `fm.title?.trim() || fm.name` 兜底

**Files:**
- Modify: `server/services/agent-platform/skills/skillSync.service.ts:130-141`
- Test: `tests/server/agent-platform/skills/skillSync.service.test.ts`

- [ ] **Step 1: 写测试用例（先 fail）**

在 `tests/server/agent-platform/skills/skillSync.service.test.ts` 末尾追加：

```typescript
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('scanAndSyncSkillsService - title 兜底', () => {
    let tmpRoot: string
    const createdNames: string[] = []

    afterEach(async () => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
        if (createdNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: createdNames } } })
            createdNames.length = 0
        }
    })

    it('SKILL.md 有 title 字段时入库 title=frontmatter.title', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'skills-test-'))
        const skillName = `t_skill_${Date.now()}_a`
        createdNames.push(skillName)
        const dir = join(tmpRoot, skillName)
        mkdirSync(dir)
        writeFileSync(
            join(dir, 'SKILL.md'),
            `---\nname: ${skillName}\ntitle: 中文名 A\n---\n\nbody`,
        )

        await scanAndSyncSkillsService(tmpRoot)

        const row = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(row?.title).toBe('中文名 A')
    })

    it('SKILL.md 没 title 字段时入库 title=name（兜底）', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'skills-test-'))
        const skillName = `t_skill_${Date.now()}_b`
        createdNames.push(skillName)
        const dir = join(tmpRoot, skillName)
        mkdirSync(dir)
        writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${skillName}\n---\n\nbody`)

        await scanAndSyncSkillsService(tmpRoot)

        const row = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(row?.title).toBe(skillName)
    })

    it('SKILL.md title 是空白字符串时入库 title=name（兜底）', async () => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'skills-test-'))
        const skillName = `t_skill_${Date.now()}_c`
        createdNames.push(skillName)
        const dir = join(tmpRoot, skillName)
        mkdirSync(dir)
        writeFileSync(
            join(dir, 'SKILL.md'),
            `---\nname: ${skillName}\ntitle: "   "\n---\n\nbody`,
        )

        await scanAndSyncSkillsService(tmpRoot)

        const row = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(row?.title).toBe(skillName)
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.service.test.ts -t "title 兜底" --reporter=verbose
```

期望：第一个 case FAIL（title 当前是 fm.name 不是 "中文名 A"）。

- [ ] **Step 3: 改 service 写入逻辑**

`server/services/agent-platform/skills/skillSync.service.ts` 的 `validated.push` 块（约 L130-141），把 `title: fm.name` 改成 `title: fm.title?.trim() || fm.name`：

```typescript
validated.push({
    input: {
        name: fm.name,
        path: `${SKILLS_FS_ROOT}/${entry}`,
        source: SkillSource.FILESYSTEM,
        title: fm.title?.trim() || fm.name,
        description: fm.description ?? null,
        version: fm.version ?? null,
    },
    isNew: !existingFilesystemSkills.has(fm.name),
})
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.service.test.ts -t "title 兜底" --reporter=verbose
```

期望：3 个 case 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/skills/skillSync.service.ts tests/server/agent-platform/skills/skillSync.service.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): 扫描时 title 优先取 frontmatter.title，缺失/空白兜底英文 name
EOF
)"
```

---

## Task 4：`buildUpsertSkillOp` 的 update 段去掉 `customTitle` 与 `status`（启用开关 fix）

**Files:**
- Modify: `server/services/agent-platform/skills/skillSync.dao.ts:26-50`
- Test: `tests/server/agent-platform/skills/skillSync.dao.test.ts`

- [ ] **Step 1: 写测试用例（先 fail）**

在 `tests/server/agent-platform/skills/skillSync.dao.test.ts` 末尾追加：

```typescript
describe('buildUpsertSkillOp - 扫描不覆盖后台字段', () => {
    it('管理员手动停用的 skill 重扫后保持 DISABLED', async () => {
        const name = `test_skill_${Date.now()}_status_keep`
        testSkillNames.push(name)

        // 第一次创建（默认 ENABLED）
        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
        })
        // 管理员手动停用
        await prisma.skills.update({ where: { name }, data: { status: SkillStatus.DISABLED } })

        // 第二次扫描（模拟 resync）
        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
        })

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.DISABLED)
    })

    it('管理员设置的 customTitle 重扫后保持不变', async () => {
        const name = `test_skill_${Date.now()}_ct_keep`
        testSkillNames.push(name)

        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
            title: '代码默认名',
        })
        // 管理员设置 customTitle
        await prisma.skills.update({ where: { name }, data: { customTitle: '后台覆盖名' } })

        // 第二次扫描
        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
            title: '代码默认名 v2',
        })

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBe('后台覆盖名')
        expect(row?.title).toBe('代码默认名 v2')   // title 跟随代码
    })

    it('新 skill 第一次入库 status 默认 ENABLED', async () => {
        const name = `test_skill_${Date.now()}_new_enabled`
        testSkillNames.push(name)

        await upsertSkillDAO({
            name, path: `path/${name}`, source: SkillSource.FILESYSTEM,
        })

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.status).toBe(SkillStatus.ENABLED)
        expect(row?.customTitle).toBeNull()
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts -t "扫描不覆盖后台字段" --reporter=verbose
```

期望：第 1 个 case FAIL（status 被覆盖回 ENABLED）。第 2 个 case 也可能 FAIL（即使 customTitle 列已存在，update 段目前也会无条件不写它，结果可能 PASS——但必须确认 PASS 是因为 update 不写 customTitle 而非别的原因）。

- [ ] **Step 3: 改 DAO**

`server/services/agent-platform/skills/skillSync.dao.ts` 的 `buildUpsertSkillOp`，把 `update` 段删除 `status: SkillStatus.ENABLED` 这一行：

```typescript
return prisma.skills.upsert({
    where: { name: input.name },
    create: {
        name: input.name,
        path: input.path,
        source: input.source,
        title: input.title ?? null,
        description: input.description ?? null,
        version: input.version ?? null,
        status: SkillStatus.ENABLED,
        syncedAt: now,
    },
    update: {
        path: input.path,
        source: input.source,
        title: input.title ?? null,
        description: input.description ?? null,
        version: input.version ?? null,
        // status 不写：保留管理员手动设置（启用开关 bug fix）
        // customTitle 不写：后台编辑专属，扫描永不覆盖
        syncedAt: now,
    },
})
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts -t "扫描不覆盖后台字段" --reporter=verbose
```

期望：3 个 case 全 PASS。

- [ ] **Step 5: 跑全部 dao + service 测试做回归**

```bash
npx vitest run tests/server/agent-platform/skills/ --reporter=verbose
```

期望：全部 PASS（含 Task 2 / 3 已写的 case）。

> 说明：`markSkillsDisabledByNamesDAO`（文件系统删除标 DISABLED）与 `buildUpsertSkillOp` 是两条独立 SQL 路径（updateMany vs upsert），本 task 的修改不可能影响前者。

- [ ] **Step 6: Commit**

```bash
git add server/services/agent-platform/skills/skillSync.dao.ts tests/server/agent-platform/skills/skillSync.dao.test.ts
git commit -m "$(cat <<'EOF'
fix(skills): 扫描 upsert 不再覆盖 status 与 customTitle

- 修启用开关 bug：管理员停用后重扫会被打回启用
- customTitle 字段仅由后台编辑写入，扫描永不动
EOF
)"
```

---

## Task 5：DAO 新增 `updateSkillCustomTitleDAO`

**Files:**
- Modify: `server/services/agent-platform/skills/skillSync.dao.ts`
- Test: `tests/server/agent-platform/skills/skillSync.dao.test.ts`

- [ ] **Step 1: 写测试用例（先 fail）**

在 `tests/server/agent-platform/skills/skillSync.dao.test.ts` 末尾追加：

```typescript
describe('updateSkillCustomTitleDAO', () => {
    it('设置 customTitle 为字符串', async () => {
        const name = `test_skill_${Date.now()}_ct_set`
        testSkillNames.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })

        const row = await updateSkillCustomTitleDAO(name, '我的中文名')
        expect(row.customTitle).toBe('我的中文名')
    })

    it('设置 customTitle 为 null（恢复代码默认）', async () => {
        const name = `test_skill_${Date.now()}_ct_clear`
        testSkillNames.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })
        await updateSkillCustomTitleDAO(name, '先设值')

        const row = await updateSkillCustomTitleDAO(name, null)
        expect(row.customTitle).toBeNull()
    })

    it('skill 不存在抛 P2025', async () => {
        await expect(updateSkillCustomTitleDAO('not_exist_skill_xxx', 'x'))
            .rejects.toMatchObject({ code: 'P2025' })
    })
})
```

文件顶部 import 加 `updateSkillCustomTitleDAO`：

```typescript
import {
    upsertSkillDAO,
    listAllSkillsDAO,
    listSkillsByNodeIdDAO,
    markSkillsDisabledByNamesDAO,
    deleteSkillDAO,
    updateSkillCustomTitleDAO,
} from '~~/server/services/agent-platform/skills/skillSync.dao'
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts -t "updateSkillCustomTitleDAO" --reporter=verbose
```

期望：FAIL，import 不存在。

- [ ] **Step 3: 实现 DAO**

`server/services/agent-platform/skills/skillSync.dao.ts` 末尾追加：

```typescript
/**
 * 更新单条 skill 的 customTitle（管理员后台编辑入口）。
 *
 * @param name skill 主键
 * @param customTitle 新值；null 表示恢复代码默认（DB 列设为 NULL）
 * @returns 更新后的 skill 行
 * @throws Prisma P2025 当 name 不存在
 */
export async function updateSkillCustomTitleDAO(name: string, customTitle: string | null) {
    return prisma.skills.update({
        where: { name },
        data: { customTitle },
    })
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts -t "updateSkillCustomTitleDAO" --reporter=verbose
```

期望：3 个 case 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/skills/skillSync.dao.ts tests/server/agent-platform/skills/skillSync.dao.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): 新增 updateSkillCustomTitleDAO 用于后台编辑中文名
EOF
)"
```

---

## Task 6：DAO 新增 `listEnabledSkillLabelsDAO`（用户端映射表）

**Files:**
- Modify: `server/services/agent-platform/skills/skillSync.dao.ts`
- Test: `tests/server/agent-platform/skills/skillSync.dao.test.ts`

- [ ] **Step 1: 写测试用例（先 fail）**

在 `tests/server/agent-platform/skills/skillSync.dao.test.ts` 末尾追加：

```typescript
describe('listEnabledSkillLabelsDAO', () => {
    it('仅返回 status=ENABLED 的 skill', async () => {
        const enabledName = `test_skill_${Date.now()}_label_e`
        const disabledName = `test_skill_${Date.now()}_label_d`
        testSkillNames.push(enabledName, disabledName)

        await upsertSkillDAO({ name: enabledName, path: `p/${enabledName}`, source: SkillSource.FILESYSTEM, title: 'A 中文' })
        await upsertSkillDAO({ name: disabledName, path: `p/${disabledName}`, source: SkillSource.FILESYSTEM, title: 'B 中文' })
        await prisma.skills.update({ where: { name: disabledName }, data: { status: SkillStatus.DISABLED } })

        const list = await listEnabledSkillLabelsDAO()
        expect(list.find(s => s.name === enabledName)).toBeDefined()
        expect(list.find(s => s.name === disabledName)).toBeUndefined()
    })

    it('label 优先级：customTitle > title > name', async () => {
        const a = `test_skill_${Date.now()}_label_a`   // 仅 title
        const b = `test_skill_${Date.now()}_label_b`   // customTitle 优先
        const c = `test_skill_${Date.now()}_label_c`   // title 也无（清空），兜底 name
        testSkillNames.push(a, b, c)

        await upsertSkillDAO({ name: a, path: `p/${a}`, source: SkillSource.FILESYSTEM, title: 'A 中文' })
        await upsertSkillDAO({ name: b, path: `p/${b}`, source: SkillSource.FILESYSTEM, title: 'B 代码默认' })
        await prisma.skills.update({ where: { name: b }, data: { customTitle: 'B 后台覆盖' } })
        await upsertSkillDAO({ name: c, path: `p/${c}`, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name: c }, data: { title: null } })

        const list = await listEnabledSkillLabelsDAO()
        expect(list.find(s => s.name === a)?.label).toBe('A 中文')
        expect(list.find(s => s.name === b)?.label).toBe('B 后台覆盖')
        expect(list.find(s => s.name === c)?.label).toBe(c)
    })
})
```

文件顶部 import 加 `listEnabledSkillLabelsDAO`。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts -t "listEnabledSkillLabelsDAO" --reporter=verbose
```

期望：FAIL，import 不存在。

- [ ] **Step 3: 实现 DAO**

`server/services/agent-platform/skills/skillSync.dao.ts` 末尾追加：

```typescript
/**
 * 列出所有启用 skill 的 name → label 映射（用户端工具卡片消费）。
 * label 优先级：customTitle > title > name。
 */
export async function listEnabledSkillLabelsDAO(): Promise<Array<{ name: string; label: string }>> {
    const rows = await prisma.skills.findMany({
        where: { status: SkillStatus.ENABLED },
        select: { name: true, title: true, customTitle: true },
        orderBy: { name: 'asc' },
    })
    return rows.map(r => ({
        name: r.name,
        label: r.customTitle ?? r.title ?? r.name,
    }))
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts -t "listEnabledSkillLabelsDAO" --reporter=verbose
```

期望：2 个 case 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/skills/skillSync.dao.ts tests/server/agent-platform/skills/skillSync.dao.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): 新增 listEnabledSkillLabelsDAO 输出 name→label 映射
EOF
)"
```

---

## Task 7：Service 层新增 `updateSkillCustomTitleService` + `listEnabledSkillLabelsService`

**Files:**
- Modify: `server/services/agent-platform/skills/skillSync.service.ts`

- [ ] **Step 1: 实现两个 service 函数**

`server/services/agent-platform/skills/skillSync.service.ts` 末尾追加：

```typescript
/**
 * 编辑 skill 的中文名（后台覆盖层）。
 *
 * @param name skill 主键
 * @param raw 用户输入；trim 后空字符串等价 null（恢复代码默认）
 * @throws Prisma P2025 当 name 不存在
 *
 * 注：不调用 invalidateNodeConfigCache / invalidateBackendCache。
 * customTitle 仅服务于"用户端 /skills/labels 映射表 + 后台显示"，
 * 与 NodeConfig（节点+模型+提示词）和 deepagents FilesystemBackend（按 skill 父目录加载 SKILL.md）
 * 完全无关——这两个缓存内容里都不含 customTitle 字段。
 */
export async function updateSkillCustomTitleService(name: string, raw: string | null) {
    const trimmed = typeof raw === 'string' ? raw.trim() : null
    const customTitle = trimmed ? trimmed : null
    return await updateSkillCustomTitleDAO(name, customTitle)
}

/**
 * 列出启用 skill 的 name → label 映射（直接转发 DAO）。
 */
export async function listEnabledSkillLabelsService() {
    return listEnabledSkillLabelsDAO()
}
```

import 块（文件顶部）追加：

```typescript
import {
    buildUpsertSkillOp,
    listAllSkillsDAO,
    markSkillsDisabledByNamesDAO,
    updateSkillCustomTitleDAO,
    listEnabledSkillLabelsDAO,
    type UpsertSkillInput,
} from './skillSync.dao'
```

> 同时**移除**该文件原有的 `invalidateNodeConfigCache` / `invalidateBackendCache` 在 `updateSkillCustomTitleService` 中的引用（如已无其他使用方则一并移除 import）。这两个缓存仍由 `scanAndSyncSkillsService`（文件系统扫描完）和 `updateSkillStatusDAO`（启停接口）正确触发，本 task 不动它们。

- [ ] **Step 2: 跑现有测试做回归**

```bash
npx vitest run tests/server/agent-platform/skills/ --reporter=verbose
```

期望：之前的所有测试仍 PASS（service 层无独立测试，由 Task 8 / 10 的 API 测试覆盖业务路径）。

- [ ] **Step 3: Commit**

```bash
git add server/services/agent-platform/skills/skillSync.service.ts
git commit -m "$(cat <<'EOF'
feat(skills): service 层新增 updateSkillCustomTitle 与 listEnabledSkillLabels
EOF
)"
```

---

## Task 8：管理端 `PATCH /api/v1/admin/skills/:name` 接口

**Files:**
- Create: `server/api/v1/admin/skills/[name].patch.ts`
- Test: `tests/server/admin/skills/update.api.test.ts`

- [ ] **Step 1: 写测试**

```bash
mkdir -p /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/admin/skills
```

新建 `tests/server/admin/skills/update.api.test.ts`（照抄项目现有 `tests/server/agent-platform/skills-resync.api.test.ts` + `tests/server/assistant/runs-cancel.api.test.ts` 的"全局 stub + 动态 import handler"测试模式，**不**用 `@nuxt/test-utils` 的 setup/$fetch，**不**走真实登录链路）：

```typescript
/**
 * PATCH /api/v1/admin/skills/:name 接口测试
 *
 * **Feature: skills-chinese-name**
 *
 * 策略：直接 import handler default export，传入 mock event（含 auth 上下文 +
 * __params + __body），断言返回 body。绕过 02.auth / 03.permission 中间件——
 * 测试只验证 handler 自身逻辑（zod 校验、404、入库结果）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { upsertSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource } from '#shared/types/skill'

// 全局 stub：模拟 Nuxt nitro 自动导入的 H3 函数与响应工具
const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

// 动态 import handler（必须在全局 stub 之后）
const { default: patchHandler } = await import('~~/server/api/v1/admin/skills/[name].patch')

function makeEvent(opts: { params?: Record<string, string>; body?: any }) {
    return {
        context: { auth: { user: { id: 1 } } },
        __params: opts.params,
        __body: opts.body,
    }
}

describe('PATCH /api/v1/admin/skills/:name', () => {
    const created: string[] = []

    afterEach(async () => {
        if (created.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: created } } })
            created.length = 0
        }
    })

    it('设置 customTitle', async () => {
        const name = `t_patch_${Date.now()}_ok`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })

        const r = await patchHandler(makeEvent({ params: { name }, body: { customTitle: '我的中文名' } }))
        expect(r.code).toBe(0)

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBe('我的中文名')
    })

    it('空字符串等价 null（恢复代码默认）', async () => {
        const name = `t_patch_${Date.now()}_empty`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name }, data: { customTitle: '先设值' } })

        await patchHandler(makeEvent({ params: { name }, body: { customTitle: '   ' } }))

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBeNull()
    })

    it('null 直接清空', async () => {
        const name = `t_patch_${Date.now()}_null`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })
        await prisma.skills.update({ where: { name }, data: { customTitle: '先设值' } })

        await patchHandler(makeEvent({ params: { name }, body: { customTitle: null } }))

        const row = await prisma.skills.findUnique({ where: { name } })
        expect(row?.customTitle).toBeNull()
    })

    it('超长（>200）报 400', async () => {
        const name = `t_patch_${Date.now()}_long`
        created.push(name)
        await upsertSkillDAO({ name, path: `p/${name}`, source: SkillSource.FILESYSTEM })

        const r = await patchHandler(makeEvent({ params: { name }, body: { customTitle: 'x'.repeat(201) } }))
        expect(r.code).toBe(400)
    })

    it('skill 不存在报 404', async () => {
        const r = await patchHandler(makeEvent({ params: { name: '__not_exist__' }, body: { customTitle: 'x' } }))
        expect(r.code).toBe(404)
    })

    it('缺少 name 路径参数报 400', async () => {
        const r = await patchHandler(makeEvent({ params: {}, body: { customTitle: 'x' } }))
        expect(r.code).toBe(400)
    })
})
```

> 说明：测试不依赖 RBAC 权限表登记（直接 import handler 跳过 03.permission 中间件）。Task 14 的 RBAC 注册仅是**生产部署/手工冒烟**前置条件，不阻塞本 task 的测试通过。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/admin/skills/update.api.test.ts --reporter=verbose
```

期望：FAIL，路由不存在 → 404。

- [ ] **Step 3: 实现 handler**

新建 `server/api/v1/admin/skills/[name].patch.ts`：

```typescript
/**
 * 管理端：编辑 skill 的中文名（customTitle）
 *
 * PATCH /api/v1/admin/skills/:name
 * Body: { customTitle: string | null }   // 空字符串等价 null（恢复代码默认）
 *
 * 鉴权：由 server/middleware/03.permission.ts 按 RBAC 权限表细粒度判定
 *      （任意被授予该 API 权限的管理类角色均可访问）。
 */

import { z } from 'zod'
import { updateSkillCustomTitleService } from '~~/server/services/agent-platform/skills/skillSync.service'

const bodySchema = z.object({
    customTitle: z.union([
        z.string().max(200, 'customTitle 长度不能超过 200'),
        z.null(),
    ]),
})

export default defineEventHandler(async (event) => {
    const name = getRouterParam(event, 'name')
    if (!name) {
        return resError(event, 400, '缺少参数 name')
    }

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, '参数错误：' + parsed.error.issues[0]!.message)
    }

    try {
        const skill = await updateSkillCustomTitleService(name, parsed.data.customTitle)
        return resSuccess(event, '中文名已更新', skill)
    } catch (err: any) {
        if (err?.code === 'P2025') {
            return resError(event, 404, `skill "${name}" 不存在`)
        }
        logger.error('[admin/skills/:name PATCH] 失败', err)
        return resError(event, 500, '更新中文名失败')
    }
})
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/admin/skills/update.api.test.ts --reporter=verbose
```

期望：5 个 case 全 PASS。如果某个 case 报 403，去 Task 14 步骤注册权限。

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/admin/skills/[name].patch.ts tests/server/admin/skills/update.api.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): 新增管理端 PATCH /admin/skills/:name 接口编辑中文名
EOF
)"
```

---

## Task 9：用户端 `GET /api/v1/skills/labels` 接口

**Files:**
- Create: `server/api/v1/skills/labels.get.ts`
- Test: `tests/server/skills/labels.api.test.ts`

- [ ] **Step 1: 写测试**

```bash
mkdir -p /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/skills
```

新建 `tests/server/skills/labels.api.test.ts`（同 Task 8 的"全局 stub + 动态 import handler"模式）：

```typescript
/**
 * GET /api/v1/skills/labels 接口测试
 *
 * **Feature: skills-chinese-name**
 *
 * 策略：直接 import handler default，验证 401（未登录）和登录后返回的映射；
 * 不走 02.auth / 03.permission 中间件，测试直接 import handler 调。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { upsertSkillDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { prisma } from '~~/server/utils/db'
import { SkillSource, SkillStatus } from '#shared/types/skill'

const resError = (_event: any, code: number, message: string) => ({ code, success: false, message, data: null })
const resSuccess = (_event: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).resError = resError
;(globalThis as any).resSuccess = resSuccess
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }

const { default: labelsHandler } = await import('~~/server/api/v1/skills/labels.get')

function makeEvent(opts: { userId?: number } = {}) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
    }
}

describe('GET /api/v1/skills/labels', () => {
    const created: string[] = []

    afterEach(async () => {
        if (created.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: created } } })
            created.length = 0
        }
    })

    it('未登录返回 401', async () => {
        const r = await labelsHandler(makeEvent())
        expect(r.code).toBe(401)
    })

    it('登录后返回启用 skill 的 name→label 映射，DISABLED skill 不出现', async () => {
        const a = `t_label_${Date.now()}_a`
        const b = `t_label_${Date.now()}_b`
        const c = `t_label_${Date.now()}_c`
        created.push(a, b, c)

        await upsertSkillDAO({ name: a, path: `p/${a}`, source: SkillSource.FILESYSTEM, title: 'A 中文' })
        await upsertSkillDAO({ name: b, path: `p/${b}`, source: SkillSource.FILESYSTEM, title: 'B 默认' })
        await prisma.skills.update({ where: { name: b }, data: { customTitle: 'B 覆盖' } })
        await upsertSkillDAO({ name: c, path: `p/${c}`, source: SkillSource.FILESYSTEM, title: 'C 中文' })
        await prisma.skills.update({ where: { name: c }, data: { status: SkillStatus.DISABLED } })

        const r = await labelsHandler(makeEvent({ userId: 1 }))
        expect(r.code).toBe(0)
        const map = Object.fromEntries(r.data.map((x: { name: string; label: string }) => [x.name, x.label]))
        expect(map[a]).toBe('A 中文')
        expect(map[b]).toBe('B 覆盖')
        expect(map[c]).toBeUndefined()   // c 已停用
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/server/skills/labels.api.test.ts --reporter=verbose
```

期望：FAIL（路由不存在）。

- [ ] **Step 3: 实现 handler**

新建 `server/api/v1/skills/labels.get.ts`：

```typescript
/**
 * 用户端：获取启用 skill 的中文名映射表
 *
 * GET /api/v1/skills/labels
 *
 * 鉴权：登录态即可（不在 publicApiList，未登录由 02.auth 兜底返回 401）。
 *      该路由不在 admin/ 目录，不进 RBAC 细粒度授权流程。
 */

import { listEnabledSkillLabelsService } from '~~/server/services/agent-platform/skills/skillSync.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) {
        return resError(event, 401, '请先登录')
    }

    try {
        const labels = await listEnabledSkillLabelsService()
        return resSuccess(event, '获取 skill 中文名映射成功', labels)
    } catch (err) {
        logger.error('[skills/labels] 获取失败', err)
        return resError(event, 500, '获取 skill 中文名映射失败')
    }
})
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/server/skills/labels.api.test.ts --reporter=verbose
```

期望：2 个 case 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/skills/labels.get.ts tests/server/skills/labels.api.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): 新增用户端 GET /skills/labels 中文名映射接口
EOF
)"
```

---

## Task 10：修 status 接口注释（注释一致性）

**Files:**
- Modify: `server/api/v1/admin/skills/status/[name].patch.ts:10-12`

- [ ] **Step 1: 改注释**

把现有第 10–12 行：

```typescript
 * 鉴权：依赖 server/middleware/03.permission.ts 的 super_admin 拦截
 *      （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 */
```

改为：

```typescript
 * 鉴权：由 server/middleware/03.permission.ts 按 RBAC 权限表细粒度判定
 *      （任意被授予该 API 权限的管理类角色均可访问）。
 */
```

- [ ] **Step 2: 跑现有测试做回归**

```bash
npx vitest run tests/server/agent-platform/skills/ --reporter=verbose
```

期望：全 PASS（仅改注释，逻辑不动）。

- [ ] **Step 3: Commit**

```bash
git add server/api/v1/admin/skills/status/[name].patch.ts
git commit -m "$(cat <<'EOF'
docs(skills): 修正 status 接口鉴权注释，对齐 RBAC 描述

注释中把"super_admin 拦截"改为"RBAC 权限表细粒度判定"，
与项目铁律（管理端不允许中间件硬卡 super_admin）一致。
EOF
)"
```

---

## Task 11：前端 composable `useSkillLabels`

**Files:**
- Create: `app/composables/useSkillLabels.ts`
- Test: `tests/client/composables/useSkillLabels.test.ts`

- [ ] **Step 1: 写测试**

```bash
mkdir -p /Users/daixin/work/dev/LexSeek/LexSeek/tests/client/composables
```

新建 `tests/client/composables/useSkillLabels.test.ts`：

```typescript
/**
 * useSkillLabels composable 测试
 *
 * **Feature: skills-chinese-name**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockApiResponse: Array<{ name: string; label: string }> | null = null
let apiCallCount = 0

vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: vi.fn(async () => {
        apiCallCount++
        return mockApiResponse
    }),
}))

describe('useSkillLabels', () => {
    beforeEach(() => {
        mockApiResponse = null
        apiCallCount = 0
        // 清模块级缓存
        vi.resetModules()
    })

    it('多个组件并发挂载只触发一次 API 请求', async () => {
        mockApiResponse = [
            { name: 'foo', label: '富欧' },
            { name: 'bar', label: '巴' },
        ]
        const { useSkillLabels } = await import('~/composables/useSkillLabels')

        // 模拟 3 个组件同时调用
        const a = useSkillLabels()
        const b = useSkillLabels()
        const c = useSkillLabels()
        // 等 onMounted 微任务执行
        await new Promise(r => setTimeout(r, 0))
        await new Promise(r => setTimeout(r, 0))

        expect(apiCallCount).toBe(1)
        expect(a.label('foo')).toBe('富欧')
        expect(b.label('bar')).toBe('巴')
    })

    it('label 命中映射返回 label，未命中兜底返回 name', async () => {
        mockApiResponse = [{ name: 'foo', label: '富欧' }]
        const { useSkillLabels } = await import('~/composables/useSkillLabels')

        const { label } = useSkillLabels()
        await new Promise(r => setTimeout(r, 0))
        await new Promise(r => setTimeout(r, 0))

        expect(label('foo')).toBe('富欧')
        expect(label('not_in_map')).toBe('not_in_map')
    })

    it('API 返回 null 时兜底空表，label 全部 fallback name', async () => {
        mockApiResponse = null
        const { useSkillLabels } = await import('~/composables/useSkillLabels')

        const { label } = useSkillLabels()
        await new Promise(r => setTimeout(r, 0))
        await new Promise(r => setTimeout(r, 0))

        expect(label('foo')).toBe('foo')
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/client/composables/useSkillLabels.test.ts --reporter=verbose
```

期望：FAIL（文件不存在）。

- [ ] **Step 3: 实现 composable**

新建 `app/composables/useSkillLabels.ts`：

```typescript
import { ref, onMounted, getCurrentInstance } from 'vue'
import { useApiFetch } from '~/composables/useApiFetch'

interface SkillLabel {
    name: string
    label: string
}

/**
 * 模块级 Promise 缓存：多个组件同时挂载共享同一个请求。
 * 单次会话内不重取——管理员改完中文名后，用户刷新页面才看到新值。
 */
let cache: Promise<Record<string, string>> | null = null

async function ensureLoaded(): Promise<Record<string, string>> {
    if (!cache) {
        cache = useApiFetch<SkillLabel[]>('/api/v1/skills/labels')
            .then((list) => {
                if (!Array.isArray(list)) return {} as Record<string, string>
                return Object.fromEntries(list.map(s => [s.name, s.label]))
            })
            .catch(() => ({} as Record<string, string>))
    }
    return cache
}

/**
 * 在组件中获取 skill 英文名 → 中文展示名的映射。
 * 首次挂载时触发请求；后续挂载共享缓存。
 *
 * 调用时机：
 *  - `<script setup>` 顶层（同步阶段）：用 onMounted 注册回调
 *  - 非 setup 阶段（已挂载组件的事件回调里）：onMounted 不会再触发，
 *    通过 getCurrentInstance 兜底，立即触发 ensureLoaded
 *
 * @returns
 *  - `map`: ref，加载完成后包含 name→label 映射
 *  - `label(name)`: 同步查表，未命中或映射未加载时兜底返回原 name
 */
export function useSkillLabels() {
    const map = ref<Record<string, string>>({})
    const load = async () => {
        map.value = await ensureLoaded()
    }
    if (getCurrentInstance()) {
        // 在 setup 阶段调用：等组件挂载完再取值
        onMounted(load)
    } else {
        // 非 setup 阶段（如已挂载组件的事件回调里）调用：立即触发
        load()
    }
    return {
        map,
        label: (name: string) => map.value[name] ?? name,
    }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/client/composables/useSkillLabels.test.ts --reporter=verbose
```

期望：3 个 case 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/composables/useSkillLabels.ts tests/client/composables/useSkillLabels.test.ts
git commit -m "$(cat <<'EOF'
feat(skills): 新增 useSkillLabels composable，模块级 Promise 缓存
EOF
)"
```

---

## Task 12：`SkillEditDialog.vue` 编辑弹窗

**Files:**
- Create: `app/components/admin/skills/SkillEditDialog.vue`

- [ ] **Step 1: 实现弹窗（照抄 case-types/FormDialog 模板）**

新建 `app/components/admin/skills/SkillEditDialog.vue`：

```vue
<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-md" @interactOutside="(e) => e.preventDefault()">
            <DialogHeader>
                <DialogTitle>编辑中文名</DialogTitle>
                <DialogDescription class="sr-only">编辑 skill 中文展示名</DialogDescription>
            </DialogHeader>
            <div class="space-y-4 py-2">
                <div class="space-y-2">
                    <Label>英文标识</Label>
                    <Input :model-value="skillName" disabled class="font-mono" />
                </div>
                <div class="space-y-2">
                    <Label>中文名</Label>
                    <Input
                        v-model="form.customTitle"
                        placeholder="留空使用代码预设"
                        :maxlength="200"
                    />
                    <p class="text-xs text-muted-foreground">
                        留空 / 全空白会清除自定义，回退到 SKILL.md 里的代码默认值。
                    </p>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="open = false">取消</Button>
                <Button @click="handleSubmit" :disabled="submitting">
                    <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                    保存
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'

const emit = defineEmits<{ success: [] }>()
const open = defineModel<boolean>('open', { default: false })
const submitting = ref(false)
const skillName = ref('')
const form = ref({ customTitle: '' })

function openEdit(skill: { name: string; customTitle: string | null; title: string | null }) {
    skillName.value = skill.name
    // 编辑框初值优先 customTitle；为 null 时留空（让用户看到的是"覆盖层"内容）
    form.value.customTitle = skill.customTitle ?? ''
    open.value = true
}

async function handleSubmit() {
    submitting.value = true
    try {
        const trimmed = form.value.customTitle.trim()
        const result = await useApiFetch(`/api/v1/admin/skills/${encodeURIComponent(skillName.value)}`, {
            method: 'PATCH',
            body: { customTitle: trimmed === '' ? null : trimmed },
        })
        if (result !== null) {
            toast.success('中文名已更新')
            open.value = false
            emit('success')
        }
    } finally {
        submitting.value = false
    }
}

defineExpose({ openEdit })
</script>
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

期望：无新增错误。

- [ ] **Step 3: Commit**

```bash
git add app/components/admin/skills/SkillEditDialog.vue
git commit -m "$(cat <<'EOF'
feat(ui): 新增 SkillEditDialog 中文名编辑弹窗
EOF
)"
```

---

## Task 13：后台 `SkillList.vue` 加编辑入口

**Files:**
- Modify: `app/components/admin/skills/SkillList.vue`

- [ ] **Step 1: 改列名 + 加编辑按钮**

`app/components/admin/skills/SkillList.vue` 的 `<template>` 改动：

将 `<TableHead>标题</TableHead>` 改为 `<TableHead>中文名</TableHead>`，并在该列 cell 内追加铅笔编辑按钮。

完整列改造（替换原"标题"列对应 `<TableCell>` 与 `<TableHead>`）：

```vue
<TableHead>中文名</TableHead>
<!-- 表头其余列保持 -->

<!-- 表行内 cell -->
<TableCell>
    <div class="flex items-center gap-2">
        <span>{{ skill.customTitle ?? skill.title ?? '-' }}</span>
        <Button variant="ghost" size="icon" class="h-6 w-6" @click="handleEdit(skill)">
            <Pencil class="h-3.5 w-3.5" />
        </Button>
    </div>
</TableCell>
```

`<script setup>` 段：

1. lucide 图标 import 加 `Pencil`：

```typescript
import { Boxes, Loader2, Pencil, RefreshCw } from 'lucide-vue-next'
```

2. import 新弹窗组件：

```typescript
import AdminSkillsSkillEditDialog from '~/components/admin/skills/SkillEditDialog.vue'
```

3. `Skill` 接口加 `customTitle`：

```typescript
interface Skill {
    name: string
    path: string
    source: string
    title: string | null
    customTitle: string | null
    description: string | null
    version: string | null
    status: number
    syncedAt: string | null
    createdAt: string
    updatedAt: string
}
```

4. 加 dialog ref + handle 函数：

```typescript
const editDialogRef = ref<{ openEdit: (skill: Skill) => void } | null>(null)
const editDialogOpen = ref(false)
function handleEdit(skill: Skill) {
    editDialogRef.value?.openEdit(skill)
}
```

5. 模板末尾追加弹窗：

```vue
<AdminSkillsSkillEditDialog
    ref="editDialogRef"
    v-model:open="editDialogOpen"
    @success="loadSkills"
/>
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

期望：无新增错误。

- [ ] **Step 3: 手测（启动 dev server 看一下）**

```bash
bun dev
```

打开 `http://localhost:3000/admin/skills`：
- 表格列名应为"中文名"
- 每行右侧有铅笔图标
- 点击弹出编辑框，能保存 / 取消
- 保存后列表刷新看到新值

收尾后 `kill -9 <dev pid>`（按项目铁律，阶段性收尾必须杀 dev server，不留着等用户用）。

- [ ] **Step 4: Commit**

```bash
git add app/components/admin/skills/SkillList.vue
git commit -m "$(cat <<'EOF'
feat(ui): 后台 Skills 管理页支持编辑中文名

- 表格"标题"列改为"中文名"，显示 customTitle ?? title
- 行内铅笔图标点击弹出编辑弹窗
EOF
)"
```

---

## Task 14：注册管理端 PATCH 接口到 RBAC（人工 + 数据库）

**Files:**
- 后台手工操作（`/admin/permissions/api`）

- [ ] **Step 1: 启动 dev server**

```bash
bun dev
```

- [ ] **Step 2: 进入「API 权限」页扫描**

浏览器打开 `http://localhost:3000/admin/permissions/api`，点页面上的"扫描"按钮。

期望：列表里能看到新增的 `PATCH /api/v1/admin/skills/:name`。

- [ ] **Step 3: 在「角色」页给 super_admin（或目标管理类角色）授权**

打开 `http://localhost:3000/admin/roles`，编辑角色，把上一步扫描入库的接口权限勾选上。

> 提示：开发期 super_admin 通常通过菜单兜底已可见，但生产部署需要按这个流程显式授权其它管理类角色。

- [ ] **Step 4: 重跑 Task 8 的 API 测试做回归**

```bash
npx vitest run tests/server/admin/skills/update.api.test.ts --reporter=verbose
```

期望：全 PASS。如果某 case 报 403，说明权限未注册到测试库——需要在 ls_new_testing 库里做同样的扫描+授权（通常通过手动登录到测试环境的后台扫描）。

- [ ] **Step 5: 收尾杀 dev server**

```bash
ps aux | grep 'nuxt dev' | grep -v grep | awk '{print $2}' | xargs -r kill -9
```

> 该步骤不产生代码改动，无需 commit。

---

## Task 15：后台 `NodeSkillSelector.vue` 主次互换

**Files:**
- Modify: `app/components/admin/nodes/NodeSkillSelector.vue:30-50`

- [ ] **Step 1: 改 SkillOption 接口加 customTitle**

```typescript
interface SkillOption {
    name: string
    title: string | null
    customTitle: string | null
    status: number
}
```

- [ ] **Step 2: 改 chip 与列表显示主次**

替换现有 chip / 列表 cell 内容（只显示中文名时优先 customTitle ?? title ?? name）：

把 chip 部分原来的：

```vue
<Badge ... @click="toggleSkill(name)">
    {{ name }}
    <X class="h-3 w-3 ml-1" />
</Badge>
```

改为查表显示中文：

```typescript
function displayLabel(name: string) {
    const skill = availableSkills.value.find(s => s.name === name)
    if (!skill) return name
    return skill.customTitle ?? skill.title ?? skill.name
}
```

```vue
<Badge
    v-for="name in modelValue"
    :key="name"
    variant="secondary"
    class="cursor-pointer"
    @click="toggleSkill(name)"
>
    {{ displayLabel(name) }}
    <X class="h-3 w-3 ml-1" />
</Badge>
```

把列表项原来的：

```vue
<div class="font-medium text-sm font-mono">{{ skill.name }}</div>
<div v-if="skill.title" class="text-xs text-muted-foreground">{{ skill.title }}</div>
```

改为主次互换：

```vue
<div class="font-medium text-sm">
    {{ skill.customTitle ?? skill.title ?? skill.name }}
</div>
<div class="text-xs text-muted-foreground font-mono">{{ skill.name }}</div>
<div v-if="skill.status === 0" class="text-xs text-destructive">已停用</div>
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

期望：无错误。

- [ ] **Step 3: 手测**

```bash
bun dev
```

打开任意节点编辑页（`/admin/nodes/<id>` 或 nodes 编辑弹窗）：
- Skill 选择器列表里大字应是中文名（如已设 customTitle 则显示覆盖名）
- 副标小字 mono 是英文 name
- 已选 chip 显示中文名

杀 dev server。

- [ ] **Step 4: Commit**

```bash
git add app/components/admin/nodes/NodeSkillSelector.vue
git commit -m "$(cat <<'EOF'
feat(ui): 节点 Skill 选择器改显示中文名为主、英文 name 为副
EOF
)"
```

---

## Task 16：用户对话工具卡片改用 `useSkillLabels`

**Files:**
- Modify: `app/components/ai/tools/RunSkillScriptTool.vue`
- Modify: `app/components/ai/tools/ReadSkillFileTool.vue`
- Modify: `app/components/ai/tools/WriteSkillFileTool.vue`

> 三个组件改动相同模式，逐一处理；改完一个 commit 一个，避免一次大 diff 难 review。

### 16.1 `RunSkillScriptTool.vue`

- [ ] **Step 1: 改组件**

`app/components/ai/tools/RunSkillScriptTool.vue` 的 `<script setup>` 段：

1. import composable：

```typescript
import { useSkillLabels } from '~/composables/useSkillLabels'
const { label: skillLabelOf } = useSkillLabels()
```

2. 现有 `skillName` computed 后追加 `skillDisplay`：

```typescript
const skillDisplay = computed<string>(() => {
    const en = skillName.value
    if (!en || en === '会话工作区') return en   // _workspace 已在 skillName 里映射成"会话工作区"
    // 仅在英文形态时查表
    return /^[a-z0-9-]+$/.test(en) ? skillLabelOf(en) : en
})
```

3. `subtitle` computed 内把 `skillName.value` 改为 `skillDisplay.value`：

```typescript
const subtitle = computed<string>(() => {
    const parts: string[] = ['运行技能脚本']
    if (skillDisplay.value) parts.push(skillDisplay.value)   // ← 改
    if (action.value) parts.push(action.value)
    if (isRunning.value) parts.push('进行中…')
    else if (props.state === 'output-error') parts.push('失败')
    else if (props.state === 'output-denied') parts.push('已拒绝')
    else if (props.state === 'input-paused') parts.push('已暂停')
    return parts.join(' · ')
})
```

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

期望：无错误。

- [ ] **Step 3: Commit**

```bash
git add app/components/ai/tools/RunSkillScriptTool.vue
git commit -m "$(cat <<'EOF'
feat(ui): RunSkillScriptTool 工具卡片显示 skill 中文名
EOF
)"
```

> **范围说明**：ReadSkillFileTool / WriteSkillFileTool 与 RunSkillScriptTool 不同——它们的 UI 主信息是**文件路径**（`props.input.path`，如 `.deepagents/skills/evidence-defense/SKILL.md`），不是直接显示 skill 名。本任务把路径中的 skill 目录段（`evidence-defense`）替换为中文（`证据辩护策略`）；鼠标悬停 `title` 仍显示原始英文路径。

### 16.2 `ReadSkillFileTool.vue`

- [ ] **Step 1: 改组件 script 段**

`app/components/ai/tools/ReadSkillFileTool.vue` 的 `<script setup>`，在 `dirPath` computed 后追加：

```typescript
import { useSkillLabels } from '~/composables/useSkillLabels'
const { label: skillLabelOf } = useSkillLabels()

// 把 dirPath 里 ".deepagents/skills/<英文 skill 名>" 段替换为中文展示名；
// 路径其它段保持原样。原始英文路径仍作鼠标悬停 :title，不丢可追溯性。
const dirDisplay = computed<string>(() => {
    const dir = dirPath.value
    if (!dir) return ''
    const m = dir.match(/^(\.deepagents\/skills)\/([^/]+)(\/.*)?$/)
    if (!m) return dir
    const [, prefix, sName, rest = ''] = m
    return `${prefix}/${skillLabelOf(sName)}${rest}`
})
```

- [ ] **Step 2: 改组件 template 段**

把模板里 `<template v-else-if="dirPath"> · {{ dirPath }}</template>` 改为：

```vue
<template v-else-if="dirDisplay"> · {{ dirDisplay }}</template>
```

`:title="dirPath"` 保持不变（让鼠标悬停时看到真实英文路径）。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

期望：无错误。

- [ ] **Step 4: Commit**

```bash
git add app/components/ai/tools/ReadSkillFileTool.vue
git commit -m "$(cat <<'EOF'
feat(ui): ReadSkillFileTool 路径中的 skill 段显示中文名
EOF
)"
```

### 16.3 `WriteSkillFileTool.vue`

- [ ] **Step 1: 改组件 script 段**

`app/components/ai/tools/WriteSkillFileTool.vue` 的 `<script setup>`，在 `contentSize` computed 后追加（**与 16.2 完整重复**）：

```typescript
import { useSkillLabels } from '~/composables/useSkillLabels'
const { label: skillLabelOf } = useSkillLabels()

const dirDisplay = computed<string>(() => {
    const dir = dirPath.value
    if (!dir) return ''
    const m = dir.match(/^(\.deepagents\/skills)\/([^/]+)(\/.*)?$/)
    if (!m) return dir
    const [, prefix, sName, rest = ''] = m
    return `${prefix}/${skillLabelOf(sName)}${rest}`
})
```

- [ ] **Step 2: 改组件 template 段**

WriteSkillFileTool 当前副标题是 `写入技能文件 · 12.3 KB · 进行中…`（写入中）或 `写入技能文件 · 12.3 KB`（完成态）。把"完成态"的副标题加上中文目录路径——避免 dirDisplay 成为死代码。

把现有副标题段：

```vue
<p
    class="mt-0.5 truncate text-xs"
    :class="isWriting ? 'text-primary' : 'text-muted-foreground'"
    :title="dirPath"
>
    <span>写入技能文件</span>
    <template v-if="contentSize"> · {{ contentSize }}</template>
    <template v-if="isWriting"> · 进行中…</template>
</p>
```

改为：

```vue
<p
    class="mt-0.5 truncate text-xs"
    :class="isWriting ? 'text-primary' : 'text-muted-foreground'"
    :title="dirPath"
>
    <span>写入技能文件</span>
    <template v-if="contentSize"> · {{ contentSize }}</template>
    <template v-if="isWriting"> · 进行中…</template>
    <template v-else-if="dirDisplay"> · {{ dirDisplay }}</template>
</p>
```

**视觉规则**：写入中保留原文案（`12.3 KB · 进行中…`，让用户对耗时有反馈）；写入完成后展示中文路径（`12.3 KB · .deepagents/skills/证据辩护策略`）。

`:title="dirPath"` 保持不变（鼠标悬停仍看英文真实路径）。

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

期望：无错误。

- [ ] **Step 4: 手测三个工具卡片**

```bash
bun dev
```

进入任意带 skill 调用的对话（如案件分析中触发"运行技能脚本"工具）：
- RunSkillScriptTool 副标题应显示中文 skill 名
- ReadSkillFileTool 副标题路径里的 skill 段应是中文（鼠标悬停看到原始英文路径）
- WriteSkillFileTool 写入完成后副标题尾部显示中文目录路径

杀 dev server：

```bash
ps aux | grep 'nuxt dev' | grep -v grep | awk '{print $2}' | xargs -r kill -9
```

- [ ] **Step 5: Commit**

```bash
git add app/components/ai/tools/WriteSkillFileTool.vue
git commit -m "$(cat <<'EOF'
feat(ui): WriteSkillFileTool 写入完成后副标题显示中文目录路径
EOF
)"
```

---

## Task 17：补 `.deepagents/skills/*/SKILL.md` 的 `title:` 字段

**Files:**
- Modify: `.deepagents/skills/anjian-dashiji/SKILL.md`
- Modify: `.deepagents/skills/anjian-gaiyao/SKILL.md`
- Modify: `.deepagents/skills/anyou-xuanze/SKILL.md`
- Modify: `.deepagents/skills/docx/SKILL.md`
- Modify: `.deepagents/skills/evidence-defense/SKILL.md`
- Modify: `.deepagents/skills/kangbian-fenxi/SKILL.md`
- Modify: `.deepagents/skills/legal-document-writer/SKILL.md`
- Modify: `.deepagents/skills/litigation-visualization/SKILL.md`
- Modify: `.deepagents/skills/minimax-pdf/SKILL.md`
- Modify: `.deepagents/skills/minimax-xlsx/SKILL.md`
- Modify: `.deepagents/skills/panjue-qushi/SKILL.md`
- Modify: `.deepagents/skills/pptx/SKILL.md`
- Modify: `.deepagents/skills/qingqiuquan-jichu/SKILL.md`
- Modify: `.deepagents/skills/zhengju-celue/SKILL.md`

- [ ] **Step 1: 给每个 SKILL.md 的 frontmatter 第二行插入 title**

每个文件在 `name: <name>` 行下方插入 `title: <中文名>`。建议中文名（具体用词请用户最终拍板，下表是基于目录名直译的初稿）：

| 目录 | title 建议值 |
|---|---|
| anjian-dashiji | 案件大事记 |
| anjian-gaiyao | 案件概要 |
| anyou-xuanze | 案由选择 |
| docx | Word 文档处理 |
| evidence-defense | 证据辩护策略 |
| kangbian-fenxi | 抗辩分析 |
| legal-document-writer | 法律文书写作 |
| litigation-visualization | 诉讼可视化 |
| minimax-pdf | PDF 处理 |
| minimax-xlsx | Excel 处理 |
| panjue-qushi | 判决趋势分析 |
| pptx | PowerPoint 文档处理 |
| qingqiuquan-jichu | 请求权基础 |
| zhengju-celue | 证据策略 |

每个文件示例改动（以 anjian-dashiji 为例）：

改前：
```yaml
---
name: anjian-dashiji
description: |
  ...
---
```

改后：
```yaml
---
name: anjian-dashiji
title: 案件大事记
description: |
  ...
---
```

- [ ] **Step 2: 触发 resync 让数据库同步新的 title**

```bash
bun dev
```

打开 `http://localhost:3000/admin/skills` 点"重新扫描"按钮，等"扫描完成"。

期望：列表里"中文名"列应显示新的中文 title（仅对没设 customTitle 的 skill 生效；如已设 customTitle 仍显示后台覆盖值）。

杀 dev server。

- [ ] **Step 3: Commit**

```bash
git add .deepagents/skills/*/SKILL.md
git commit -m "$(cat <<'EOF'
feat(skills): 给 14 个 skill 的 SKILL.md frontmatter 补中文 title
EOF
)"
```

---

## Task 18：全量回归测试 + 收尾

- [ ] **Step 1: 跑全量测试**

```bash
bun run test
```

期望：全部 PASS。如有 fail：
- skills/ 目录相关的：参照 testing.md "并发污染测试调试指引"
- 非 skills 相关：检查是否本计划改动间接影响（不应该有）

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

期望：无错误。

- [ ] **Step 3: 覆盖率检查**

```bash
npx vitest run tests/server/agent-platform/skills/ tests/server/admin/skills/ tests/server/skills/ tests/client/composables/useSkillLabels.test.ts --coverage
```

期望：`server/services/agent-platform/skills/**` 行覆盖率 ≥ 90%（项目阈值）。新增 handler / composable 接近 95%。

- [ ] **Step 4: 手工冒烟**

```bash
bun dev
```

按以下顺序点一遍：
1. `/admin/skills` 列表显示中文名 + 编辑可保存 / 清空
2. `/admin/skills` 停用一个 skill → 点"重新扫描" → 仍保持停用（启用开关 fix 验收）
3. `/admin/nodes/<id>` 编辑节点的 Skills 选择器显示中文名 + 英文副标
4. 用户案件分析页发起一次会触发 skill 调用的对话，工具卡片显示中文名

杀 dev server。

- [ ] **Step 5: 不需要再 commit（前面任务都已 commit）**

---

## Self-Review 备忘

执行计划前以下检查项必须确认（已在 plan 设计期完成）：

- [x] 每个任务都有完整的代码（无 "TBD" / "类似 Task X" 占位）
- [x] 每个任务都有失败 / 通过测试 + 实现 + commit 五段
- [x] 类型 / 函数名跨任务一致：`updateSkillCustomTitleDAO` / `updateSkillCustomTitleService` / `listEnabledSkillLabelsDAO` / `listEnabledSkillLabelsService` / `useSkillLabels`
- [x] 数据库迁移走 `prisma migrate dev`，不改 seedData / 现有 migration（database.md 铁律）
- [x] 测试每个文件 afterEach 清理（testing.md 铁律）
- [x] commit 消息中文 + conventional commit（git.md）
- [x] 工具卡片改造保留 `_workspace` 等特殊别名
- [x] PATCH 接口走 RBAC 注册（Task 14）+ 注释一致性（Task 10）
- [x] 全量测试放最后（Task 18），中间任务只跑相关单测（CLAUDE.md "在执行大的计划时…避免频繁的全量测试"）
- [x] 阶段性收尾杀 dev server（feedback_kill_dev_on_finish 项目记忆）
