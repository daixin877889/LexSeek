# 合同审查 · 修订版回传识别 + 自定义署名 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让合同审查的「修订版 docx」回传后能识别每条 AI 修订被客户接受/拒绝/未处理，并让律师能自定义导出署名隐去 AI 痕迹。

**Architecture:** 导出端给修订标记写一份 customXml 身份证（`redlineRefs.xml`，含每条修订所在段落序号）；回传端新增解析器 + 双层判定纯函数（w:id 精确层 + 正文比对兜底层，比对限定在风险所属段落），叠加进现有 6 步上传链路；防误删保护从「批注命中率」升级为「批注+修订统一覆盖率」。署名是一个用户字段，导出时替换 AI 修订/批注的作者名。

**Tech Stack:** Nuxt 4 + Vue 3 + Prisma + PostgreSQL；docx 操作走项目自研 OOXML AST 层（fast-xml-parser + jszip）；测试 Vitest（worker 级 DB 隔离）。

**设计依据:** `docs/superpowers/specs/2026-05-16-contract-redline-roundtrip-and-signature-design.md`（spec 章节号在任务中以 §N 引用）。

---

## 设计取舍说明（实施前必读）

**`customXmlRegistrar` 仅供 redlineInjector 使用**：spec §5.3 提议 redlineRefs 与 annotationRefs 共用注册器。实施时不重构 `commentInjector` 的 `ensureContentTypesRegistered`/`ensureDocumentRelsRegistered`——它们稳定、有测试、且耦合处理 comments+annotationRefs，为边际 DRY 重构会牵动 `@deprecated injectComments` 与既有测试。新注册器消除 redlineInjector 的新增重复即可。此为技术取舍，不影响架构与功能。

---

## 文件结构

**新建：**
- `server/agents/contract/docx/customXmlRegistrar.ts` — 通用 customXml part 注册器（Content_Types + rels）。
- `server/agents/contract/docx/redlineParser.ts` — 解析 `redlineRefs.xml` + 存活 ins/del id + 按非空段落的正文语料；导出双层判定纯函数 `classifyRedlineDecision`、段落语料定位 `resolveCorpusForRef`、类型 `RedlineRefEntry` / `ParsedRedlineMarks`。
- `server/services/users/contractSignature.service.ts` — `resolveContractExportSignatureService`。
- 对应测试文件（见各任务）。

**修改：**
- `prisma/models/user.prisma`、`prisma/models/contractRiskAndAnnotation.prisma` — 各加 1 列。
- `shared/types/contract.ts` — `ClientRedlineDecision` 枚举 + `ContractRiskEntity` / `RiskDisplay` 加字段。
- `server/services/users/userResponse.service.ts`、`server/services/users/users.dao.ts`、`server/api/v1/users/me.get.ts`、`server/api/v1/users/profile.put.ts`、`app/store/user.ts`、`app/pages/dashboard/settings/profile.vue` — 署名设置端到端。
- `server/agents/contract/docx/redlineInjector.ts` — 加署名 author + 写 redlineRefs.xml（含 paraIdxs）。
- `server/agents/contract/docx/commentInjector.ts` — AI 批注用署名、去 `LS:` 前缀。
- `server/agents/contract/utils/wordCommentRef.ts` — 移除已无用的 `buildAuthorField`。
- `server/agents/contract/contractReviewRebuild.service.ts`、`server/agents/contract/contractReviewVersion.service.ts` — 取署名并透传。
- `server/agents/contract/uploadClientVersion.service.ts` — 接入修订识别、安全保护升级、报错文案。
- `app/components/assistant/contract/RiskListPanel.vue`、`app/components/assistant/contract/ContractReviewPanel.vue` — 客户处置徽章。
- `docs/tech-docs/backend/contract.md`、`docs/tech-docs/backend/auth-users-sms.md` — 文档同步。

> 合同源码物理位于 `server/agents/contract/`；部分调用方经 `server/services/assistant/contract/` re-export shim 引用。新文件用相对 import，对外引用沿用 shim 路径。

---

## Task 1: 数据库迁移

**Files:**
- Modify: `prisma/models/user.prisma`
- Modify: `prisma/models/contractRiskAndAnnotation.prisma`

- [ ] **Step 1: 给 `users` 模型加字段**

`prisma/models/user.prisma`，在 `profile String?` 行之后加：

```prisma
  /// 合同审查导出署名：导出修订/批注 docx 时 AI 修订与 AI 批注的作者名。为空时回退 users.name。
  contractExportSignature String?   @map("contract_export_signature") @db.VarChar(50)
```

- [ ] **Step 2: 给 `contractRisks` 模型加字段**

`prisma/models/contractRiskAndAnnotation.prisma`，在 `orphaned Boolean @default(false) @map("orphaned")` 行之后加：

```prisma
  /// 客户对该风险对应 AI 修订的处置（独立于律师 archivedStatus）：
  /// accepted / rejected / untouched / ambiguous；null = 未以修订形式导出过 / 不适用。
  clientRedlineDecision String?  @map("client_redline_decision") @db.VarChar(12)
```

- [ ] **Step 3: 生成并应用迁移**

Run: `bun run prisma:migrate --name add_redline_decision_and_export_signature`
Expected: 在 `prisma/migrations/<timestamp>_add_redline_decision_and_export_signature/` 生成 `migration.sql`（含两条 `ALTER TABLE ... ADD COLUMN`），自动应用到 dev 库，并重新生成 `generated/prisma/` client。

- [ ] **Step 4: 验证**

Run: `bun run typecheck`
Expected: PASS（此时尚无字段使用方，仅确认 client 重新生成无误）。同时确认 `prisma/migrations/` 下新目录已生成。

- [ ] **Step 5: Commit**

```bash
git add prisma/models/user.prisma prisma/models/contractRiskAndAnnotation.prisma prisma/migrations generated/prisma
git commit -m "feat(db): 新增导出署名与客户修订处置字段"
```

---

## Task 2: 修订处置类型同步（shared）

**Files:**
- Modify: `shared/types/contract.ts`

- [ ] **Step 1: 新增 `ClientRedlineDecision` 枚举与标签**

`shared/types/contract.ts`，在 `RISK_ARCHIVED_STATUSES` / `RiskArchivedStatus` 定义之后加：

```typescript
/** 客户对 AI 修订的处置维度（与律师处置状态 archivedStatus 相互独立） */
export enum ClientRedlineDecision {
    ACCEPTED = 'accepted',
    REJECTED = 'rejected',
    UNTOUCHED = 'untouched',
    AMBIGUOUS = 'ambiguous',
}

export const ClientRedlineDecisionText: Record<ClientRedlineDecision, string> = {
    [ClientRedlineDecision.ACCEPTED]: '客户已采纳',
    [ClientRedlineDecision.REJECTED]: '客户已拒绝',
    [ClientRedlineDecision.UNTOUCHED]: '客户未处理',
    [ClientRedlineDecision.AMBIGUOUS]: '待确认',
}
```

- [ ] **Step 2: `ContractRiskEntity` 加字段**

`shared/types/contract.ts` 的 `ContractRiskEntity` 接口，在 `orphaned: boolean` 之后加：

```typescript
    /** 客户对该风险对应 AI 修订的处置；null = 未以修订形式导出过 */
    clientRedlineDecision: ClientRedlineDecision | null
```

- [ ] **Step 3: `RiskDisplay` 加字段**

`shared/types/contract.ts` 的 `RiskDisplay` 类型，在 `archivedStatus?: RiskArchivedStatus | null` 之后加：

```typescript
    clientRedlineDecision?: ClientRedlineDecision | null
```

