# 文书生成体验升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文书生成支持多轮修改（草稿持久化 + 二次进入工作区），改为左右分栏 + 悬浮 Agent 窗（复用小索基建），材料选择走弹框（复用 CaseAnalysisMaterialSelector），并修复上传模板不显示（#6）与预览占位符未替换（#7）两个 bug。

**Architecture:** 信息架构拆为 `/dashboard/document`（首页：新建 + 我的草稿列表）和 `/dashboard/document/drafts/:id`（工作区：左表单 + 右预览 + 悬浮 Agent 窗）。Agent 层面不新建 composable，在现有 `useDocumentDraft` 上补齐队列 / 中断 / 已有草稿挂载能力。案件场景的 `DocumentDraftPanel` 保持不动。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind v4 + shadcn-vue + Pinia + Prisma + Vitest + Playwright

**相关 spec:** [docs/superpowers/specs/2026-04-18-document-generation-overhaul-design.md](../specs/2026-04-18-document-generation-overhaul-design.md)

---

## 文件结构

### 新增

| 路径 | 责任 |
| --- | --- |
| `app/pages/dashboard/document/drafts/[id].vue` | 草稿工作区页面：左表单 / 右预览 / 悬浮 Agent |
| `app/components/assistant/document/DraftList.vue` | 首页"我的草稿"列表组件（分页 + 删除） |
| `server/api/v1/assistant/document/drafts/[id].delete.ts` | 软删除草稿 API |
| `tests/server/assistant/document/draftDelete.api.test.ts` | DELETE API 集成测试 |
| `tests/client/composables/useDocumentDraft.extensions.test.ts` | composable 扩展的队列 / 中断 / mountDraft 单测 |
| `tests/e2e/document-draft-workflow.spec.ts` | 端到端：选模板 → 建 → 退出 → 回来改 → 导出 |

### 修改

| 路径 | 变更点 |
| --- | --- |
| `app/composables/useDocumentDraft.ts` | 新增 `mountDraft(draftId)` / `sendMessage` / `stopGeneration` / `resumeInterrupt` / 队列 API |
| `app/pages/dashboard/document/index.vue` | 首页改版：模板选择 + 我的草稿列表 |
| `app/pages/dashboard/document/templates.vue` | #6 bug 修复 |
| `app/components/assistant/document/DocumentPreview.vue` | #7 bug 修复 |
| `server/services/assistant/document/documentDraft.dao.ts` | 新增 `softDeleteDocumentDraftDAO` |
| `server/services/assistant/document/documentDraft.service.ts` | 新增 `deleteDraftService` |

### 保持不动（回归需通过）

- `app/components/assistant/document/DocumentDraftPanel.vue`（案件详情页仍在用）
- `app/components/assistant/document/DocumentFieldForm.vue`
- `app/components/assistant/document/DocumentTemplatePicker.vue`
- `app/components/assistant/document/DocumentSourceInput.vue`（独立场景不再使用，但案件场景里 `DocumentDraftPanel` 仍复用）

---

## 执行约束

- **每个任务必须遵循 TDD**：先写失败测试 → 运行确认失败 → 最小实现 → 运行确认通过 → commit
- **两个 bug spike 的结束点是"给用户报告"**，**必须得到用户对修复方向的确认才能继续后续 fix 任务**
- 所有 commit 使用 conventional commits 中文 subject（参见 `.claude/rules/git.md`）

---

## Task 1: #6 Bug Spike — 上传模板不显示（只调查，不修）

**Files:**
- Read: `app/pages/dashboard/document/templates.vue:484-509`
- Read: `app/composables/useApiFetch.ts`（或搜索实际路径）
- Read: `server/api/v1/assistant/document/templates.post.ts`

- [ ] **Step 1: 复现现象**

  在浏览器打开 `/dashboard/document/templates`，点击"上传模板"，选择一个 `.docx` 文件填表提交，使用 chrome-devtools MCP 捕获：
  - Network：`POST /api/v1/assistant/document/templates` 的完整响应体（`code` 字段值、`data` 字段值）
  - Console：是否有 warn / error
  - UI：toast 是否触发、`uploadDialogOpen` 是否关闭、列表是否 reload

- [ ] **Step 2: 核对 `useApiFetch` 在当前响应下的返回值**

  在 `templates.vue:497-505` 的 `if (result !== null)` 位置打 `console.log('[spike-6] upload result:', result)`，观察：
  - 后端 code 200 时 result 是什么（期望是 `{ templateId: number }`）
  - 后端 code 非 200 时 result 是什么
  - 对照 `.claude/rules/fetch.md`："useApiFetch 自动提取 data 字段"——确认实际行为

- [ ] **Step 3: 核对 `loadTemplates` 的查询参数**

  确认 `loadTemplates` 用 `{ scope: 'user', ... }`（第 358-362 行），对比 `GET /api/v1/assistant/document/templates` 的 DAO 过滤条件（`server/services/assistant/document/documentTemplate.dao.ts`），是否存在过滤错位（如 status / scope / userId）。

- [ ] **Step 4: 形成假设并写成报告**

  按以下模板输出给用户：
  ```
  ## #6 根因报告
  - 现象：<chrome-devtools 抓到的 Network/Console/UI 行为>
  - 根因假设：<具体哪一行哪一判断导致>
  - 修复方向（≤3 个候选）：
    A. <方案> —— 影响范围 <...>
    B. <方案> —— 影响范围 <...>
  - 推荐：<A/B/C + 理由>
  ```

- [ ] **Step 5: 向用户请示**

  输出报告后停止，**等待用户选定方向**。不动任何生产代码，不 commit。

---

## Task 2: #7 Bug Spike — 预览占位符未替换（只调查，不修）

**Files:**
- Read: `app/components/assistant/document/DocumentPreview.vue:25-36`
- Read: 任意一个现有 user-scope 模板文件（通过后端 API 拿 downloadUrl 下载）

- [ ] **Step 1: 准备可复现样本**

  挑一个用户反馈有问题的 user-scope 模板（可以是 Task 1 spike 里刚传上来的），用浏览器生成一份草稿，等 AI 分析完成进入 `ready` 状态。

- [ ] **Step 2: Dump 预览区 DOM**

  在 chrome-devtools 控制台执行（`previewRoot` 元素下）：
  ```js
  const root = document.querySelector('.docx-preview-root')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts = []
  while (walker.nextNode()) texts.push(JSON.stringify(walker.currentNode.nodeValue))
  console.log(texts.join('\n'))
  ```

- [ ] **Step 3: 判断占位符是否跨节点**

  检查 dump 结果里 `{{` 和 `}}` 是否出现在**同一个**字符串中。如果 `{{` 在一段、`}}` 在后面另一段，就是跨 Text 节点。同时记录字段名（`{{甲方}}`）的中间字符是否也被拆开。

- [ ] **Step 4: 核对 `props.values` 内容**

  在 `DocumentPreview.vue:54` 的 debouncedUpdate 入口打 `console.log('[spike-7] values:', v)`，确认 `values` 里的键和模板占位符**完全匹配**（大小写、中文字符无混淆）。

- [ ] **Step 5: 形成假设并写成报告**

  同 Task 1 模板，输出给用户后停止等待方向确认。

---

## ⏸️ 用户确认检查点 A