- [ ] **Step 4: 验证**

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add shared/types/contract.ts
git commit -m "feat(contract): 新增 ClientRedlineDecision 类型"
```

---

## Task 3: 导出署名读取 service

**Files:**
- Modify: `server/services/users/users.dao.ts`
- Create: `server/services/users/contractSignature.service.ts`
- Test: `tests/server/users/contractSignature.service.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/users/contractSignature.service.test.ts`（目录不存在则一并创建）。测试用例创建 users 后必须清理（testing.md 铁律），手机号带 timestamp 防并发碰撞：

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { resolveContractExportSignatureService } from '~~/server/services/users/contractSignature.service'

const createdIds: number[] = []

async function createUser(name: string, signature: string | null) {
    const phone = `139${String(Date.now()).slice(-8)}${createdIds.length}`.slice(0, 11)
    const u = await prisma.users.create({
        data: { name, phone, contractExportSignature: signature },
    })
    createdIds.push(u.id)
    return u
}

afterEach(async () => {
    if (createdIds.length) {
        await prisma.users.deleteMany({ where: { id: { in: createdIds } } })
        createdIds.length = 0
    }
})

describe('resolveContractExportSignatureService', () => {
    it('设置了署名时返回署名', async () => {
        const u = await createUser('张三', '张三律师')
        expect(await resolveContractExportSignatureService(u.id)).toBe('张三律师')
    })

    it('署名为空白时回退账号姓名', async () => {
        const u = await createUser('李四', '   ')
        expect(await resolveContractExportSignatureService(u.id)).toBe('李四')
    })

    it('未设置署名时回退账号姓名', async () => {
        const u = await createUser('王五', null)
        expect(await resolveContractExportSignatureService(u.id)).toBe('王五')
    })

    it('用户不存在时返回安全默认值', async () => {
        expect(await resolveContractExportSignatureService(999999999)).toBe('审查人')
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/server/users/contractSignature.service.test.ts --reporter=verbose`
Expected: FAIL（`resolveContractExportSignatureService` / 模块不存在）。

- [ ] **Step 3: 加 DAO 方法**

`server/services/users/users.dao.ts` 末尾加：

```typescript
/**
 * 读取用户合同导出署名所需字段（name + contractExportSignature）。
 * 仅 select 必要列，不带角色 include。
 */
export const findUserExportSignatureDao = async (
    id: number,
): Promise<{ name: string; contractExportSignature: string | null } | null> => {
    return prisma.users.findFirst({
        where: { id, deletedAt: null },
        select: { name: true, contractExportSignature: true },
    })
}
```

- [ ] **Step 4: 写 service 实现**

新建 `server/services/users/contractSignature.service.ts`：

```typescript
/**
 * 合同导出署名解析。
 *
 * 导出修订/批注 docx 时，AI 修订标记与 AI 批注的作者名用律师设置的署名；
 * 未设置则回退账号姓名（spec §4.1）。
 */
import { findUserExportSignatureDao } from './users.dao'

/**
 * 解析用户的合同导出署名。
 * 优先 contractExportSignature；为空/空白回退 name；用户不存在回退安全默认值，
 * 保证导出流程不因取不到署名而中断。
 */
export async function resolveContractExportSignatureService(userId: number): Promise<string> {
    const row = await findUserExportSignatureDao(userId)
    const signature = (row?.contractExportSignature ?? '').trim()
    if (signature) return signature
    return (row?.name ?? '').trim() || '审查人'
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run tests/server/users/contractSignature.service.test.ts --reporter=verbose`
Expected: PASS（4 个用例）。

- [ ] **Step 6: Commit**

```bash
git add server/services/users/users.dao.ts server/services/users/contractSignature.service.ts tests/server/users/contractSignature.service.test.ts
git commit -m "feat(contract): 新增导出署名解析 service"
```

---

## Task 4: 署名设置端到端（API + 设置页）

**Files:**
- Modify: `server/services/users/userResponse.service.ts`
- Modify: `server/api/v1/users/me.get.ts`
- Modify: `server/api/v1/users/profile.put.ts`
- Modify: `app/store/user.ts`
- Modify: `app/pages/dashboard/settings/profile.vue`
- Test: `tests/server/users/profile.put.test.ts`

- [ ] **Step 1: 写失败测试（profile.put 写入/校验署名）**

新建 `tests/server/users/profile.put.test.ts`，用 Nuxt 测试工具向 `PUT /api/v1/users/profile` 发请求（参照 `tests/server/` 下现有 handler 集成测试的鉴权 + `$fetch`/`event` 构造方式）。核心断言：

```typescript
// 已登录用户 PUT { name, contractExportSignature: '王明远律师' }
// → 响应 SafeUserInfo.contractExportSignature === '王明远律师'
// → DB users 行 contract_export_signature 已写入
// 边界：contractExportSignature 超 50 字 → 400
// 边界：不传 contractExportSignature → 不报错、原值不变
```

> 若 `tests/server/users/` 下已有 profile/users handler 测试文件，则把上述用例追加进去、复用其鉴权 fixture，而非新建文件。测试创建的 user 必须 `afterEach` 清理。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/server/users/profile.put.test.ts --reporter=verbose`
Expected: FAIL（zod 不认 `contractExportSignature` / 响应无该字段）。

- [ ] **Step 3: `SafeUserInfo` 加字段**

`server/services/users/userResponse.service.ts` 的 `SafeUserInfo` 接口，在 `inviteCode: string | null` 之后加：

```typescript
    /** 合同导出署名 */
    contractExportSignature: string | null
```

`formatUserResponseService` 返回对象，在 `inviteCode: user.inviteCode,` 之后加：

```typescript
        contractExportSignature: user.contractExportSignature,
```

- [ ] **Step 4: `me.get.ts` 返回新字段**

`server/api/v1/users/me.get.ts` 的 `resSuccess` 响应对象，在 `inviteCode: userInfo.inviteCode,` 之后加：

```typescript
            contractExportSignature: userInfo.contractExportSignature,
```

- [ ] **Step 5: `profile.put.ts` 接受并写入新字段**

`server/api/v1/users/profile.put.ts`：

zod schema 加一行：
```typescript
      contractExportSignature: z.string().max(50, "署名长度不能超过50个字符").optional(),
```
解构加 `contractExportSignature`：
```typescript
    const { name, company, profile, contractExportSignature } = body;
```
`updateUserProfileDao` 调用的 data 对象加一行（`updateUserProfileDao` 入参为泛型 `Prisma.usersUpdateInput`，无需改 DAO）：
```typescript
      contractExportSignature: contractExportSignature ?? undefined,
```

- [ ] **Step 6: 前端 store 同步新字段**

`app/store/user.ts`：

`reactive<SafeUserInfo>({...})` 初始对象，在 `inviteCode: "",` 之后加：
```typescript
    contractExportSignature: null,
```
`clearUserInfo` 的重置对象，在 `inviteCode: "",` 之后加同样一行。
`updateUserProfile` 的入参类型改为：
```typescript
  const updateUserProfile = async (data: { name: string, company: string, profile: string, contractExportSignature?: string }) => {
```

- [ ] **Step 7: 设置页加输入框**

`app/pages/dashboard/settings/profile.vue`：

模板里「个人简介」`<div>` 之后、提交按钮 `<div class="flex justify-end">` 之前，加一段：

```html
      <div>
        <label for="exportSignature" class="block text-sm font-medium mb-1">合同导出署名</label>
        <Input id="exportSignature" v-model="userForm.contractExportSignature" type="text" maxlength="50" placeholder="导出合同审查 docx 时 AI 修订与批注以此署名显示；留空则使用姓名" class="w-full px-3 py-2 h-[42px] text-base border rounded-md bg-background" />
      </div>
```

`userForm` computed 的 `get` 加一行、`set` 加一行：
```javascript
    // get 内：
    contractExportSignature: userStore.userInfo?.contractExportSignature || "",
    // set 内（if 块里）：
    userStore.userInfo.contractExportSignature = value.contractExportSignature;
```

`saveProfile` 的 `updateUserProfile` 调用加参数：
```javascript
    const success = await userStore.updateUserProfile({
      name: userForm.value.name,
      phone: userForm.value.phone,
      company: userForm.value.company,
      profile: userForm.value.profile,
      contractExportSignature: userForm.value.contractExportSignature,
    });
```

- [ ] **Step 8: 运行测试 + 验证**

Run: `npx vitest run tests/server/users/profile.put.test.ts --reporter=verbose`
Expected: PASS。

Run: `bun run typecheck`
Expected: PASS。

启动 `bun dev`，登录后到「设置 → 个人资料」，填写「合同导出署名」并保存 → 刷新页面，确认值保留。

- [ ] **Step 9: Commit**

```bash
git add server/services/users/userResponse.service.ts server/api/v1/users/me.get.ts server/api/v1/users/profile.put.ts app/store/user.ts app/pages/dashboard/settings/profile.vue tests/server/users/profile.put.test.ts
git commit -m "feat(contract): 用户设置页支持合同导出署名"
```

---

## Task 5: 导出端应用署名 + 去 LS: 前缀

**Files:**
- Modify: `server/agents/contract/docx/redlineInjector.ts`
- Modify: `server/agents/contract/docx/commentInjector.ts`
- Modify: `server/agents/contract/utils/wordCommentRef.ts`
- Modify: `server/agents/contract/contractReviewRebuild.service.ts`
- Modify: `server/agents/contract/contractReviewVersion.service.ts`
- Modify: `tests/server/agents/contract/wordCommentRef.test.ts`（移除 buildAuthorField 测试）
- Test: `tests/server/assistant/contract/docx/commentInjector.annotations.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试（AI 批注用署名、律师批注去 LS:）**

在 `tests/server/assistant/contract/docx/commentInjector.annotations.test.ts` 追加用例。**复用该文件已有的 fixture**（基底 docx 通过 `readFile(SAMPLE)` 取、批注用文件内的 `makeAnnotation`、读 zip 文本用 `readTextFromZip`+`loadDocxZip`、reviewId 用文件现有字面量），构造「1 条 ai + 1 条 lawyer(authorName='陈律师')」批注，断言：

```typescript
// const result = await injectAnnotations(<基底Buf>, <[ai, lawyer]批注>, <reviewId>, { signature: '王明远' })
// const commentsXml = await readTextFromZip(await loadDocxZip(result.buffer), 'word/comments.xml')
expect(commentsXml).toContain('w:author="王明远"')   // AI 批注用署名
expect(commentsXml).toContain('w:author="陈律师"')    // 律师批注去前缀
expect(commentsXml).not.toContain('LS:')              // 全文无 LS: 前缀
```

Run: `npx vitest run tests/server/assistant/contract/docx/commentInjector.annotations.test.ts --reporter=verbose`
Expected: FAIL（`signature` 选项未识别，作者名仍带 `LS:`）。

- [ ] **Step 2: `commentInjector` 支持署名、去 LS: 前缀**

`server/agents/contract/docx/commentInjector.ts`：

(a) `InjectAnnotationsOptions` 接口加：
```typescript
    /** AI 批注的作者署名（spec §4.3）；不传时回退 'AI' */
    signature?: string
```

(b) `initialsFor` 改为接受署名：
```typescript
/** 批注头像缩写：AI 用署名前 2 字，律师/客户用角色字 */
function initialsFor(authorType: AnnotationAuthorType, signature: string): string {
    switch (authorType) {
        case 'ai': return signature.slice(0, 2) || 'AI'
        case 'lawyer': return '律'
        case 'external': return '客'
        default: return 'LS'
    }
}
```

(c) `buildCommentsXmlFromAnnotations` —— 加 `signature` 形参、**删除不再使用的 `refs` 形参**（原 `refs` 仅供 `buildAuthorField`），作者名按 authorType 计算、不再加 `LS:`：
```typescript
function buildCommentsXmlFromAnnotations(
    annotations: ContractAnnotationForExport[],
    wordIds: Map<number, number>,
    reviewId: number,
    signature: string,
): string {
    const fallbackNow = new Date().toISOString()
    const children = annotations.map(a => {
        const wId = wordIds.get(a.id)!
        // spec §4.3：作者名一律去 LS: 前缀；AI 内容用署名，律师/客户用各自姓名
        const author = a.authorType === 'ai' ? signature : a.authorName
        const initials = initialsFor(a.authorType, signature)
        const dateIso = a.createdAt ? a.createdAt.toISOString() : fallbackNow
        const attrs: Record<string, string> = {
            'w:id': String(wId),
            'w:author': author,
            'w:initials': initials,
            'w:date': dateIso,
        }
        if (a.parentAnnotationId !== null && wordIds.has(a.parentAnnotationId)) {
            attrs['w:parentId'] = String(wordIds.get(a.parentAnnotationId))
        }
        const body: NodeArray = [
            makeElement('w:p', {}, [
                makeElement('w:r', {}, [
                    makeElement('w:t', { 'xml:space': 'preserve' }, [makeText(a.content)]),
                ]),
            ]),
        ]
        return makeElement('w:comment', attrs, body)
    })
    const ast: NodeArray = [
        makeXmlDecl(),
        makeElement('w:comments', { 'xmlns:w': W_NS }, children),
    ]
    return stringifyOoxml(ast)
}
```

(d) `injectAnnotations` 内：解析 `const signature = opts?.signature?.trim() || 'AI'`，调用 `buildCommentsXmlFromAnnotations` 时去掉 `refsByAnnotationId` 实参、加 `signature`：
```typescript
    writeTextToZip(zip, 'word/comments.xml',
        buildCommentsXmlFromAnnotations(annotations, wordIdByAnnotationId, reviewId, signature),
    )
```

(e) 删除 `buildAuthorField` 的 import（`import { generateWordCommentRef, buildAuthorField }` → `import { generateWordCommentRef }`）。

- [ ] **Step 3: 移除无用的 `buildAuthorField` 及其测试**

`buildAuthorField` 去前缀后已无调用方。`server/agents/contract/utils/wordCommentRef.ts`：删除 `buildAuthorField` 函数（含其 JSDoc 注释块）。

**同步移除其测试**——`tests/server/agents/contract/wordCommentRef.test.ts` 仍 import `buildAuthorField` 并有 `describe('buildAuthorField', ...)` 块（约 import 行 + 该 describe 块）。删除该 import 与整个 `describe('buildAuthorField', ...)` 块，否则该测试文件因引用不存在的导出而无法编译。

Run: `grep -rn "buildAuthorField" server/ tests/`
Expected: 删除后无任何输出（函数与测试均已移除）。

- [ ] **Step 4: `redlineInjector` 支持署名**

`server/agents/contract/docx/redlineInjector.ts`：

(a) `injectRedlineMarks` 的 `options` 形参类型加**可选** `signature`：
```typescript
    options: { reviewId: number, idStart: number, signature?: string },
```
函数体开头解析作者名（不传时回退中性默认；编排函数总会显式传入真实署名）：
```typescript
    const redlineAuthor = options.signature?.trim() || '审查人'
```

(b) `applyRedlineToParagraph` 的 input 对象加 `author: string` 字段；其内部两处 `makeElement('w:del', { ..., 'w:author': REDLINE_AUTHOR, ... })` 把 `REDLINE_AUTHOR` 换成 `input.author`。`buildInsertNode` 的 input 对象同样加 `author: string`，其 `makeElement('w:ins', { ..., 'w:author': REDLINE_AUTHOR, ... })` 换成 `input.author`；`applyRedlineToParagraph` 内两处 `buildInsertNode({ ... })` 调用补传 `author: input.author`。

(c) `injectRedlineMarks` 主循环里两处 `applyRedlineToParagraph({ ... })` 调用加 `author: redlineAuthor`。

(d) `REDLINE_AUTHOR` 常量已无引用，删除（grep 确认）。

- [ ] **Step 5: 两个导出编排函数取署名并透传**

`server/agents/contract/contractReviewRebuild.service.ts`：
- 顶部 import：`import { resolveContractExportSignatureService } from '~~/server/services/users/contractSignature.service'`
- `rebuildDocxService` 内、`if (mode === 'comment')` 之前，加 `const signature = await resolveContractExportSignatureService(review.userId)`
- 所有 `injectAnnotations(...)` 调用：opts 加 `signature`（无 opts 的 `injectAnnotations(origBuffer, annotations, review.id)` → `injectAnnotations(origBuffer, annotations, review.id, { signature })`；已有 opts 的合并进去）。
- 所有 `injectRedlineMarks(...)` 调用：options 加 `signature`。

`server/agents/contract/contractReviewVersion.service.ts` 的 `downloadContractReviewVersionService`：同样在注入前 `const signature = await resolveContractExportSignatureService(review.userId)`，所有 `injectAnnotations` / `injectRedlineMarks` 调用透传 `signature`。

- [ ] **Step 6: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/commentInjector.annotations.test.ts tests/server/assistant/contract/docx/commentInjector.test.ts tests/server/assistant/contract/docx/redlineInjector.test.ts tests/server/agents/contract/wordCommentRef.test.ts --reporter=verbose`
Expected: PASS。`signature` 可选，既有调用不传不会编译失败；既有用例若因作者名变化断言失败，按新预期更新：批注作者去 `LS:` 前缀（`LS:AI`→署名或回退 `AI`、`LS:{律师名}`→律师名）；修订标记 `w:author` 由 `LexSeek AI` 改为署名（未传 `signature` 的既有用例回退值为 `审查人`）。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add server/agents/contract/docx/redlineInjector.ts server/agents/contract/docx/commentInjector.ts server/agents/contract/utils/wordCommentRef.ts server/agents/contract/contractReviewRebuild.service.ts server/agents/contract/contractReviewVersion.service.ts tests/server/assistant/contract/docx/commentInjector.annotations.test.ts tests/server/agents/contract/wordCommentRef.test.ts
git commit -m "feat(contract): 导出端应用自定义署名并去除 LS: 前缀"
```

---

## Task 6: customXml part 通用注册器

**Files:**
- Create: `server/agents/contract/docx/customXmlRegistrar.ts`
- Test: `tests/server/assistant/contract/docx/customXmlRegistrar.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/docx/customXmlRegistrar.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { registerCustomXmlPart } from '~~/server/agents/contract/docx/customXmlRegistrar'
import { readTextFromZip } from '~~/server/agents/contract/docx/zipRewriter'

function minimalZip(): JSZip {
    const zip = new JSZip()
    zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="xml" ContentType="application/xml"/></Types>')
    zip.file('word/_rels/document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
    return zip
}

const PART = { partPath: 'word/customXml/redlineRefs.xml', relId: 'rIdLexseekRedlineRefs' }

describe('registerCustomXmlPart', () => {
    it('注册 Override 与 Relationship', async () => {
        const zip = minimalZip()
        await registerCustomXmlPart(zip, PART)
        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(ct).toContain('PartName="/word/customXml/redlineRefs.xml"')
        expect(rels).toContain('Target="customXml/redlineRefs.xml"')
        expect(rels).toContain('Id="rIdLexseekRedlineRefs"')
    })

    it('幂等：重复注册不产生重复条目', async () => {
        const zip = minimalZip()
        await registerCustomXmlPart(zip, PART)
        await registerCustomXmlPart(zip, PART)
        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(ct.match(/PartName="\/word\/customXml\/redlineRefs\.xml"/g)).toHaveLength(1)
        expect(rels.match(/Id="rIdLexseekRedlineRefs"/g)).toHaveLength(1)
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/server/assistant/contract/docx/customXmlRegistrar.test.ts --reporter=verbose`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现注册器**

新建 `server/agents/contract/docx/customXmlRegistrar.ts`：

```typescript
/**
 * customXml part 通用注册器。
 *
 * 把一个 customXml part 幂等注册到 [Content_Types].xml（Override）+
 * word/_rels/document.xml.rels（Relationship）。供 redlineInjector 注册
 * redlineRefs.xml；commentInjector 的 annotationRefs 注册沿用其自有实现。
 */
import { parseOoxml, stringifyOoxml, findFirst, findAll, getAttr, makeLeaf, type NodeArray } from './xmlAst'
import { readTextFromZip, writeTextToZip, type DocxZip } from './zipRewriter'

const CUSTOMXML_CONTENT_TYPE = 'application/xml'
const REL_CUSTOMXML = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml'

export interface CustomXmlPart {
    /** zip 内路径，如 'word/customXml/redlineRefs.xml' */
    partPath: string
    /** document.xml.rels 里的 Relationship Id（需全文件唯一），如 'rIdLexseekRedlineRefs' */
    relId: string
}

/**
 * 幂等注册一个 customXml part。
 * 已存在同名 Override / 同 Target 的 Relationship 时跳过，不重复追加。
 */
export async function registerCustomXmlPart(zip: DocxZip, part: CustomXmlPart): Promise<void> {
    const partName = '/' + part.partPath
    const relTarget = part.partPath.replace(/^word\//, '')

    // [Content_Types].xml — 追加 Override
    const ctAst = parseOoxml(await readTextFromZip(zip, '[Content_Types].xml'))
    const types = findFirst(ctAst, 'Types')
    if (types) {
        const exists = findAll(ctAst, 'Override').some(n => getAttr(n, 'PartName') === partName)
        if (!exists) {
            (types['Types'] as NodeArray).push(
                makeLeaf('Override', { PartName: partName, ContentType: CUSTOMXML_CONTENT_TYPE }),
            )
            writeTextToZip(zip, '[Content_Types].xml', stringifyOoxml(ctAst))
        }
    }

    // word/_rels/document.xml.rels — 追加 Relationship
    const relsAst = parseOoxml(await readTextFromZip(zip, 'word/_rels/document.xml.rels'))
    const rels = findFirst(relsAst, 'Relationships')
    if (rels) {
        const exists = findAll(relsAst, 'Relationship').some(n => getAttr(n, 'Target') === relTarget)
        if (!exists) {
            (rels['Relationships'] as NodeArray).push(
                makeLeaf('Relationship', { Id: part.relId, Type: REL_CUSTOMXML, Target: relTarget }),
            )
            writeTextToZip(zip, 'word/_rels/document.xml.rels', stringifyOoxml(relsAst))
        }
    }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/customXmlRegistrar.test.ts --reporter=verbose`
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add server/agents/contract/docx/customXmlRegistrar.ts tests/server/assistant/contract/docx/customXmlRegistrar.test.ts
git commit -m "feat(contract): 新增 customXml part 通用注册器"
```

---

## Task 7: 修订身份证导出（redlineRefs.xml）

**Files:**
- Modify: `server/agents/contract/docx/redlineInjector.ts`
- Test: `tests/server/assistant/contract/docx/redlineInjector.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `tests/server/assistant/contract/docx/redlineInjector.test.ts` 追加用例。**复用该文件已有的 fixture**（基底 docx 用 `SAMPLE` + `buildFixtureBuffer`、风险用 `makeRisk` 一类）构造若干 redline 风险，断言：

```typescript
// const result = await injectRedlineMarks(<基底Buf>, <risks>, { reviewId: 871, idStart: 100, signature: '王明远' })
// const zip = await loadDocxZip(result.buffer)
const refsXml = await readTextFromZip(zip, 'word/customXml/redlineRefs.xml')
expect(refsXml).toContain('reviewId="871"')
for (const riskId of result.spansByRiskId.keys()) {
    expect(refsXml).toContain(`riskId="${riskId}"`)
}
expect(refsXml).toMatch(/paraIdxs="\d/)   // 每条 ref 带段落序号
const ct = await readTextFromZip(zip, '[Content_Types].xml')
expect(ct).toContain('PartName="/word/customXml/redlineRefs.xml"')
```

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts --reporter=verbose`
Expected: FAIL（`zip 中不存在 word/customXml/redlineRefs.xml`）。

- [ ] **Step 2: 实现 redlineRefs.xml 写入**

`server/agents/contract/docx/redlineInjector.ts`：

(a) import 加（合并进现有 xmlAst import）：
```typescript
import { makeLeaf, makeXmlDecl } from './xmlAst'
import { registerCustomXmlPart } from './customXmlRegistrar'
```

(b) 文件顶部常量区加：
```typescript
const REDLINE_REFS_PATH = 'word/customXml/redlineRefs.xml'
```

(c) 加构造函数（`paraIdxs` 来自 `paragraphSpans[].paraIdx`，spec §5.1）：
```typescript
/** 用 spansByRiskId 构造 redlineRefs.xml 身份证（spec §5.1） */
function buildRedlineRefsXml(reviewId: number, spansByRiskId: Map<number, RedlineWrapTarget>): string {
    const children: NodeArray = []
    for (const [riskId, target] of spansByRiskId) {
        const delIds = target.paragraphSpans.map(s => s.delId)
        const insId = target.paragraphSpans.find(s => s.insId !== null)?.insId
        const paraIdxs = target.paragraphSpans.map(s => s.paraIdx)
        if (insId == null || delIds.length === 0) continue
        children.push(makeLeaf('ref', {
            riskId: String(riskId),
            delIds: delIds.join(','),
            insId: String(insId),
            paraIdxs: paraIdxs.join(','),
        }))
    }
    return stringifyOoxml([
        makeXmlDecl(),
        makeElement('lexseekRedlineRefs', {
            xmlns: 'urn:lexseek:contract-review-redline:v1',
            reviewId: String(reviewId),
        }, children),
    ])
}
```

(d) `injectRedlineMarks` 里，`writeTextToZip(zip, 'word/document.xml', stringifyOoxml(documentAst))` 之后、`return { buffer: await zipToBuffer(zip), ... }` 之前，插入：
```typescript
    // 写修订身份证 customXml（供回传识别，spec §5）
    if (spansByRiskId.size > 0) {
        writeTextToZip(zip, REDLINE_REFS_PATH, buildRedlineRefsXml(options.reviewId, spansByRiskId))
        await registerCustomXmlPart(zip, { partPath: REDLINE_REFS_PATH, relId: 'rIdLexseekRedlineRefs' })
    }
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineInjector.test.ts --reporter=verbose`
Expected: PASS。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/docx/redlineInjector.ts tests/server/assistant/contract/docx/redlineInjector.test.ts
git commit -m "feat(contract): 修订标记导出 redlineRefs.xml 身份证"
```

---

## Task 8: 修订处置判定纯函数 classifyRedlineDecision

**Files:**
- Create: `server/agents/contract/docx/redlineParser.ts`（本任务先建文件 + 类型 + 判定函数；Task 9 补解析函数与段落语料）
- Test: `tests/server/assistant/contract/docx/redlineParser.classify.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/docx/redlineParser.classify.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { classifyRedlineDecision, type RedlineRefEntry } from '~~/server/agents/contract/docx/redlineParser'
import { ClientRedlineDecision } from '#shared/types/contract'

const ref: RedlineRefEntry = { riskId: 1, delIds: [10], insId: 11, paraIdxs: [3] }

function run(opts: {
    surviveDel?: number[]; surviveIns?: number[]
    corpusT?: string; corpusDel?: string
    old: string; neu: string
}) {
    return classifyRedlineDecision({
        ref,
        survivingDelIds: new Set(opts.surviveDel ?? []),
        survivingInsIds: new Set(opts.surviveIns ?? []),
        corpusT: opts.corpusT ?? '',
        corpusDel: opts.corpusDel ?? '',
        problematicQuote: opts.old,
        suggestedClauseText: opts.neu,
    })
}

describe('classifyRedlineDecision', () => {
    it('Layer 1：del+ins 都存活 → 未处理', () => {
        expect(run({ surviveDel: [10], surviveIns: [11], old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.UNTOUCHED)
    })
    it('Layer 1：部分存活（仅 del）→ 需确认', () => {
        expect(run({ surviveDel: [10], old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.AMBIGUOUS)
    })
    it('Layer 2：corpusDel 含原文 → 未处理（w:id 被重排）', () => {
        expect(run({ corpusDel: '甲方负全责', corpusT: '双方按约担责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.UNTOUCHED)
    })
    it('互不包含 · 全接受 → 接受', () => {
        expect(run({ corpusT: '双方按约担责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('互不包含 · 全拒绝 → 拒绝', () => {
        expect(run({ corpusT: '甲方负全责', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.REJECTED)
    })
    it('new 含 old（扩写）· 全接受 → 接受', () => {
        expect(run({ corpusT: '违约责任及违约金20%', old: '违约责任', neu: '违约责任及违约金20%' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('new 含 old（扩写）· 全拒绝 → 拒绝', () => {
        expect(run({ corpusT: '违约责任', old: '违约责任', neu: '违约责任及违约金20%' }))
            .toBe(ClientRedlineDecision.REJECTED)
    })
    it('old 含 new（删减）· 全接受 → 接受', () => {
        expect(run({ corpusT: '违约责任', old: '违约责任及违约金20%', neu: '违约责任' }))
            .toBe(ClientRedlineDecision.ACCEPTED)
    })
    it('old 含 new（删减）· 全拒绝 → 拒绝', () => {
        expect(run({ corpusT: '违约责任及违约金20%', old: '违约责任及违约金20%', neu: '违约责任' }))
            .toBe(ClientRedlineDecision.REJECTED)
    })
    it('正文都找不到 → 需确认', () => {
        expect(run({ corpusT: '完全无关的文字', old: '甲方负全责', neu: '双方按约担责' }))
            .toBe(ClientRedlineDecision.AMBIGUOUS)
    })
})
```

Run: `npx vitest run tests/server/assistant/contract/docx/redlineParser.classify.test.ts --reporter=verbose`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现类型与判定函数**

新建 `server/agents/contract/docx/redlineParser.ts`（Task 9 将向同文件追加解析函数与段落语料）：

```typescript
/**
 * 修订标记回传解析与处置判定（spec §6）。
 *
 * - parseRedlineMarks（Task 9）：从回传 docx 读 redlineRefs.xml + 存活 ins/del id + 按非空段落的正文语料。
 * - resolveCorpusForRef（Task 9）：按 redlineRefs 的 paraIdxs 取该风险所属段落的语料。
 * - classifyRedlineDecision：双层算法判定单条修订被客户接受/拒绝/未处理/需确认。
 */
import { normalizeForMatch } from '../utils/textSimilarity'
import { ClientRedlineDecision } from '#shared/types/contract'

/** redlineRefs.xml 里一条 <ref> 的解析结果 */
export interface RedlineRefEntry {
    riskId: number
    delIds: number[]
    insId: number
    /** 该修订所跨非空段落序号（回传识别据此把比对限定在风险所属段落，spec §6.2） */
    paraIdxs: number[]
}

export interface ClassifyRedlineInput {
    ref: RedlineRefEntry
    /** 回传 docx 仍存活的 <w:ins> w:id */
    survivingInsIds: Set<number>
    /** 回传 docx 仍存活的 <w:del> w:id */
    survivingDelIds: Set<number>
    /** 该风险所属段落的 <w:t> 语料，已 normalizeForMatch 归一化（见 resolveCorpusForRef） */
    corpusT: string
    /** 该风险所属段落的 <w:delText> 语料，已 normalizeForMatch 归一化 */
    corpusDel: string
    /** 风险 DB 字段（原始值，函数内部归一化） */
    problematicQuote: string
    suggestedClauseText: string
}

/**
 * 双层判定（spec §6.2）。
 * Layer 1（w:id）：全部存活→未处理；部分存活→需确认；全不存活→转 Layer 2。
 * Layer 2（正文）：corpusDel 含原文→未处理；否则按 old/new 子串包含关系选判别字段定接受/拒绝。
 */
export function classifyRedlineDecision(input: ClassifyRedlineInput): ClientRedlineDecision {
    const { ref, survivingInsIds, survivingDelIds, corpusT, corpusDel } = input
    const oldText = normalizeForMatch(input.problematicQuote)
    const newText = normalizeForMatch(input.suggestedClauseText)
    // 防御：redlineRefs 风险理论上 old/new 必非空且不等
    if (!oldText || !newText || oldText === newText) return ClientRedlineDecision.AMBIGUOUS

    // ===== Layer 1：w:id 精确层 =====
    const delAllAlive = ref.delIds.length > 0 && ref.delIds.every(id => survivingDelIds.has(id))
    const delNoneAlive = ref.delIds.every(id => !survivingDelIds.has(id))
    const insAlive = survivingInsIds.has(ref.insId)
    if (delAllAlive && insAlive) return ClientRedlineDecision.UNTOUCHED
    if (!(delNoneAlive && !insAlive)) return ClientRedlineDecision.AMBIGUOUS // 部分存活

    // ===== Layer 2：正文比对层 =====
    if (corpusDel.includes(oldText)) return ClientRedlineDecision.UNTOUCHED

    const newInT = corpusT.includes(newText)
    const oldInT = corpusT.includes(oldText)

    if (newText.includes(oldText)) {
        // new 含 old（扩写）
        if (newInT) return ClientRedlineDecision.ACCEPTED
        if (oldInT) return ClientRedlineDecision.REJECTED
        return ClientRedlineDecision.AMBIGUOUS
    }
    if (oldText.includes(newText)) {
        // old 含 new（删减）
        if (oldInT) return ClientRedlineDecision.REJECTED
        if (newInT) return ClientRedlineDecision.ACCEPTED
        return ClientRedlineDecision.AMBIGUOUS
    }
    // 互不包含（实质重写）
    if (newInT && !oldInT) return ClientRedlineDecision.ACCEPTED
    if (oldInT && !newInT) return ClientRedlineDecision.REJECTED
    return ClientRedlineDecision.AMBIGUOUS
}
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineParser.classify.test.ts --reporter=verbose`
Expected: PASS（10 个用例全绿）。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/docx/redlineParser.ts tests/server/assistant/contract/docx/redlineParser.classify.test.ts
git commit -m "feat(contract): 修订处置双层判定纯函数"
```

---

## Task 9: 修订解析器 parseRedlineMarks + 段落语料定位

**Files:**
- Modify: `server/agents/contract/docx/redlineParser.ts`
- Test: `tests/server/assistant/contract/docx/redlineParser.test.ts`

- [ ] **Step 1: 写失败测试（用 injectRedlineMarks 产出 docx 再解析，round-trip）**

新建 `tests/server/assistant/contract/docx/redlineParser.test.ts`。**复用 `redlineInjector.test.ts` 的 fixture 构造方式**（`SAMPLE` + `buildFixtureBuffer` + `makeRisk` 一类）产出含修订标记的 docx，断言：

```typescript
// const exported = await injectRedlineMarks(<基底Buf>, <risks>, { reviewId: 871, idStart: 100, signature: '王明远' })
// const parsed = await parseRedlineMarks(exported.buffer)
expect(parsed.reviewId).toBe(871)
expect(parsed.refs.length).toBe(exported.spansByRiskId.size)
for (const ref of parsed.refs) {
    expect(ref.paraIdxs.length).toBeGreaterThan(0)
    // 未经 Word 处理的 docx：所有 ins/del 都存活
    expect(parsed.survivingInsIds.has(ref.insId)).toBe(true)
    for (const delId of ref.delIds) expect(parsed.survivingDelIds.has(delId)).toBe(true)
}
expect(parsed.paragraphs.length).toBeGreaterThan(0)

// 无 redlineRefs.xml 的 docx：reviewId=null、refs 为空
// const bare = await parseRedlineMarks(<基底Buf>)
// expect(bare.reviewId).toBeNull(); expect(bare.refs).toEqual([])

// 损坏的 redlineRefs.xml（写入非法 XML 后）：reviewId=null、refs 为空，不抛错
// 跨段 delIds 多值：构造一条跨段 risk，断言其 ref.delIds.length > 1、paraIdxs.length > 1

// resolveCorpusForRef：对一条 ref 取语料，paraIdxs 命中段落 → 返回该段；
//   paraIdxs 越界 → 返回全文拼接（兜底）
```

> 完整用例（损坏 docx / 跨段 / resolveCorpusForRef 命中与越界）按 spec §11.1 落齐。

Run: `npx vitest run tests/server/assistant/contract/docx/redlineParser.test.ts --reporter=verbose`
Expected: FAIL（`parseRedlineMarks` / `resolveCorpusForRef` 未导出）。

- [ ] **Step 2: 实现 parseRedlineMarks + resolveCorpusForRef**

`server/agents/contract/docx/redlineParser.ts` 追加（import 区合并加 `loadDocxZip` 与 xmlAst 工具）：

```typescript
import { loadDocxZip } from './zipRewriter'
import { parseOoxml, findFirst, findAll, getAttr, textOf, walk, tagOf, collectNonEmptyParagraphs } from './xmlAst'
```

文件追加：

```typescript
/** 单个非空段落的归一化语料 */
export interface RedlineParagraph {
    /** 该段 <w:t> 文本，已 normalizeForMatch 归一化 */
    tNorm: string
    /** 该段 <w:delText> 文本，已 normalizeForMatch 归一化 */
    delNorm: string
}

export interface ParsedRedlineMarks {
    /** redlineRefs.xml 根元素 reviewId；文件不存在为 null */
    reviewId: number | null
    refs: RedlineRefEntry[]
    survivingInsIds: Set<number>
    survivingDelIds: Set<number>
    /** 按非空段落（collectNonEmptyParagraphs 口径）的归一化语料 */
    paragraphs: RedlineParagraph[]
}

/**
 * 解析回传 docx 的修订信息（spec §6.1）。
 * redlineRefs.xml 不存在 / 损坏 → reviewId=null、refs=[]（上层靠安全保护处理）。
 */
export async function parseRedlineMarks(docxBuffer: Buffer): Promise<ParsedRedlineMarks> {
    const zip = await loadDocxZip(docxBuffer)

    let reviewId: number | null = null
    const refs: RedlineRefEntry[] = []
    const refsFile = zip.file('word/customXml/redlineRefs.xml')
    if (refsFile) {
        try {
            const ast = parseOoxml(await refsFile.async('string'))
            const root = findFirst(ast, 'lexseekRedlineRefs')
            if (root) {
                const rid = parseInt(getAttr(root, 'reviewId') ?? '', 10)
                reviewId = Number.isFinite(rid) ? rid : null
            }
            for (const node of findAll(ast, 'ref')) {
                const riskId = parseInt(getAttr(node, 'riskId') ?? '', 10)
                const insId = parseInt(getAttr(node, 'insId') ?? '', 10)
                const parseIds = (attr: string) => (getAttr(node, attr) ?? '')
                    .split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n))
                const delIds = parseIds('delIds')
                const paraIdxs = parseIds('paraIdxs')
                if (Number.isFinite(riskId) && Number.isFinite(insId) && delIds.length > 0) {
                    refs.push({ riskId, delIds, insId, paraIdxs })
                }
            }
        } catch { /* 文件损坏 → 空 refs */ }
    }

    const survivingInsIds = new Set<number>()
    const survivingDelIds = new Set<number>()
    const paragraphs: RedlineParagraph[] = []
    const docFile = zip.file('word/document.xml')
    if (docFile) {
        const ast = parseOoxml(await docFile.async('string'))
        for (const n of findAll(ast, 'w:ins')) {
            const id = parseInt(getAttr(n, 'w:id') ?? '', 10)
            if (Number.isFinite(id)) survivingInsIds.add(id)
        }
        for (const n of findAll(ast, 'w:del')) {
            const id = parseInt(getAttr(n, 'w:id') ?? '', 10)
            if (Number.isFinite(id)) survivingDelIds.add(id)
        }
        // 按非空段落收集 <w:t> / <w:delText> 语料
        for (const para of collectNonEmptyParagraphs(ast)) {
            let rawT = ''
            let rawDel = ''
            walk([para], (n) => {
                const tag = tagOf(n)
                if (tag === 'w:t') rawT += textOf(n)
                else if (tag === 'w:delText') rawDel += textOf(n)
            })
            paragraphs.push({ tNorm: normalizeForMatch(rawT), delNorm: normalizeForMatch(rawDel) })
        }
    }

    return { reviewId, refs, survivingInsIds, survivingDelIds, paragraphs }
}