**Task 1 和 Task 2 的报告输出完后暂停，等待用户对 #6 / #7 各自的修复方向确认**。用户确认后才进入 Task 3 / Task 4。

---

## Task 3: 修复 #6

**Files:**
- Modify: `app/pages/dashboard/document/templates.vue`（具体修改行依用户确认的方向）
- Modify: `server/...`（若根因在后端则可能需要动）
- Test: `tests/client/pages/templates.upload.test.ts` 或 `tests/server/...`（测试文件由根因决定）

> **注**：本任务的具体代码由用户在检查点 A 选定的方向决定；以下步骤为通用 TDD 骨架，实际代码需在 Task 1 报告被确认后填入。

- [ ] **Step 1: 写回归测试**

  根据 Task 1 定位的行为（例如"上传成功后列表应自动刷新且 toast 提示"），写一个失败的单元 / 集成测试覆盖该分支。测试代码引用 Task 1 报告中写明的断言点。

- [ ] **Step 2: 运行测试确认失败**

  `npx vitest run <测试文件路径> --reporter=verbose`
  Expected: 断言 FAIL

- [ ] **Step 3: 最小修复**

  按用户选定的方向改动代码。**原则**：只改用户确认方向涉及的最小代码块，不顺手重构、不额外扩展。具体改什么行依赖用户在检查点 A 的回复，不在本 plan 内预判。

- [ ] **Step 4: 运行测试确认通过 + 手工回归**

  `npx vitest run <测试文件路径> --reporter=verbose`
  Expected: PASS

  浏览器复现上传流程，确认 #6 现象消失（有 toast + 列表自动出现新模板）。

- [ ] **Step 5: Commit**

  ```bash
  git add <改动文件>
  git commit -m "fix(assistant): 上传模板后"我的文书模板"页列表自动刷新 (#6)"
  ```

---

## Task 4: 修复 #7

**Files:**
- Modify: `app/components/assistant/document/DocumentPreview.vue`（若根因在前端跨节点）
- 或 Modify: `server/services/assistant/document/documentTemplate.service.ts`（若根因在后端规范化）
- Test: `tests/client/components/DocumentPreview.test.ts` 或 server 侧对应测试

> **注**：本任务代码由用户在检查点 A 选定方向决定。