/**
 * 取某条修订身份证对应的比对语料（spec §6.2）：限定在 paraIdxs 记录的段落；
 * paraIdxs 越界（客户结构性增删段落致序号漂移）时回退全文语料。
 */
export function resolveCorpusForRef(
    parsed: ParsedRedlineMarks,
    ref: RedlineRefEntry,
): { corpusT: string; corpusDel: string } {
    const valid = ref.paraIdxs.filter(i => i >= 0 && i < parsed.paragraphs.length)
    const picked = valid.length > 0
        ? valid.map(i => parsed.paragraphs[i]!)
        : parsed.paragraphs // 段落序号越界 → 回退全文语料
    return {
        corpusT: picked.map(p => p.tNorm).join(' '),
        corpusDel: picked.map(p => p.delNorm).join(' '),
    }
}
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/docx/redlineParser.test.ts --reporter=verbose`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add server/agents/contract/docx/redlineParser.ts tests/server/assistant/contract/docx/redlineParser.test.ts
git commit -m "feat(contract): 新增修订标记回传解析器与段落语料定位"
```

---

## Task 10: 回传链路接入修订识别

**Files:**
- Modify: `server/agents/contract/uploadClientVersion.service.ts`
- Test: `tests/server/assistant/contract/uploadClientVersion.redline.test.ts`

> 本任务改 `uploadClientVersion.service.ts`（现 ~1070 行）。所有新增「逻辑」已落在 `redlineParser.ts`；本文件内只做编排调用，新增约 60 行，不再单独拆分该文件（既有技术债不在本计划范围）。

- [ ] **Step 1: 写失败测试（集成，走 worker DB）**

新建 `tests/server/assistant/contract/uploadClientVersion.redline.test.ts`。构造一条 `completed` 状态的 `contractReviews` + 若干带 `problematicQuote`/`suggestedClauseText` 的 `contractRisks` + 对应 `contractAnnotations`（带 `wordCommentRef`）；用 `injectRedlineMarks` 产出修订版 docx；分别模拟「未处理」（原样回传）与「全接受」（把 docx 里 `<w:ins>` 解包、`<w:del>` 整体删除后回传）上传，消费 SSE 到 complete，断言：

```typescript
it('修订版回传：未处理 docx 不触发防误删、风险标记 untouched', async () => {
    // ...上传未经 Word 处理的修订版 docx
    const review = await prisma.contractReviews.findUniqueOrThrow({ where: { id: reviewId } })
    expect(review.status).not.toBe('failed')
    const risks = await prisma.contractRisks.findMany({ where: { reviewId } })
    expect(risks.every(r => r.clientRedlineDecision === 'untouched')).toBe(true)
})

it('修订版回传：全接受 → clientRedlineDecision=accepted 且 archivedStatus=handled', async () => {
    // ...上传「接受全部修订」后的 docx
    const risk = await prisma.contractRisks.findFirstOrThrow({ where: { reviewId } })
    expect(risk.clientRedlineDecision).toBe('accepted')
    expect(risk.archivedStatus).toBe('handled')
})
```