- [ ] **Step 1: 写跨节点样本的失败测试**

  构造 Task 2 dump 中看到的"跨节点占位符"的 DOM 结构作为测试 fixture。断言：调用 `replacePlaceholders(root, values)` 后，文本应已被替换。

  示例（只写样例，实际拷贝 dump 内容）：
  ```ts
  import { describe, it, expect } from 'vitest'

  describe('DocumentPreview: cross-node placeholder replacement', () => {
    it('replaces placeholder split across adjacent text nodes', () => {
      const root = document.createElement('div')
      // 构造 <p><span>{{</span><span>甲</span><span>方</span><span>}}</span></p>
      // ...（具体结构拷贝自 Task 2 dump）
      // const replace = ...（从组件里导出纯函数后 import）
      // replace(root, { 甲方: '张三' })
      // expect(root.textContent.includes('{{')).toBe(false)
      // expect(root.textContent.includes('张三')).toBe(true)
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  `npx vitest run tests/client/components/DocumentPreview.test.ts --reporter=verbose`
  Expected: FAIL

- [ ] **Step 3: 按方向修复**

  按用户在检查点 A 选定的方向实现。不在本 plan 内预判具体代码——等用户确认后再写。实现时若涉及把内部函数提出为导出纯函数（便于单测），那步骤 1 的测试 import 路径需同步。

- [ ] **Step 4: 运行通过 + 手工回归**

  浏览器跑一遍：建草稿 → 等 AI 填完 → 预览区占位符被替换。

- [ ] **Step 5: Commit**

  ```bash
  git add app/components/assistant/document/DocumentPreview.vue tests/client/components/DocumentPreview.test.ts
  git commit -m "fix(assistant): 跨节点 {{占位符}} 在 DOCX 预览中正确替换 (#7)"
  ```

---

## Task 5: DELETE /drafts/:id API（TDD）

**Files:**
- Create: `server/api/v1/assistant/document/drafts/[id].delete.ts`
- Modify: `server/services/assistant/document/documentDraft.dao.ts`（新增 `softDeleteDocumentDraftDAO`）
- Modify: `server/services/assistant/document/documentDraft.service.ts`（新增 `deleteDraftService`）
- Test: `tests/server/assistant/document/draftDelete.api.test.ts`

- [ ] **Step 1: 写 DAO 失败测试**

  在 `tests/server/assistant/document/documentDraft.dao.test.ts`（如不存在则新建）里加：
  ```ts
  import { softDeleteDocumentDraftDAO, getDocumentDraftDAO, createDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'

  describe('softDeleteDocumentDraftDAO', () => {
    it('sets deletedAt on target and makes getDocumentDraftDAO return null', async () => {
      const created = await createDocumentDraftDAO({
        userId: TEST_USER_ID,
        templateId: TEST_TEMPLATE_ID,
        sessionId: randomUUID(),
        status: 'pending',
        values: {},
        sourceRef: null,
        metadata: null,
        caseId: null,
      })
      await softDeleteDocumentDraftDAO(created.id)
      const fetched = await getDocumentDraftDAO(created.id)
      expect(fetched).toBeNull()
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  `npx vitest run tests/server/assistant/document/documentDraft.dao.test.ts --reporter=verbose`
  Expected: FAIL — `softDeleteDocumentDraftDAO is not a function`

- [ ] **Step 3: 实现 DAO**

  `server/services/assistant/document/documentDraft.dao.ts` 追加：
  ```ts
  /**
   * 软删除草稿：设置 deletedAt=now。
   */
  export async function softDeleteDocumentDraftDAO(id: number, tx?: Prisma.TransactionClient) {
      const db = tx ?? prisma
      return db.documentDrafts.update({
          where: { id },
          data: { deletedAt: new Date() },
      })
  }
  ```

- [ ] **Step 4: 运行通过**

  `npx vitest run tests/server/assistant/document/documentDraft.dao.test.ts --reporter=verbose`
  Expected: PASS

- [ ] **Step 5: 写 Service 失败测试**

  在同一测试文件或新建 `documentDraft.service.test.ts` 里：
  ```ts
  import { deleteDraftService } from '~~/server/services/assistant/document/documentDraft.service'

  describe('deleteDraftService', () => {
    it('returns 404 when draft not found', async () => {
      const result = await deleteDraftService(TEST_USER_ID, 999999)
      expect(result).toEqual({ error: '草稿不存在', code: 404 })
    })

    it('returns 403 when draft belongs to other user', async () => {
      const other = await createDocumentDraftDAO({ userId: OTHER_USER_ID, /* ... */ })
      const result = await deleteDraftService(TEST_USER_ID, other.id)
      expect(result).toEqual({ error: '无权删除此草稿', code: 403 })
    })

    it('soft-deletes own draft and returns ok', async () => {
      const own = await createDocumentDraftDAO({ userId: TEST_USER_ID, /* ... */ })
      const result = await deleteDraftService(TEST_USER_ID, own.id)
      expect(result).toEqual({ ok: true })
      expect(await getDocumentDraftDAO(own.id)).toBeNull()
    })
  })
  ```

- [ ] **Step 6: 运行确认失败**

  `npx vitest run tests/server/assistant/document/documentDraft.service.test.ts --reporter=verbose`
  Expected: FAIL — `deleteDraftService is not a function`

- [ ] **Step 7: 实现 Service**

  `server/services/assistant/document/documentDraft.service.ts` 追加：
  ```ts
  import { softDeleteDocumentDraftDAO } from './documentDraft.dao'

  export async function deleteDraftService(
      userId: number,
      draftId: number,
  ): Promise<{ ok: true } | ServiceError> {
      const draft = await getDocumentDraftDAO(draftId)
      if (!draft) return { error: '草稿不存在', code: 404 }
      if (draft.userId !== userId) return { error: '无权删除此草稿', code: 403 }
      await softDeleteDocumentDraftDAO(draftId)
      return { ok: true }
  }
  ```

- [ ] **Step 8: 运行通过**

  `npx vitest run tests/server/assistant/document/documentDraft.service.test.ts --reporter=verbose`
  Expected: PASS

- [ ] **Step 9: 写 API 失败测试**

  `tests/server/assistant/document/draftDelete.api.test.ts`：
  ```ts
  import { describe, it, expect, beforeAll } from 'vitest'
  import { randomUUID } from 'node:crypto'
  import { createDocumentDraftDAO, getDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'
  import handler from '~~/server/api/v1/assistant/document/drafts/[id].delete'

  // 参考 tests/server/assistant/document/templates.api.test.ts 的 mock event 写法
  function mockEvent(opts: { user?: { id: number } | null; id: string }) {
      return {
          context: { auth: opts.user ? { user: opts.user } : undefined, params: { id: opts.id } },
          node: { req: {} },
      } as any
  }

  const OWNER_ID = 1
  const OTHER_ID = 2
  let ownDraftId: number

  beforeAll(async () => {
      const own = await createDocumentDraftDAO({
          userId: OWNER_ID, templateId: 1, sessionId: randomUUID(),
          status: 'pending', values: {}, sourceRef: null, metadata: null, caseId: null,
      })
      ownDraftId = own.id
  })

  describe('DELETE /api/v1/assistant/document/drafts/:id', () => {
      it('returns 401 when not authenticated', async () => {
          const res = await handler(mockEvent({ user: null, id: String(ownDraftId) }))
          expect(res).toMatchObject({ code: 401 })
      })

      it('returns 400 when id invalid', async () => {
          const res = await handler(mockEvent({ user: { id: OWNER_ID }, id: 'abc' }))
          expect(res).toMatchObject({ code: 400 })
      })

      it('returns 404 when draft missing', async () => {
          const res = await handler(mockEvent({ user: { id: OWNER_ID }, id: '999999' }))
          expect(res).toMatchObject({ code: 404 })
      })

      it('returns 403 when not owner', async () => {
          const res = await handler(mockEvent({ user: { id: OTHER_ID }, id: String(ownDraftId) }))
          expect(res).toMatchObject({ code: 403 })
      })

      it('soft-deletes and returns 200', async () => {
          const res = await handler(mockEvent({ user: { id: OWNER_ID }, id: String(ownDraftId) }))
          expect(res).toMatchObject({ code: 200 })
          expect(await getDocumentDraftDAO(ownDraftId)).toBeNull()
      })
  })
  ```

  > **注**：若项目其他 api.test.ts 是用 `$fetch` + setup-test 调用而非直接 handler，请参照现有风格同步改写，保留断言语义。

- [ ] **Step 10: 运行确认失败**

  Expected: FAIL —— handler 文件不存在

- [ ] **Step 11: 实现 API handler**

  新建 `server/api/v1/assistant/document/drafts/[id].delete.ts`：
  ```ts
  /**
   * DELETE /api/v1/assistant/document/drafts/:id
   *
   * 软删除当前用户的草稿。归属校验后设置 deletedAt。
   *
   * 错误码：
   * - 400：ID 无效
   * - 403：非归属用户
   * - 404：草稿不存在
   */
  import { deleteDraftService } from '~~/server/services/assistant/document/documentDraft.service'

  export default defineEventHandler(async (event) => {
      const user = event.context.auth?.user
      if (!user) return resError(event, 401, '请先登录')

      const idStr = getRouterParam(event, 'id')
      const id = Number(idStr)
      if (!idStr || !Number.isInteger(id) || id <= 0) {
          return resError(event, 400, '草稿 ID 无效')
      }

      const result = await deleteDraftService(user.id, id)
      if ('error' in result) {
          return resError(event, result.code, result.error)
      }
      return resSuccess(event, '删除成功', result)
  })
  ```

- [ ] **Step 12: 运行 API 测试通过**

  `npx vitest run tests/server/assistant/document/draftDelete.api.test.ts --reporter=verbose`
  Expected: PASS

- [ ] **Step 13: Commit**

  ```bash
  git add server/ tests/server/
  git commit -m "feat(assistant): 新增 DELETE /drafts/:id 软删除草稿 API"
  ```

---

## Task 6: 扩展 `useDocumentDraft` — `mountDraft(draftId)` 加载已有草稿

**Files:**
- Modify: `app/composables/useDocumentDraft.ts`
- Test: `tests/client/composables/useDocumentDraft.extensions.test.ts`

目标：支持通过已有 draftId 挂载 composable，用于工作区页面二次进入时恢复状态。

- [ ] **Step 1: 写失败测试**

  `tests/client/composables/useDocumentDraft.extensions.test.ts`：
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { nextTick } from 'vue'
  import { setup } from '@nuxt/test-utils'
  import { useDocumentDraft } from '~/composables/useDocumentDraft'

  // 按项目其他 composable 测试的 mock 方式 mock useApiFetch
  vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: vi.fn(),
  }))

  describe('useDocumentDraft.mountDraft', () => {
    it('loads draft + template, sets draft/template refs, mounts stream', async () => {
      const mockFetch = useApiFetch as unknown as ReturnType<typeof vi.fn>
      mockFetch
        .mockResolvedValueOnce({ id: 42, sessionId: 'sess-42', values: { 甲方: '张三' }, templateId: 7, status: 'ready' })
        .mockResolvedValueOnce({ id: 7, name: '租赁合同', placeholders: [{ name: '甲方' }] })

      const draft = useDocumentDraft()
      await draft.mountDraft(42)
      await nextTick()

      expect(draft.draft.value?.id).toBe(42)
      expect(draft.template.value?.id).toBe(7)
      expect(draft.runStatus.value).toBe('ready')
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  `npx vitest run tests/client/composables/useDocumentDraft.extensions.test.ts --reporter=verbose`
  Expected: FAIL —— `mountDraft is not a function`

- [ ] **Step 3: 实现 `mountDraft`**

  在 `app/composables/useDocumentDraft.ts` 的 `onStart` 附近新增：
  ```ts
  async function mountDraft(id: number) {
      draft.value = null
      template.value = null
      draftId.value = null
      stream.value = null

      const draftResp = await useApiFetch<documentDrafts>(
          `/api/v1/assistant/document/drafts/${id}`,
      )
      if (!draftResp) {
          runStatus.value = 'idle'
          return
      }
      draft.value = draftResp
      draftId.value = draftResp.id

      const tpl = await useApiFetch<DocumentTemplate>(
          `/api/v1/assistant/document/templates/${draftResp.templateId}`,
          { showError: false } as any,
      )
      if (tpl) template.value = tpl

      // 已有草稿：按当前 status 初始化 runStatus
      runStatus.value = draftResp.status === 'failed'
          ? 'failed'
          : (draftResp.status === 'exported' ? 'exported' : 'ready')

      mountStream(draftResp.sessionId)
      // 已有 sessionId 的 checkpointer 回放（composable onMounted 内调用，不需 immediate 配置）
      stream.value!.submit(undefined)
  }
  ```

  在 return 对象里导出 `mountDraft`。

- [ ] **Step 4: 运行通过**

  `npx vitest run tests/client/composables/useDocumentDraft.extensions.test.ts --reporter=verbose`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add app/composables/useDocumentDraft.ts tests/client/composables/useDocumentDraft.extensions.test.ts
  git commit -m "feat(assistant): useDocumentDraft 新增 mountDraft 支持二次进入"
  ```

---

## Task 7: 扩展 `useDocumentDraft` — 发送消息 / 停止 / 中断

**Files:**
- Modify: `app/composables/useDocumentDraft.ts`
- Modify: `tests/client/composables/useDocumentDraft.extensions.test.ts`

- [ ] **Step 1: 写失败测试**

  追加到 extensions 测试文件：
  ```ts
  describe('useDocumentDraft agent actions', () => {
    it('sendMessage submits to stream with human message', async () => {
      const draft = useDocumentDraft()
      // mount first
      await draft.mountDraft(42)
      const spy = vi.spyOn(draft.stream as any, 'submit')
      draft.sendMessage('请帮我填乙方')
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        messages: [{ type: 'human', content: '请帮我填乙方' }],
      }))
    })

    it('exposes interruptData computed from stream', async () => {
      const draft = useDocumentDraft()
      await draft.mountDraft(42)
      // set values.__interrupt__ via mock stream
      expect(draft.interruptData).toBeDefined()
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  Expected: FAIL —— `sendMessage` / `interruptData` 未导出

- [ ] **Step 3: 实现 sendMessage / stopGeneration / resumeInterrupt**

  在 composable 内：
  ```ts
  function sendMessage(text: string) {
      if (!stream.value) return
      stream.value.runStatus.value = 'idle'
      stream.value.submit({
          messages: [{ type: 'human', content: text }],
      } as any)
  }

  async function stopGeneration() {
      await stream.value?.stop()
  }

  function resumeInterrupt(data: unknown) {
      if (!stream.value) return
      stream.value.runStatus.value = 'idle'
      stream.value.submit(undefined, { command: { resume: data } })
  }

  const interruptData = computed(() => stream.value?.interruptData.value ?? null)
  const isInterrupted = computed(() => interruptData.value != null)
  ```

  在 return 对象里暴露具体字段（**不暴露 stream 整体**以避免 composable 内部耦合）：
  ```ts
  return {
      // ...已有：draft, template, runStatus, onStart, onFieldChange, onExport, mountDraft
      messages: computed(() => stream.value?.messages.value ?? []),
      isLoading: computed(() => !!stream.value?.isLoading.value),
      error: computed(() => stream.value?.error.value ?? null),
      sendMessage,
      stopGeneration,
      resumeInterrupt,
      interruptData,
      isInterrupted,
  }
  ```

- [ ] **Step 4: 运行通过**

  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add app/composables/useDocumentDraft.ts tests/client/composables/useDocumentDraft.extensions.test.ts
  git commit -m "feat(assistant): useDocumentDraft 新增 sendMessage/stop/resumeInterrupt"
  ```

---

## Task 8: 扩展 `useDocumentDraft` — 消息队列集成

**Files:**
- Modify: `app/composables/useDocumentDraft.ts`
- Modify: `tests/client/composables/useDocumentDraft.extensions.test.ts`

**复用说明**：复用 `chatQueueActions` 的 `QueueItem` 类型和 `QUEUE_MAX_SIZE` 常量（保证和小索的队列行为一致）；**不复用** `enqueueAction / removeAction / clearAction` 纯函数（它们以 `Map<sessionId, items[]>` 为入参，单 session 场景套用 Map 反而笨拙），直接对 `ref<QueueItem[]>` 做不可变更新。

- [ ] **Step 1: 写失败测试**

  ```ts
  describe('useDocumentDraft queue', () => {
    it('enqueueMessage adds to currentQueue and returns true under capacity', () => {
      const draft = useDocumentDraft()
      const ok = draft.enqueueMessage('请把甲方填为张三')
      expect(ok).toBe(true)
      expect(draft.currentQueue.value).toHaveLength(1)
    })

    it('enqueueMessage returns false when queue full', () => {
      const draft = useDocumentDraft()
      for (let i = 0; i < 5; i++) draft.enqueueMessage(`msg-${i}`)
      expect(draft.enqueueMessage('overflow')).toBe(false)
      expect(draft.currentQueue.value).toHaveLength(5)
    })

    it('removeQueueItem removes by id', () => {
      const draft = useDocumentDraft()
      draft.enqueueMessage('a')
      const id = draft.currentQueue.value[0]!.id
      draft.removeQueueItem(id)
      expect(draft.currentQueue.value).toHaveLength(0)
    })

    it('clearQueue empties', () => {
      const draft = useDocumentDraft()
      draft.enqueueMessage('a')
      draft.clearQueue()
      expect(draft.currentQueue.value).toHaveLength(0)
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  Expected: FAIL —— queue API 不存在

- [ ] **Step 3: 实现队列**

  ```ts
  import { nanoid } from 'nanoid'
  import { QUEUE_MAX_SIZE, type QueueItem } from './chatQueueActions'

  const currentQueue = ref<QueueItem[]>([])
  const isQueuePaused = ref(false)
  const queuePauseReason = ref<'stopped' | 'failed' | null>(null)

  function enqueueMessage(text: string): boolean {
      if (currentQueue.value.length >= QUEUE_MAX_SIZE) return false
      currentQueue.value = [...currentQueue.value, {
          id: nanoid(),
          text,
          thinking: false,
          enqueuedAt: Date.now(),
      }]
      return true
  }

  function removeQueueItem(id: string) {
      currentQueue.value = currentQueue.value.filter(i => i.id !== id)
  }

  function clearQueue() {
      currentQueue.value = []
  }

  function resumeQueue() {
      isQueuePaused.value = false
      queuePauseReason.value = null
      dispatchNextIfReady()
  }

  // 当 stream 空闲且队列不空 → 派发下一条
  function dispatchNextIfReady() {
      if (isQueuePaused.value) return
      if (!stream.value || stream.value.isLoading.value) return
      const head = currentQueue.value[0]
      if (!head) return
      currentQueue.value = currentQueue.value.slice(1)
      sendMessage(head.text)
  }

  // 监听 stream 状态变化：空闲时派发下一条；失败时暂停
  watch(
      () => stream.value?.runStatus.value,
      (status) => {
          if (status === 'failed') {
              isQueuePaused.value = true
              queuePauseReason.value = 'failed'
          } else if (status === 'cancelled') {
              isQueuePaused.value = true
              queuePauseReason.value = 'stopped'
          } else if (status === 'completed') {
              dispatchNextIfReady()
          }
      },
  )
  ```

  在 return 里暴露：`currentQueue, isQueuePaused, queuePauseReason, enqueueMessage, removeQueueItem, clearQueue, resumeQueue`。

- [ ] **Step 4: 运行通过**

  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add app/composables/useDocumentDraft.ts tests/client/composables/useDocumentDraft.extensions.test.ts
  git commit -m "feat(assistant): useDocumentDraft 集成消息队列 (单 session)"
  ```

---

## Task 9: 工作区页面骨架 `/dashboard/document/drafts/[id].vue`

**Files:**
- Create: `app/pages/dashboard/document/drafts/[id].vue`

先做骨架：加载 draft + template、左表单 / 右预览布局、顶部返回 + 导出按钮。Agent 窗和 AI 生成按钮下一 Task 加。

- [ ] **Step 1: 创建文件（骨架）**

  ```vue
  <script setup lang="ts">
  /**
   * 文书草稿工作区
   *
   * 路由：/dashboard/document/drafts/:id
   * 功能：加载已有草稿 + 模板，左表单（手填）/ 右预览（实时），顶部可导出 .docx
   */
  import { ArrowLeftIcon, Loader2Icon, SparklesIcon, DownloadIcon } from 'lucide-vue-next'

  definePageMeta({
      layout: 'dashboard-layout',
      title: '文书草稿',
  })

  const route = useRoute()
  const draftId = computed(() => Number(route.params.id))

  const {
      draft,
      template,
      runStatus,
      isLoading,
      error,
      onFieldChange,
      onExport,
      mountDraft,
  } = useDocumentDraft()

  const loading = ref(true)
  const loadError = ref<string | null>(null)

  onMounted(async () => {
      if (!Number.isFinite(draftId.value) || draftId.value <= 0) {
          loadError.value = '草稿 ID 无效'
          loading.value = false
          return
      }
      try {
          await mountDraft(draftId.value)
          if (!draft.value) loadError.value = '草稿不存在或已被删除'
      } catch (e) {
          loadError.value = e instanceof Error ? e.message : '加载草稿失败'
      } finally {
          loading.value = false
      }
  })

  const currentValues = computed(() => (draft.value?.values ?? {}) as Record<string, string | null>)
  const suggestions = computed(() => {
      const metadata = draft.value?.metadata as { suggestions?: Record<string, string> } | null | undefined
      return metadata?.suggestions
  })
  const exportDisabled = computed(() => runStatus.value !== 'ready' && runStatus.value !== 'exported')

  // 模板 buffer（用于 docx-preview）
  const templateBuffer = ref<ArrayBuffer | null>(null)
  let fetchSeq = 0
  watch(template, async (tpl) => {
      if (!tpl) { templateBuffer.value = null; return }
      const seq = ++fetchSeq
      const result = await useApiFetch<{ downloadUrl: string }>(
          `/api/v1/assistant/document/templates/download-url/${tpl.id}`,
          { showError: false } as any,
      )
      if (seq !== fetchSeq || !result?.downloadUrl) return
      const resp = await fetch(result.downloadUrl)
      if (seq !== fetchSeq || !resp.ok) return
      templateBuffer.value = await resp.arrayBuffer()
  })

  function goBack() {
      navigateTo('/dashboard/document')
  }
  </script>

  <template>
      <div class="p-4 md:p-6 flex flex-col gap-4" style="height: calc(100vh - 48px)">
          <!-- 顶部 -->
          <header class="flex items-center justify-between gap-4 flex-wrap">
              <div class="flex items-center gap-2 min-w-0">
                  <Button variant="ghost" size="sm" @click="goBack">
                      <ArrowLeftIcon class="size-4 mr-1" />
                      返回
                  </Button>
                  <h1 v-if="template" class="text-lg md:text-xl font-semibold truncate">
                      {{ template.name }}
                      <span v-if="draft?.caseId" class="text-sm text-muted-foreground ml-2">· 案件 #{{ draft.caseId }}</span>
                  </h1>
              </div>
              <div class="flex items-center gap-2">
                  <!-- AI 生成按钮 占位（Task 10 接入）-->
                  <Button :disabled="exportDisabled || isLoading" @click="onExport">
                      <DownloadIcon class="size-4 mr-2" />
                      导出 .docx
                  </Button>
              </div>
          </header>

          <!-- 加载 / 错误 -->
          <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground">
              <Loader2Icon class="size-6 animate-spin mr-2" /> 加载中...
          </div>
          <div v-else-if="loadError" class="flex-1 flex items-center justify-center text-destructive">
              {{ loadError }}
          </div>

          <!-- 主体：左右分栏 -->
          <div v-else-if="draft && template" class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden">
              <div class="min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
                  <h2 class="text-sm font-medium text-muted-foreground mb-3">编辑字段</h2>
                  <AssistantDocumentFieldForm
                      :template="template"
                      :values="currentValues"
                      :suggestions="suggestions"
                      @change="onFieldChange"
                  />
              </div>
              <div class="min-h-0 overflow-y-auto rounded-lg border bg-card p-4">
                  <AssistantDocumentPreview
                      :template-buffer="templateBuffer"
                      :values="currentValues"
                      :disabled="exportDisabled || isLoading"
                      @export="onExport"
                  />
              </div>
          </div>
      </div>
  </template>
  ```

- [ ] **Step 2: 类型检查通过**

  `npx nuxi typecheck 2>&1 | grep drafts/\\[id\\]`
  Expected: 无错误

- [ ] **Step 3: 手工验证**

  启动 dev server，浏览器访问 `/dashboard/document/drafts/<已存在草稿 id>`，确认：
  - 顶部返回 + 标题 + 导出按钮出现
  - 左右分栏加载草稿 values 到表单、预览显示模板内容
  - 编辑某个字段触发 debounce PATCH（Network 看到 `PATCH /drafts/:id`）
  - 预览占位符正确替换（#7 修完后）

- [ ] **Step 4: Commit**

  ```bash
  git add app/pages/dashboard/document/drafts/[id].vue
  git commit -m "feat(assistant): 新增文书草稿工作区页面 (左表单+右预览)"
  ```

---

## Task 10: 工作区 — 悬浮 Agent 窗 + AI 生成按钮

**Files:**
- Modify: `app/pages/dashboard/document/drafts/[id].vue`

- [ ] **Step 1: 补全工作区组件**

  在 `<script setup>` 里补充队列 / 中断 / 对话状态的 unwrap：
  ```ts
  import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'

  const {
      // ...已有解构
      stream,
      sendMessage,
      stopGeneration,
      resumeInterrupt,
      interruptData,
      isInterrupted,
      currentQueue,
      isQueuePaused,
      queuePauseReason,
      enqueueMessage,
      removeQueueItem,
      clearQueue,
      resumeQueue,
  } = useDocumentDraft()

  const chatMessages = computed(() => stream.value?.messages.value ?? [])
  const chatLoading = computed(() => !!stream.value?.isLoading.value)
  const queueLen = computed(() => currentQueue.value.length)
  const queueFull = computed(() => queueLen.value >= QUEUE_MAX_SIZE)

  const agentOpen = ref(false)
  const isStopping = ref(false)

  // 材料选择（Task 11 补引用）
  const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)
  const promptInputRef = ref<{ addFiles: (files: unknown[]) => void; selectedFileIds: number[] } | null>(null)

  function openAgent() { agentOpen.value = true }
  function openMaterialSelector() { materialSelectorRef.value?.openDialog() }
  function handleFilesFromSelector(files: unknown[]) { promptInputRef.value?.addFiles(files) }

  function handleChatSubmit(data: { text: string; files?: unknown[] }) {
      if (!data.text.trim() && !data.files?.length) return
      const shouldEnqueue = chatLoading.value || isQueuePaused.value
      if (shouldEnqueue) {
          const ok = enqueueMessage(data.text)
          if (!ok) toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条）`)
      } else {
          sendMessage(data.text)
      }
  }

  async function handleStop() {
      if (isStopping.value || !chatLoading.value) return
      isStopping.value = true
      try { await stopGeneration() } finally { isStopping.value = false }
  }

  useInterruptToast(interruptData)
  ```

  顶部再 `import { toast } from 'vue-sonner'`。

- [ ] **Step 2: 补模板**

  在顶部按钮区，导出前加：
  ```vue
  <Button variant="default" @click="openAgent">
      <SparklesIcon class="size-4 mr-2" />
      ✨ AI 生成
  </Button>
  ```

  在文件最外层 `<template>` 底部（和主体 grid 同级）加：
  ```vue
  <!-- 悬浮 Agent 窗 -->
  <CaseChatWindowShell
      v-model:open="agentOpen"
      title="文书 AI 助手"
      :initial-width="420"
      :initial-height="560"
  >
      <AiChat
          :messages="chatMessages"
          :loading="chatLoading"
          :is-interrupted="isInterrupted"
          :enable-file-upload="true"
          :queue-length="queueLen"
          :queue-full="queueFull"
          :is-stopping="isStopping"
          prompt-placeholder="告诉 AI 你想怎么填..."
          :show-header="false"
          panel-mode="left"
          :on-file-button-click="openMaterialSelector"
          @submit="handleChatSubmit"
          @stop="handleStop"
      >
          <template #prompt-actions>
              <AiChatQueueChips
                  :queue="currentQueue"
                  :max="QUEUE_MAX_SIZE"
                  :paused="isQueuePaused"
                  :pause-reason="queuePauseReason"
                  @remove="removeQueueItem"
                  @resume="resumeQueue"
                  @clear="clearQueue"
              />
          </template>
      </AiChat>
  </CaseChatWindowShell>

  <!-- 中断确认 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
      <DialogContent class="sm:max-w-2xl max-h-[95vh] overflow-y-auto p-0 z-[70]" overlay-class="z-[70]" :show-close-button="false">
          <DialogHeader class="sr-only">
              <DialogTitle>需要您的确认</DialogTitle>
              <DialogDescription>请查看并回应 AI 的请求</DialogDescription>
          </DialogHeader>
          <div v-if="interruptData" class="p-6">
              <CaseInterruptConfirmation :interrupt="interruptData" @submit="resumeInterrupt" @cancel="() => {}" />
          </div>
      </DialogContent>
  </Dialog>
  ```

- [ ] **Step 3: 类型检查**

  `npx nuxi typecheck 2>&1 | tail -30`
  Expected: 无错误

- [ ] **Step 4: 手工验证**

  浏览器访问工作区页 → 点 "✨ AI 生成" → 悬浮窗出现 → 发送消息 → 看到 AiChat 消息流出；关闭弹窗 → 再打开仍保留历史消息；队列 chips 在连续输入时出现。

- [ ] **Step 5: Commit**

  ```bash
  git add app/pages/dashboard/document/drafts/[id].vue
  git commit -m "feat(assistant): 工作区接入悬浮 Agent 窗 + 队列/中断"
  ```

---

## Task 11: 工作区 — 材料弹框集成（照抄 cases/create.vue）

**背景**：`app/components/ai/AiChat.vue` 当前未透传 `onFileButtonClick` 给内部 `AiPromptInput`，也未通过 `defineExpose` 暴露 `selectedFileIds / addFiles`。需要小幅扩展 AiChat 接口（不改原有行为）后，才能照抄 `cases/create.vue` 的模式。

### Task 11.1 — 扩展 `AiChat` 接口（前置）

**Files:**
- Modify: `app/components/ai/AiChat.vue`
- Test: `tests/client/components/AiChat.props.test.ts`

- [ ] **Step 1: 写失败测试**

  ```ts
  import { mount } from '@vue/test-utils'
  import { describe, it, expect, vi } from 'vitest'
  import AiChat from '~/components/ai/AiChat.vue'

  describe('AiChat file-button integration', () => {
    it('passes onFileButtonClick to internal AiPromptInput', async () => {
      const handler = vi.fn()
      const wrapper = mount(AiChat, {
        props: { messages: [], enableFileUpload: true, onFileButtonClick: handler, panelMode: 'left' },
      })
      // 文件按钮通过 Paperclip icon 定位（AiPromptInput 内部的上传按钮）
      const fileBtn = wrapper.find('button:has(.lucide-paperclip)')
      expect(fileBtn.exists()).toBe(true)
      await fileBtn.trigger('click')
      expect(handler).toHaveBeenCalled()
    })

    it('exposes selectedFileIds and addFiles via ref', async () => {
      const wrapper = mount(AiChat, { props: { messages: [], enableFileUpload: true, panelMode: 'left' } })
      const vm = wrapper.vm as unknown as { selectedFileIds: number[]; addFiles: (f: unknown[]) => void }
      expect(Array.isArray(vm.selectedFileIds)).toBe(true)
      expect(typeof vm.addFiles).toBe('function')
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  `npx vitest run tests/client/components/AiChat.props.test.ts --reporter=verbose`
  Expected: FAIL

- [ ] **Step 3: 最小扩展 AiChat**

  在 `app/components/ai/AiChat.vue`：

  1. `interface Props` 增加 `onFileButtonClick?: () => void`
  2. 两处 `<AiPromptInput ...>` 标签追加 `:on-file-button-click="onFileButtonClick"`
  3. `defineExpose` 扩展：
     ```ts
     defineExpose({
         resetPrompt() { promptInputRef.value?.reset() },
         addFiles(files: unknown[]) { (promptInputRef.value as any)?.addFiles(files) },
         get selectedFileIds(): number[] { return (promptInputRef.value as any)?.selectedFileIds ?? [] },
     })
     ```

  > 不改 `AiPromptInput.vue`（已有 `onFileButtonClick` prop + `defineExpose` 的 `addFiles/selectedFileIds`），只在 AiChat 层做透传。

- [ ] **Step 4: 运行通过**

  Expected: PASS

- [ ] **Step 5: 现有调用方回归**

  `npx vitest run tests/client/components --reporter=verbose`
  确认 `AssistantChatPanel / CaseDetailXiaosuo` 等依赖 AiChat 的测试不回归。

- [ ] **Step 6: Commit**

  ```bash
  git add app/components/ai/AiChat.vue tests/client/components/AiChat.props.test.ts
  git commit -m "feat(ai): AiChat 透传 onFileButtonClick + 暴露 selectedFileIds/addFiles"
  ```

### Task 11.2 — 工作区集成材料选择弹框（照抄 cases/create.vue）

**Files:**
- Modify: `app/pages/dashboard/document/drafts/[id].vue`

- [ ] **Step 1: 照抄 create.vue 的 ref + 事件处理**

  在 `<script setup>` 里确认（Task 10 已加但此处明确化）：
  ```ts
  // 对照 app/pages/dashboard/cases/create.vue:134-138
  const materialSelectorRef = ref<{ openDialog: () => void } | null>(null)
  const aiChatRef = ref<{ addFiles: (f: unknown[]) => void; selectedFileIds: number[] } | null>(null)

  function openMaterialSelector() { materialSelectorRef.value?.openDialog() }
  function handleFilesFromSelector(files: unknown[]) { aiChatRef.value?.addFiles(files) }
  const selectedFileIds = computed(() => aiChatRef.value?.selectedFileIds ?? [])
  ```

- [ ] **Step 2: 悬浮窗内 AiChat 挂 ref + 传 onFileButtonClick**

  在 Task 10 的 `<AiChat ...>` 上加 `ref="aiChatRef"` 和 `:on-file-button-click="openMaterialSelector"`（若 Task 10 未加则此时补）。

- [ ] **Step 3: 工作区页面追加 CaseAnalysisMaterialSelector**

  在 Dialog 同级追加（对照 `cases/create.vue:32-36`）：
  ```vue
  <CaseAnalysisMaterialSelector
      ref="materialSelectorRef"
      :disabled-file-ids="selectedFileIds"
      @files-selected="handleFilesFromSelector"
  />
  ```

- [ ] **Step 4: 文件类型过滤（对应用户追加约束 C1）**

  **必须**先 Read `app/components/caseAnalysis/materialSelector.vue` 查 `fileTypeOptions` 数组，列出当前默认支持的扩展名清单。

  判断：
  - 若**完全匹配**"案件材料类型"——本 step 无需改动
  - 若**更宽**（例如包含文书场景不需要的类型）——给 `materialSelector.vue` 增加可选 prop `:accept-file-types?: string[]`，在工作区传入精确白名单（`['.docx', '.pdf', '.txt']`），**不改组件内部默认值**

  将 Read 结果和判断结论写进本 step 的 commit message 或实施报告中，留痕可追溯。

- [ ] **Step 5: 手工验证**

  工作区 → 点 "✨ AI 生成" → 点 prompt 区的文件按钮 → 弹框出现 → 选文件 → 关闭 → 文件 chip 出现在 prompt 输入框 → 发送消息 → Network 看到 sourceFileIds 被带入（或后续 AI 引用）。

- [ ] **Step 6: Commit**

  ```bash
  git add app/pages/dashboard/document/drafts/[id].vue app/components/caseAnalysis/materialSelector.vue
  git commit -m "feat(assistant): 工作区集成材料选择弹框 (照抄 cases/create.vue)"
  ```

---

## Task 12: 首页改版 — 新建 + 我的草稿列表

**Files:**
- Create: `app/components/assistant/document/DraftList.vue`
- Modify: `app/pages/dashboard/document/index.vue`
- Test: `tests/client/components/DraftList.test.ts`

### Task 12.1 — DraftList 组件

- [ ] **Step 1: 写失败测试**

  `tests/client/components/DraftList.test.ts`：
  ```ts
  import { mount, flushPromises } from '@vue/test-utils'
  import { describe, it, expect, vi } from 'vitest'
  import DraftList from '~/components/assistant/document/DraftList.vue'

  const mockFetch = vi.fn()
  vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
  }))

  const rows = [
    { id: 1, templateId: 7, caseId: null, status: 'ready', updatedAt: '2026-04-18T00:00:00Z' },
    { id: 2, templateId: 8, caseId: 7, status: 'exported', updatedAt: '2026-04-17T10:00:00Z' },
  ]

  describe('DraftList', () => {
    it('renders draft rows after mount with template id fallback', async () => {
      mockFetch.mockResolvedValueOnce({ items: rows, total: 2, skip: 0, take: 10 })
      const wrapper = mount(DraftList)
      await flushPromises()
      // 后端暂未返回 templateName，前端 fallback 显示 "模板 #ID"
      expect(wrapper.text()).toContain('模板 #7')
      expect(wrapper.text()).toContain('模板 #8')
    })

    it('calls DELETE API when delete button clicked', async () => {
      mockFetch.mockResolvedValueOnce({ items: rows, total: 2, skip: 0, take: 10 })
      const wrapper = mount(DraftList)
      await flushPromises()
      vi.stubGlobal('confirm', () => true)
      mockFetch.mockResolvedValueOnce(null) // DELETE
      mockFetch.mockResolvedValueOnce({ items: [rows[1]], total: 1, skip: 0, take: 10 }) // reload
      await wrapper.findAll('button').find(b => b.text().includes('Trash') || b.attributes('aria-label')?.includes('删除'))?.trigger('click')
      await flushPromises()
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/assistant/document/drafts/1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })
  ```

- [ ] **Step 2: 运行确认失败**

  Expected: FAIL —— 组件不存在

- [ ] **Step 3: 实现 DraftList**

  `app/components/assistant/document/DraftList.vue`：
  ```vue
  <script setup lang="ts">
  import { FileTextIcon, Loader2Icon, Trash2Icon } from 'lucide-vue-next'
  import { toast } from 'vue-sonner'

  interface DraftRow {
      id: number
      templateId: number
      templateName?: string
      caseId: number | null
      status: string
      updatedAt: string
  }

  const { formatDate } = useFormatters()

  const loading = ref(false)
  const drafts = ref<DraftRow[]>([])
  const pagination = ref({ page: 1, pageSize: 10, total: 0 })

  async function loadDrafts() {
      loading.value = true
      try {
          const skip = (pagination.value.page - 1) * pagination.value.pageSize
          const result = await useApiFetch<{ items: DraftRow[]; total: number }>(
              '/api/v1/assistant/document/drafts',
              { query: { skip, take: pagination.value.pageSize } },
          )
          if (result) {
              drafts.value = result.items
              pagination.value.total = result.total
          }
      } finally {
          loading.value = false
      }
  }

  onMounted(loadDrafts)

  async function handleDelete(row: DraftRow) {
      if (!confirm(`确认删除草稿 "${row.templateName ?? row.id}"？删除后无法恢复。`)) return
      const ok = await useApiFetch(`/api/v1/assistant/document/drafts/${row.id}`, { method: 'DELETE' })
      if (ok) {
          toast.success('已删除')
          loadDrafts()
      }
  }

  function openDraft(row: DraftRow) {
      navigateTo(`/dashboard/document/drafts/${row.id}`)
  }

  function changePage(page: number) {
      pagination.value.page = page
      loadDrafts()
  }

  const statusLabel = (s: string) => ({
      pending: '生成中', filling: '生成中', ready: '可编辑', exported: '已导出', failed: '失败',
  })[s] ?? s
  </script>

  <template>
      <div class="space-y-3">
          <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">我的草稿</h2>
          </div>
          <div v-if="loading" class="flex justify-center py-8">
              <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
          </div>
          <div v-else-if="!drafts.length" class="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FileTextIcon class="size-8 mb-2 opacity-40" />
              <p class="text-sm">还没有草稿，从上方选一个模板开始</p>
          </div>
          <div v-else class="rounded-md border">
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>模板</TableHead>
                          <TableHead class="w-[120px]">关联案件</TableHead>
                          <TableHead class="w-[100px]">状态</TableHead>
                          <TableHead class="w-[160px]">更新时间</TableHead>
                          <TableHead class="w-[140px] text-right">操作</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      <TableRow v-for="row in drafts" :key="row.id">
                          <TableCell class="font-medium">{{ row.templateName ?? `模板 #${row.templateId}` }}</TableCell>
                          <TableCell>{{ row.caseId ? `#${row.caseId}` : '—' }}</TableCell>
                          <TableCell>{{ statusLabel(row.status) }}</TableCell>
                          <TableCell class="text-sm text-muted-foreground">{{ formatDate(row.updatedAt) }}</TableCell>
                          <TableCell class="text-right">
                              <Button variant="ghost" size="sm" @click="openDraft(row)">进入</Button>
                              <Button variant="ghost" size="sm" @click="handleDelete(row)">
                                  <Trash2Icon class="size-4" />
                              </Button>
                          </TableCell>
                      </TableRow>
                  </TableBody>
              </Table>
          </div>
          <GeneralPagination
              v-if="drafts.length"
              :current-page="pagination.page"
              :page-size="pagination.pageSize"
              :total="pagination.total"
              @change="changePage"
          />
      </div>
  </template>
  ```

- [ ] **Step 4: 运行测试通过**

  `npx vitest run tests/client/components/DraftList.test.ts --reporter=verbose`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add app/components/assistant/document/DraftList.vue tests/client/components/DraftList.test.ts
  git commit -m "feat(assistant): 新增 DraftList 组件 (分页 + 删除)"
  ```

### Task 12.2 — 首页 index.vue 改版

**Files:**
- Modify: `app/pages/dashboard/document/index.vue`

- [ ] **Step 1: 重写页面**

  ```vue
  <script setup lang="ts">
  /**
   * 文书生成首页
   *
   * 顶部：选模板立即创建草稿并跳工作区
   * 下方：我的草稿列表
   */
  import { SettingsIcon } from 'lucide-vue-next'
  import { toast } from 'vue-sonner'

  definePageMeta({
      layout: 'dashboard-layout',
      title: '文书生成',
      icon: 'FileText',
  })

  async function handleTemplateSelect(templateId: number) {
      const result = await useApiFetch<{ draftId: number; sessionId: string }>(
          '/api/v1/assistant/document/drafts',
          { method: 'POST', body: { templateId } },
      )
      if (!result) return
      navigateTo(`/dashboard/document/drafts/${result.draftId}`)
  }

  function goManageTemplates() {
      navigateTo('/dashboard/document/templates')
  }
  </script>

  <template>
      <div class="p-4 md:p-6 space-y-6">
          <header class="flex items-center justify-between flex-wrap gap-2">
              <div>
                  <h1 class="text-2xl md:text-3xl font-bold mb-1">文书生成</h1>
                  <p class="text-muted-foreground text-sm">选择模板创建草稿，或从下方继续未完成的草稿</p>
              </div>
              <Button variant="outline" size="sm" @click="goManageTemplates">
                  <SettingsIcon class="size-4 mr-2" />
                  管理我的模板
              </Button>
          </header>

          <section class="rounded-lg border bg-card p-4">
              <h2 class="text-lg font-semibold mb-3">新建文书</h2>
              <AssistantDocumentTemplatePicker @select="handleTemplateSelect" />
          </section>

          <AssistantDocumentDraftList />
      </div>
  </template>
  ```

- [ ] **Step 2: 类型检查**

  Expected: 无错误

- [ ] **Step 3: 手工验证**

  访问 `/dashboard/document`：
  - 顶部模板选择器 + 管理按钮
  - 点选模板 → POST /drafts → 跳工作区 `/dashboard/document/drafts/:id`
  - 返回首页后 "我的草稿" 里出现刚建的那条

- [ ] **Step 4: Commit**

  ```bash
  git add app/pages/dashboard/document/index.vue
  git commit -m "feat(assistant): 首页改版 (新建模板 + 我的草稿列表)"
  ```

---

## Task 13: E2E 核心链路测试

**Files:**
- Create: `tests/e2e/document-draft-workflow.spec.ts`

聚焦核心链路「多轮修改」这一原始需求（#1），**不覆盖 AI 回复**（依赖 LLM 响应速度不稳）。AI 窗口只验证"能打开 + 能发出请求"。

- [ ] **Step 1: 写 Playwright 场景**

  ```ts
  import { test, expect } from '@playwright/test'

  test.describe('文书生成核心链路', () => {
    test('选模板 → 建草稿 → 手填 → 退出 → 回来 → 字段仍在 → 导出可用', async ({ page, login }) => {
      await login()

      // 1. 首页选模板
      await page.goto('/dashboard/document')
      const firstTemplate = page.locator('button:has(.lucide-file-text)').first()
      await firstTemplate.click()

      // 2. 跳转工作区
      await expect(page).toHaveURL(/\/dashboard\/document\/drafts\/\d+/)
      await expect(page.getByText('编辑字段')).toBeVisible()
      const workspaceUrl = page.url()

      // 3. 手填一个字段
      const firstField = page.locator('input, textarea').first()
      await firstField.fill('张三')
      // 等 debounce 500ms + PATCH 落库
      await page.waitForTimeout(800)

      // 4. 退出到首页
      await page.getByRole('button', { name: '返回' }).click()
      await expect(page).toHaveURL('/dashboard/document')

      // 5. "我的草稿" 里出现刚建的那条
      await expect(page.getByText('我的草稿')).toBeVisible()
      await page.getByRole('button', { name: '进入' }).first().click()
      await expect(page).toHaveURL(workspaceUrl)

      // 6. 字段值仍在（多轮修改的关键验证）
      await expect(page.locator('input, textarea').first()).toHaveValue('张三')

      // 7. AI 窗可打开（不发消息，不等 AI 回复）
      await page.getByRole('button', { name: /AI 生成/ }).click()
      await expect(page.getByPlaceholder(/告诉 AI/)).toBeVisible()

      // 8. 导出按钮可用
      await expect(page.getByRole('button', { name: /导出 \.docx/ })).toBeVisible()
    })
  })
  ```

- [ ] **Step 2: 运行**

  `npx playwright test tests/e2e/document-draft-workflow.spec.ts --headed`
  Expected: PASS

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/document-draft-workflow.spec.ts
  git commit -m "test(assistant): 新增文书生成全链路 E2E"
  ```

---

## 完成标准（Definition of Done）

**代码与测试**
- [ ] `npx vitest run` 全绿
- [ ] `npx nuxi typecheck` 无错误
- [ ] `npx playwright test tests/e2e/document-draft-workflow.spec.ts` pass

**需求交付**
- [ ] 7 个原始问题全部 ✅（#1 多轮修改 / #2 材料弹框 / #3 手填入口 / #4 Agent 可见 / #5 分栏+悬浮 / #6 上传显示 / #7 预览占位符）
- [ ] 6 个追加约束全部 ✅（云盘类型过滤 / 单会话预留多会话 / 队列+中断 / bug 不预判 / 照抄 create.vue / 醒目 AI 按钮）

**回归（必须手工 + 自动化双验证）**
- [ ] 案件详情页文书 tab（`DocumentDraftPanel` 场景）：选模板 → 提供材料 → AI 填 → 导出 行为无回归
- [ ] `npx vitest run tests/client/components/assistant/DocumentDraftPanel` 通过
- [ ] `npx vitest run tests/server/assistant/document` 通过