> 完整用例集见 spec §11.2；Step 6 补「全拒绝→rejected」「接受部分」「both 模式修订+批注并存」「跨审查 redlineRefs 被拒」。测试创建的 review/risks 由 worker DB 隔离自动回收。

Run: `npx vitest run tests/server/assistant/contract/uploadClientVersion.redline.test.ts --reporter=verbose`
Expected: FAIL（纯修订版回传触发 `NO_ANNOTATION_MATCH`，且无 `clientRedlineDecision` 写入）。

- [ ] **Step 2: 引入解析、声明 redline 变量**

`server/agents/contract/uploadClientVersion.service.ts`：

import 区加：
```typescript
import { parseRedlineMarks, classifyRedlineDecision, resolveCorpusForRef, type ParsedRedlineMarks } from './docx/redlineParser'
import { ClientRedlineDecision } from '#shared/types/contract'
```

Step 2 区，在 `let newComments: ParsedWordComment[] = []` 附近加声明：
```typescript
    let redline: ParsedRedlineMarks | null = null
```

Step 2 的 try 块内，`parseWordComments` 调用之后加：
```typescript
            redline = await parseRedlineMarks(docxBuffer)
```

- [ ] **Step 3: 安全保护升级为统一覆盖率**

定位 Step 3 里现有的 `systemDbAnnotations` / `matchRatio` / `NO_MATCH_THRESHOLD` / `tripsSafety` 计算块（约第 337-344 行，`const systemDbAnnotations = dbAnnotations.filter(...)` 到 `tripsSafety` 赋值结束），整段替换为：

```typescript
    // 修订身份证归属判定（spec §9.2）
    const redlineCrossReview =
        redline != null && redline.refs.length > 0
        && redline.reviewId !== null && redline.reviewId !== review.id
    if (redlineCrossReview) {
        logger.warn('修订身份证跨审查，已忽略该 docx 的修订标记', {
            uploadReviewId: review.id,
            declaredReviewId: redline!.reviewId,
            refCount: redline!.refs.length,
        })
    }
    const redlineUsable = redline != null && redline.refs.length > 0 && !redlineCrossReview

    // 统一覆盖率（spec §9.1）：批注命中 ∪ 修订身份证登记 的风险，
    // 占「带 customXml 身份证（wordCommentRef 非空）的风险」的比例。
    // 注：现有 DOCX-H5 注释称「忽略 external」与实际 filter 不符，统一以「带身份证」为口径。
    const systemDbAnnotations = dbAnnotations.filter(a => a.wordCommentRef != null)
    const identifiableRiskIds = new Set(systemDbAnnotations.map(a => a.riskId))
    const coveredRiskIds = new Set<number>()
    for (const annId of commentByAnnId.keys()) {
        const ann = annById.get(annId)
        if (ann) coveredRiskIds.add(ann.riskId)
    }
    if (redlineUsable) {
        for (const ref of redline!.refs) coveredRiskIds.add(ref.riskId)
    }
    let coveredCount = 0
    for (const id of coveredRiskIds) if (identifiableRiskIds.has(id)) coveredCount++
    const coverageRatio = identifiableRiskIds.size > 0 ? coveredCount / identifiableRiskIds.size : 1
    const NO_MATCH_THRESHOLD = 0.2
    const docxHasContent = newComments.length > 0 || (redline != null && redline.refs.length > 0)
    const tripsSafety =
        identifiableRiskIds.size > 0 && docxHasContent && coverageRatio < NO_MATCH_THRESHOLD
```

- [ ] **Step 4: 报错文案修正**

定位 `tripsSafety` 为真时 `yield { type: 'error', ... }` 块。把 `code` 改为 `'NO_CONTENT_MATCH'`，`message` 改为：

```typescript
                message: (crossReviewRejected > 0 || redlineCrossReview)
                    ? `上传的 docx 属于其他合同审查（文档标识里的审查编号与本次不符），已拒绝处理。请确认上传的是本审查导出的版本。`
                    : '上传的 docx 没能和本次审查的任何批注或修订对应上，已中止处理以免误改。请确认：1) 上传的是本次审查导出的 docx；2) 客户编辑时未使用会破坏文档标识的工具——如不确定，建议重新从系统下载最新版发给客户。',
```

同步把该 `logger.error` 里日志字段从 `matchRatio` 等改为 `coverageRatio` / `identifiableRiskCount: identifiableRiskIds.size` / `coveredCount`。

- [ ] **Step 5: 修订处置识别块**

在 `tripsSafety` 的 `return` 之后、Step 4（AI 增量审查）开始之前，加修订识别块（语料按 §6.2 限定在风险所属段落，用 `resolveCorpusForRef`）：

```typescript
    // ===== Step 3b：修订处置识别（spec §6） =====
    const redlineDecisions = new Map<number, ClientRedlineDecision>()
    const redlineCounts: Record<ClientRedlineDecision, number> = {
        [ClientRedlineDecision.ACCEPTED]: 0,
        [ClientRedlineDecision.REJECTED]: 0,
        [ClientRedlineDecision.UNTOUCHED]: 0,
        [ClientRedlineDecision.AMBIGUOUS]: 0,
    }
    if (redlineUsable) {
        const riskByIdForRedline = new Map(dbRisks.map(r => [r.id, r]))
        for (const ref of redline!.refs) {
            const risk = riskByIdForRedline.get(ref.riskId)
            if (!risk || !risk.problematicQuote || !risk.suggestedClauseText) continue
            const { corpusT, corpusDel } = resolveCorpusForRef(redline!, ref)
            const decision = classifyRedlineDecision({
                ref,
                survivingInsIds: redline!.survivingInsIds,
                survivingDelIds: redline!.survivingDelIds,
                corpusT,
                corpusDel,
                problematicQuote: risk.problematicQuote,
                suggestedClauseText: risk.suggestedClauseText,
            })
            redlineDecisions.set(ref.riskId, decision)
            redlineCounts[decision]++
        }
        logger.info('修订处置识别完成', { reviewId: review.id, ...redlineCounts })
    }
```

- [ ] **Step 6: 事务内写处置 + summary**

在 Step 5 的 `prisma.$transaction(async (tx) => { ... })` 内，`syncReviewRisksJsonb(review.id, tx)` 调用**之前**加：

```typescript
            // 写客户修订处置（spec §7）：接受 → 自动解决，但不覆盖律师已有处置
            for (const [riskId, decision] of redlineDecisions) {
                const data: Prisma.contractRisksUpdateInput = { clientRedlineDecision: decision }
                if (decision === ClientRedlineDecision.ACCEPTED) {
                    const r = dbRisks.find(x => x.id === riskId)
                    if (r && r.archivedStatus == null) {
                        data.archivedStatus = 'handled'
                        data.archivedAt = new Date()
                    }
                }
                await tx.contractRisks.update({ where: { id: riskId }, data })
            }
```

定位 `const summary = \`本轮变化：...\`` 行，改为 `let summary` 并在其后追加：

```typescript
        if (redlineDecisions.size > 0) {
            summary += ` · 客户修订：接受 ${redlineCounts.accepted} / 拒绝 ${redlineCounts.rejected} / 未处理 ${redlineCounts.untouched}`
            if (redlineCounts.ambiguous > 0) summary += ` / 待确认 ${redlineCounts.ambiguous}`
        }
```

补全 Step 1 测试：按 spec §11.2 补「全拒绝 → rejected」「接受部分」「both 模式修订+批注并存」「跨审查 redlineRefs 被拒」用例。

- [ ] **Step 7: 运行测试，确认通过**

Run: `npx vitest run tests/server/assistant/contract/uploadClientVersion.redline.test.ts --reporter=verbose`
Expected: PASS。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add server/agents/contract/uploadClientVersion.service.ts tests/server/assistant/contract/uploadClientVersion.redline.test.ts
git commit -m "feat(contract): 回传链路接入修订处置识别与安全保护升级"
```

---

## Task 11: 风险列表客户处置徽章

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Test: `tests/app/components/assistant/contract/RiskListPanel.badge.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `tests/app/components/assistant/contract/RiskListPanel.badge.test.ts` 追加用例。该文件已有挂载工具 `mountPanel(risks)`（位置参数，传风险数组）与 `makeRisk(overrides)`（入参 `Record<string, unknown>`、返回未类型化风险对象）——直接复用；`makeRisk` 无类型约束，可直接传 `clientRedlineDecision`：

```typescript
it('风险带 clientRedlineDecision 时渲染客户处置徽章', () => {
    const wrapper = mountPanel([makeRisk({ clientRedlineDecision: 'accepted' })])
    expect(wrapper.text()).toContain('客户已采纳')
})
```

> 该文件顶部有 `vi.mock('lucide-vue-next', ...)` 图标白名单——把 Task 11 Step 3 新增的 `CircleDashedIcon` / `HelpCircleIcon` 一并加进该 mock 的导出列表，否则组件内这两个图标解析为 `undefined`（当前用例只断言 accepted 暂不报错，补上防后续脆裂）。

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.badge.test.ts --reporter=verbose`
Expected: FAIL（无「客户已采纳」文本）。

- [ ] **Step 2: ContractReviewPanel 透传字段**

`app/components/assistant/contract/ContractReviewPanel.vue` 的 `mapEntityToDisplay` 函数，在 `archivedStatus: e.archivedStatus,` 之后加：

```typescript
            clientRedlineDecision: e.clientRedlineDecision,
```

- [ ] **Step 3: RiskListPanel 渲染徽章**

`app/components/assistant/contract/RiskListPanel.vue`：

(a) `#shared/types/contract` 的 type import 加 `ClientRedlineDecision`；值 import 行加 `ClientRedlineDecision, ClientRedlineDecisionText`：
```typescript
import { RISK_LEVEL_LABEL, ClientRedlineDecision, ClientRedlineDecisionText } from '#shared/types/contract'
```
lucide 图标 import —— `CheckCircle2Icon` 与 `XCircleIcon` **已存在**（见第 18 行），仅新增 `CircleDashedIcon, HelpCircleIcon`。

(b) `<script>` 内 `ARCHIVED_STATUS_LABEL` 附近加徽章配置：
```typescript
/** 客户修订处置徽章配置（图标 + 主题语义色，深色模式自适应） */
const CLIENT_REDLINE_BADGE: Record<ClientRedlineDecision, { label: string; icon: unknown; class: string }> = {
    [ClientRedlineDecision.ACCEPTED]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.ACCEPTED],
        icon: CheckCircle2Icon,
        class: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400',
    },
    [ClientRedlineDecision.REJECTED]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.REJECTED],
        icon: XCircleIcon,
        class: 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400',
    },
    [ClientRedlineDecision.UNTOUCHED]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.UNTOUCHED],
        icon: CircleDashedIcon,
        class: 'bg-muted text-muted-foreground',
    },
    [ClientRedlineDecision.AMBIGUOUS]: {
        label: ClientRedlineDecisionText[ClientRedlineDecision.AMBIGUOUS],
        icon: HelpCircleIcon,
        class: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400',
    },
}
```

(c) 模板内「已处置徽章」`<Badge v-if="getArchivedStatus(r)" ...>` 之后加：
```html
                                <!-- 客户修订处置徽章 -->
                                <Badge
                                    v-if="r.clientRedlineDecision"
                                    variant="secondary"
                                    class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5"
                                    :class="CLIENT_REDLINE_BADGE[r.clientRedlineDecision].class"
                                >
                                    <component :is="CLIENT_REDLINE_BADGE[r.clientRedlineDecision].icon" class="size-2.5" />
                                    {{ CLIENT_REDLINE_BADGE[r.clientRedlineDecision].label }}
                                </Badge>
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.badge.test.ts --reporter=verbose`
Expected: PASS。

Run: `bun run typecheck`
Expected: PASS。

- [ ] **Step 5: 浏览器验证**

`bun dev`，打开一个有客户回传记录的合同审查工作台，确认风险卡显示「客户已采纳/已拒绝/未处理/待确认」徽章，深色模式下对比度正常。

- [ ] **Step 6: Commit**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue app/components/assistant/contract/RiskListPanel.vue tests/app/components/assistant/contract/RiskListPanel.badge.test.ts
git commit -m "feat(ui): 风险列表显示客户修订处置徽章"
```

---

## Task 12: 技术文档同步

**Files:**
- Modify: `docs/tech-docs/backend/contract.md`
- Modify: `docs/tech-docs/backend/auth-users-sms.md`

- [ ] **Step 1: 补充 contract.md**

在 `docs/tech-docs/backend/contract.md` 末尾新增一节 `## 13. 修订版回传识别与自定义署名`，覆盖：
- 修订身份证 `word/customXml/redlineRefs.xml`（结构含 `paraIdxs`、`injectRedlineMarks` 写入、`customXmlRegistrar` 注册）。
- 回传识别：`redlineParser.parseRedlineMarks` + `resolveCorpusForRef`（按 `paraIdxs` 取段落语料）+ `classifyRedlineDecision` 双层算法、4 态判定。
- `uploadClientVersion` 的修订识别接入点（Step 2/3b/5）、统一覆盖率安全保护、`NO_CONTENT_MATCH` 报错。
- 自定义署名：`resolveContractExportSignatureService`，导出端 AI 修订/批注作者名用署名、去 `LS:` 前缀。
- `contractRisks.clientRedlineDecision` 字段与「接受自动解决」规则。

文风与现有章节一致（表格 + 代码引用），控制在 60 行内。

- [ ] **Step 2: 补充 auth-users-sms.md**

在 `docs/tech-docs/backend/auth-users-sms.md` 用户资料相关章节补一句：`users.contractExportSignature` 字段用途（合同导出署名），`PUT /api/v1/users/profile` 已支持读写该字段。控制在 5 行内。

- [ ] **Step 3: 运行全量测试**

Run: `bun run test`
Expected: PASS（无回归）。既有合同测试因作者名变化（批注去 `LS:` 前缀、修订作者改署名）需更新的断言，应已在 Task 5 一并处理；此处确认全量无遗漏。

- [ ] **Step 4: Commit**

```bash
git add docs/tech-docs/backend/contract.md docs/tech-docs/backend/auth-users-sms.md
git commit -m "docs(contract): 补充修订版回传识别与自定义署名文档"
```

---

## 真机 E2E 抽查（spec §11.3，全部任务完成后）

非自动化步骤，记录于此供执行者手动完成：导出一份修订版 docx → 在真实 Word 里分别做「接受全部 / 拒绝全部 / 接受部分」并保存 → 各回传一次，确认 `clientRedlineDecision` 落库正确、横幅统计准确、`redlineRefs.xml` 经 Word 保存后保留。若 Word 重排了 `w:id`，确认 Layer 2 正文比对兜底层仍判定正确。
