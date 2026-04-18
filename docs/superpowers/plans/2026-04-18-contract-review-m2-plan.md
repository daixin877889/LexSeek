# 合同审查 M2 实施 Plan（终稿）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **对应 Spec**: [`2026-04-17-contract-review-design.md`](../specs/2026-04-17-contract-review-design.md) §7 + §10 + §11 "M2 docx 子模块" 里程碑
>
> **前置**: M1 已完成并合并 dev（commit 45947c6）；`fast-xml-parser` v5.7.1 / `diff-match-patch` / `mammoth` / `jszip` 全部已装；`contractReviewMain` 节点 + `contractReview_system` 提示词已入 seedData.sql。
>
> **边界**: M2 只交付 docx 处理工具集，不做 agent / middleware / API / UI。任何 M3+ 代码一律延后。

---

## 0. 执行原则（本轮强制约束）

1. **复用现有基建，不重复造轮子**
   - `server/services/material/docxRecognition.service.ts:122` 已有 `mammoth.convertToMarkdown` 用法；本期 `parser.ts` 业务不同（要段落数组），允许独立实现但 mammoth buffer 初始化参数参考既有写法
   - `getValidNodeConfig('contractReviewMain')` + `createChatModel` 组合是 partyDetector LLM 兜底的唯一入口，**禁止重新造模型调用路径**
   - `buildRiskSchema` / `reviewResultPersistence.middleware.ts` 本期**不做**（M3 任务）
2. **不做当前里程碑没有消费方的提前设计**
   - 不创建 `server/services/workflow/agents/contractReviewMainAgent.ts`
   - 不创建 `server/services/workflow/tools/parseAndAskStance.tool.ts`
   - 不扩展 `PromptRenderContext` / `ToolContext`
   - 不接入 `pointConsumptionMiddleware`
3. **xmlUtils 只做字符串级原语**
   - M2 的 XML 改动用字符串正则 / 拼接处理（commentInjector 的段落定位、appendChildXml 的片段追加），不引入 fast-xml-parser DOM round-trip 封装（规避 v5 对 Office XML 命名空间属性的已知边缘 case）
   - Task 2/6 的 XML 相关消费点只调 `appendChildXml` + `escapeXml` 两个字符串原语
4. **测试命令**：`npx vitest run`（**禁止 `bun test`**，Nuxt 自动导入仅 vitest 下可解析）
5. **不偏离原始主线**：M2 交付 = parser + partyDetector + commentInjector + zipRewriter + textToDocxService + 对应单测 + 覆盖率 ≥ 90%

---

## 1. 目标与非目标

### 1.1 Goal（与 spec §11 M2 一一对应）

完成以下 7 个交付物：

1. `server/services/assistant/contract/docx/xmlUtils.ts` — XML 字符串级原语（`appendChildXml` / `escapeXml`）
2. `server/services/assistant/contract/docx/zipRewriter.ts` — jszip 封装（`loadDocxZip` / `readTextFromZip` / `writeTextToZip` / `zipToBuffer`）
3. `server/services/assistant/contract/docx/parser.ts` — mammoth 段落提取（返回 `{ paragraphs: string[] }`）
4. `server/services/assistant/contract/docx/partyDetector.ts` — 正则 + LLM 兜底识别甲乙方、合同类型
5. `server/services/assistant/contract/docx/commentInjector.ts` — 按 spec §10.1 **四处** XML 改动（document.xml / 新建 comments.xml / [Content_Types].xml / _rels/document.xml.rels）注入 Word 原生批注
6. `server/services/assistant/contract/textToDocx.service.ts` — 纯文本 → 最小合规 .docx Buffer
7. `server/services/assistant/contract/docx/index.ts` — 模块 barrel 导出

配套测试（路径对齐 `tests/server/assistant/document/`）：

- `tests/server/assistant/contract/docx/xmlUtils.test.ts`
- `tests/server/assistant/contract/docx/zipRewriter.test.ts`
- `tests/server/assistant/contract/docx/parser.test.ts`
- `tests/server/assistant/contract/docx/partyDetector.test.ts`
- `tests/server/assistant/contract/docx/commentInjector.test.ts`
- `tests/server/assistant/contract/textToDocx.test.ts`
- `tests/server/assistant/contract/docx/integration.test.ts`（5 份样本端到端冒烟）

### 1.2 本期明确不做

- **M3 的一切**：agent、parseAndAskStance 工具、reviewResultPersistence middleware、contractReview.service/dao、5 个 API 端点、`PromptRenderContext` / `ToolContext` 扩展
- **M4 / M5 的一切**：前端路由、组件、composable、diff-match-patch UI 渲染
- **Microsoft Word / WPS 人工验证**：spec §10.3 要求"至少 1 次人工验证"属于验收脱机步骤，不在自动化测试内。本 plan 最后一步给出人工验证清单，但人工验证不阻断 M2 自动化测试通过
- **`server/services/assistant/contract/` 目录以外的改动**（除 barrel 文件外）

---

## 2. 当前仓库基线（已核对）

| 条目 | 现状 |
|---|---|
| `fast-xml-parser` | 已装 `^5.7.1`（v5 API，与 v4 不同） |
| `jszip` | 已装 `^3.10.1` |
| `mammoth` | 已装 `^1.11.0`；既有用法 `server/services/material/docxRecognition.service.ts:122` `mammoth.convertToMarkdown({ buffer })` |
| `docx` 官方包 | **未装**（package.json 只有 `docx-preview` / `docxtemplater` / `html-docx-js-typescript` / `markdown-docx`） |
| `contractReviewMain` 节点 | M1 已在 `seedData.sql` 硬编码 `model_id=1`（deepseek-chat），`getValidNodeConfig('contractReviewMain')` 可用 |
| `createChatModel` 入口 | `server/services/node/chatModelFactory.ts:155` `createChatModel(config: ChatModelConfig): BaseChatModel` |
| `getValidNodeConfig` 入口 | `server/services/node/node.service.ts:453` |
| 5 份样本 .docx | M1 已入 `prisma/seeds/contract-samples/{labor,lease,sale,service,loan}.docx`；均含 `甲方：` / `乙方：` 标识；mammoth 可解 |
| 测试目录惯例 | `tests/server/assistant/document/` 有 `draftSchema.builder.test.ts` / `*.dao.test.ts` / `*.service.test.ts` / `*.api.test.ts` 多种命名 |
| 覆盖率工具 | `vitest.config.ts` 应有 c8/v8 provider（Task 7 verify）|

---

## 3. 文件变更清单

### 3.1 新建

源码（共 7 个）：

- `server/services/assistant/contract/docx/xmlUtils.ts`
- `server/services/assistant/contract/docx/zipRewriter.ts`
- `server/services/assistant/contract/docx/parser.ts`
- `server/services/assistant/contract/docx/partyDetector.ts`
- `server/services/assistant/contract/docx/commentInjector.ts`
- `server/services/assistant/contract/docx/index.ts`
- `server/services/assistant/contract/textToDocx.service.ts`

测试（共 7 个）：

- `tests/server/assistant/contract/docx/xmlUtils.test.ts`
- `tests/server/assistant/contract/docx/zipRewriter.test.ts`
- `tests/server/assistant/contract/docx/parser.test.ts`
- `tests/server/assistant/contract/docx/partyDetector.test.ts`
- `tests/server/assistant/contract/docx/commentInjector.test.ts`
- `tests/server/assistant/contract/docx/integration.test.ts`
- `tests/server/assistant/contract/textToDocx.test.ts`

### 3.2 修改

- 无

---

## 4. Task 1：`xmlUtils.ts` — XML 片段级字符串工具（TDD）

**Files:**
- Create: `server/services/assistant/contract/docx/xmlUtils.ts`
- Create: `tests/server/assistant/contract/docx/xmlUtils.test.ts`

### Why

- spec §10.1 的四处 XML 改动中，`[Content_Types].xml` 与 `word/_rels/document.xml.rels` 是**结构简单的 XML**，用字符串级追加比 DOM round-trip 更稳（fast-xml-parser v5 对 Office XML 的命名空间属性有已知边缘 case，容易丢 `xml:space="preserve"`）
- `word/document.xml` 与 `word/comments.xml` 由 commentInjector 直接用字符串正则扫描 `<w:p>...</w:p>`（Task 6 §9 Why 段会再解释）
- 因此 M2 **不引入 fast-xml-parser DOM 封装**；`xmlUtils.ts` 只提供两个字符串级原语：
  - `appendChildXml(xml, parentTag, fragment)` — 往父节点末尾追加片段
  - `escapeXml(input)` — 标准 5 字符转义（`& < > " '`），供 commentInjector / textToDocxService 共用（DRY）
- 如果未来 M3+ 真需要 DOM 级 XML 操作，再增加 parser 封装

### Steps

- [ ] **Step 1.1：先写测试**

`tests/server/assistant/contract/docx/xmlUtils.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { appendChildXml, escapeXml } from '~~/server/services/assistant/contract/docx/xmlUtils'

describe('xmlUtils', () => {
    it('appendChildXml 把片段字符串追加到父节点末尾', () => {
        const fragment =
            '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
        const input = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
</Types>`
        const out = appendChildXml(input, 'Types', fragment)
        expect(out).toContain('<Default Extension="xml"')
        expect(out).toContain('<Override PartName="/word/comments.xml"')
        expect(out.indexOf('<Default')).toBeLessThan(out.indexOf('<Override'))
        expect(out).toContain('</Types>')
    })

    it('appendChildXml 未找到父节点时抛错', () => {
        expect(() => appendChildXml('<root/>', 'NotExist', '<x/>')).toThrow('未找到父节点 </NotExist>')
    })

    it('escapeXml 正确转义 5 个特殊字符', () => {
        expect(escapeXml('a & b < c > d "e" \'f\'')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;')
    })

    it('escapeXml 保留普通中文与数字', () => {
        expect(escapeXml('甲方 123 年')).toBe('甲方 123 年')
    })
})
```

- [ ] **Step 1.2：实现**

`server/services/assistant/contract/docx/xmlUtils.ts`

```typescript
/**
 * docx XML 字符串级工具。
 *
 * M2 的 XML 改动（四处）分两类：
 * 1. 结构简单（[Content_Types].xml / word/_rels/document.xml.rels）→ 用 appendChildXml 字符串追加
 * 2. 结构复杂（word/document.xml / word/comments.xml）→ commentInjector 直接用字符串正则扫描 <w:p>
 *
 * 不引入 fast-xml-parser DOM round-trip，规避 v5 对 Office XML 命名空间属性的已知边缘 case。
 */

/**
 * 在 parentTag（最近的匹配标签）末尾追加一个 XML 片段字符串。
 *
 * 用途：
 * - 往 [Content_Types].xml 的 <Types> 追加 <Override>
 * - 往 word/_rels/document.xml.rels 的 <Relationships> 追加 <Relationship>
 *
 * 限制：parentTag 不带命名空间前缀；fragment 必须是合法 XML 片段
 */
export function appendChildXml(xml: string, parentTag: string, fragment: string): string {
    const closeTag = `</${parentTag}>`
    const idx = xml.lastIndexOf(closeTag)
    if (idx < 0) throw new Error(`未找到父节点 </${parentTag}>`)
    return `${xml.slice(0, idx)}${fragment}\n${xml.slice(idx)}`
}

/**
 * XML 5 字符标准转义：& < > " '
 *
 * 供 commentInjector 写批注文本、textToDocxService 写纯文本段落共用。
 */
export function escapeXml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}
```

- [ ] **Step 1.3：验证**

```bash
npx vitest run tests/server/assistant/contract/docx/xmlUtils.test.ts --reporter=verbose
npx nuxi typecheck
```

**Expected：** 4 case 全绿；typecheck 除已知 `DocumentDraftPanel.vue` 基线错误外 0 新 error。

- [ ] **Step 1.4：提交**

```bash
git add server/services/assistant/contract/docx/xmlUtils.ts tests/server/assistant/contract/docx/xmlUtils.test.ts
git commit -m "feat(contract): 新增 xmlUtils XML 片段级字符串工具"
```

---

## 5. Task 2：`zipRewriter.ts` — jszip 封装（TDD）

**Files:**
- Create: `server/services/assistant/contract/docx/zipRewriter.ts`
- Create: `tests/server/assistant/contract/docx/zipRewriter.test.ts`

### Why

- spec §7.2 明示"底层：在 JSZip 上操作目标文件，封装 readText/writeText 便于单测"
- commentInjector 需要读 `word/document.xml` / `[Content_Types].xml` / `word/_rels/document.xml.rels`、写 `word/comments.xml`、回写改动后再 generate Buffer
- 测试用 5 份样本 fixture 的真实 .docx buffer，不造假 zip

### Steps

- [ ] **Step 2.1：先写测试**

`tests/server/assistant/contract/docx/zipRewriter.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from '~~/server/services/assistant/contract/docx/zipRewriter'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

describe('zipRewriter (jszip 封装)', () => {
    it('loadDocxZip + readTextFromZip 读到 word/document.xml 且含 w:document 根节点', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        const xml = await readTextFromZip(zip, 'word/document.xml')
        expect(xml).toContain('<w:document')
        expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"')
    })

    it('writeTextToZip 新增文件 → generate 后 loadDocxZip 能读回', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        writeTextToZip(zip, 'word/comments.xml', '<?xml version="1.0"?><w:comments/>')
        const newBuf = await zipToBuffer(zip)
        const zip2 = await loadDocxZip(newBuf)
        expect(zip2.file('word/comments.xml')).not.toBeNull()
        const read = await readTextFromZip(zip2, 'word/comments.xml')
        expect(read).toContain('<w:comments/>')
    })

    it('writeTextToZip 覆盖既有文件', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        const original = await readTextFromZip(zip, '[Content_Types].xml')
        writeTextToZip(zip, '[Content_Types].xml', original.replace('</Types>', '<X/></Types>'))
        const newBuf = await zipToBuffer(zip)
        const zip2 = await loadDocxZip(newBuf)
        const read = await readTextFromZip(zip2, '[Content_Types].xml')
        expect(read).toContain('<X/>')
    })

    it('readTextFromZip 文件不存在时抛错', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        await expect(readTextFromZip(zip, 'not/exists.xml')).rejects.toThrow('zip 中不存在 not/exists.xml')
    })

    it('zipToBuffer 产出的 Buffer 可被 mammoth 解析（基本合法性）', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        const out = await zipToBuffer(zip)
        const mammoth = await import('mammoth')
        const { value } = await mammoth.default.extractRawText({ buffer: out })
        expect(value.length).toBeGreaterThan(0)
    })
})
```

- [ ] **Step 2.2：实现**

`server/services/assistant/contract/docx/zipRewriter.ts`

```typescript
/**
 * docx 底层 zip 读写封装。
 *
 * docx = ZIP + XML，commentInjector / parser 统一从此处操作 zip，不直接调 jszip。
 */
import JSZip from 'jszip'

export type DocxZip = JSZip

/** 从 docx Buffer 加载 JSZip 实例 */
export async function loadDocxZip(buffer: Buffer): Promise<DocxZip> {
    return await JSZip.loadAsync(buffer)
}

/** 读取 zip 内指定路径的文本（UTF-8） */
export async function readTextFromZip(zip: DocxZip, path: string): Promise<string> {
    const file = zip.file(path)
    if (!file) throw new Error(`zip 中不存在 ${path}`)
    return await file.async('string')
}

/** 写入（或覆盖）zip 内指定路径的文本文件 */
export function writeTextToZip(zip: DocxZip, path: string, content: string): void {
    zip.file(path, content)
}

/** 序列化 zip 为 Buffer（可上传 OSS 或写入响应） */
export async function zipToBuffer(zip: DocxZip): Promise<Buffer> {
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
```

- [ ] **Step 2.3：验证**

```bash
npx vitest run tests/server/assistant/contract/docx/zipRewriter.test.ts --reporter=verbose
```

**Expected：** 5 case 全绿。

- [ ] **Step 2.4：提交**

```bash
git add server/services/assistant/contract/docx/zipRewriter.ts tests/server/assistant/contract/docx/zipRewriter.test.ts
git commit -m "feat(contract): 新增 zipRewriter jszip 封装"
```

---

## 6. Task 3：`parser.ts` — mammoth 段落提取（TDD）

**Files:**
- Create: `server/services/assistant/contract/docx/parser.ts`
- Create: `tests/server/assistant/contract/docx/parser.test.ts`

### Why

- spec §7.2 要求 `parser.ts` 返回 `{ paragraphs: string[], rawXml: string }`
- `clauseIndex` 等于 `paragraphs` 数组索引（spec §10.4），commentInjector 按此索引定位第 N 个 `<w:p>`
- 5 份样本必须能被 parse，且段落数在合理范围（spec §12.2："mammoth 提段落数量 > 5 且 < 500"）

### Steps

- [ ] **Step 3.1：先写测试**

`tests/server/assistant/contract/docx/parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../../../prisma/seeds/contract-samples')

describe('parseContractDocx', () => {
    it.each(SAMPLES)('%s.docx 提取的段落数量在 (5, 500) 区间', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        expect(paragraphs.length).toBeGreaterThan(5)
        expect(paragraphs.length).toBeLessThan(500)
    })

    it.each(SAMPLES)('%s.docx paragraphs 首几段含甲乙方标识', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const joined = paragraphs.slice(0, 20).join('\n')
        expect(joined).toMatch(/甲方[：:]/)
        expect(joined).toMatch(/乙方[：:]/)
    })

    it('paragraphs 不含空段落（spec §10.4 空段落不加批注，parser 层也过滤）', async () => {
        const buf = await readFile(join(SAMPLE_DIR, 'labor.docx'))
        const { paragraphs } = await parseContractDocx(buf)
        for (const p of paragraphs) {
            expect(p.trim().length).toBeGreaterThan(0)
        }
    })

    it('rawXml 包含 w:document 根节点（供 commentInjector 后续读用）', async () => {
        const buf = await readFile(join(SAMPLE_DIR, 'labor.docx'))
        const { rawXml } = await parseContractDocx(buf)
        expect(rawXml).toContain('<w:document')
    })

    it('非 .docx Buffer 抛错', async () => {
        await expect(parseContractDocx(Buffer.from('not a docx'))).rejects.toThrow()
    })
})
```

- [ ] **Step 3.2：实现**

`server/services/assistant/contract/docx/parser.ts`

```typescript
/**
 * 合同 .docx 段落提取。
 *
 * 返回：
 * - paragraphs：非空段落文本数组，索引即 spec §10.4 定义的 clauseIndex
 * - rawXml：word/document.xml 原文，供 commentInjector 按顺序定位 <w:p>
 */
import mammoth from 'mammoth'
import { loadDocxZip, readTextFromZip } from './zipRewriter'

export interface ParsedContract {
    paragraphs: string[]
    rawXml: string
}

export async function parseContractDocx(buffer: Buffer): Promise<ParsedContract> {
    const { value: rawText } = await mammoth.extractRawText({ buffer })
    const paragraphs = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    const zip = await loadDocxZip(buffer)
    const rawXml = await readTextFromZip(zip, 'word/document.xml')

    return { paragraphs, rawXml }
}
```

> 说明：mammoth `extractRawText` 返回的 `value` 是按段落分隔的纯文本，用换行切分后过滤空段落即得 `paragraphs`。`rawXml` 从同一 Buffer 的 zip 中单独读出，保持 mammoth 与 zipRewriter 两条路径解耦，便于 commentInjector 的 XML 级操作。

- [ ] **Step 3.3：验证**

```bash
npx vitest run tests/server/assistant/contract/docx/parser.test.ts --reporter=verbose
```

**Expected：** 12 case 全绿（5 段落数 + 5 甲乙方 + 1 空段落 + 1 rawXml + 1 错误）

- [ ] **Step 3.4：提交**

```bash
git add server/services/assistant/contract/docx/parser.ts tests/server/assistant/contract/docx/parser.test.ts
git commit -m "feat(contract): 新增 parser mammoth 段落提取"
```

---

## 7. Task 4：`partyDetector.ts` — 正则 + LLM 兜底（TDD）

**Files:**
- Create: `server/services/assistant/contract/docx/partyDetector.ts`
- Create: `tests/server/assistant/contract/docx/partyDetector.test.ts`

### Why

- spec §7.3 明示两路径：正则 → LLM 兜底 → null
- LLM 走 `getValidNodeConfig('contractReviewMain')` + `createChatModel`（M1 已落地该节点，model_id=1 deepseek-chat）
- spec §12.1 M2 要求"partyDetector 正则命中率 ≥ 80%"

### Steps

- [ ] **Step 4.1：先写测试**

`tests/server/assistant/contract/docx/partyDetector.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'
import { detectParties } from '~~/server/services/assistant/contract/docx/partyDetector'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../../../prisma/seeds/contract-samples')

// mock createChatModel 与 getValidNodeConfig，避免联网（vitest 自动 hoist vi.mock，不受 import 顺序影响）
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
}))

function mockContractReviewNodeConfig() {
    // NodeConfig 的字段结构严格对齐 server/services/node/node.service.ts 的 NodeConfig 接口；
    // 实现时若字段名不符（例如 modelSdkType 在真实接口里叫 sdkType），按真实签名调整，并同步本 mock
    vi.mocked(getValidNodeConfig).mockResolvedValue({
        id: 1,
        name: 'contractReviewMain',
        modelName: 'deepseek-chat',
        modelSdkType: 'openai',
        modelProviderBaseUrl: 'https://api.deepseek.com/v1',
        modelApiKeys: [{ apiKey: 'sk-xxx', status: 1 }],
        prompt: null,
    } as Awaited<ReturnType<typeof getValidNodeConfig>>)
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('detectParties (regex path)', () => {
    it.each(SAMPLES)('%s.docx 正则直接命中甲乙方（不调 LLM）', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const result = await detectParties(paragraphs)
        expect(result.partyA).not.toBeNull()
        expect(result.partyB).not.toBeNull()
        expect(result.source).toBe('regex')
        // 正则命中路径不应调 LLM（spec §7.3 明确行为）
        expect(createChatModel).not.toHaveBeenCalled()
    })

    it('5 份样本正则命中率 ≥ 80%（spec §12.1 硬要求）', async () => {
        let hit = 0
        for (const name of SAMPLES) {
            const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
            const { paragraphs } = await parseContractDocx(buf)
            const result = await detectParties(paragraphs)
            if (result.source === 'regex' && result.partyA && result.partyB) hit++
        }
        expect(hit / SAMPLES.length).toBeGreaterThanOrEqual(0.8)
    })
})

describe('detectParties (LLM fallback path)', () => {
    it('正则未命中时调 model，返回合法 JSON', async () => {
        mockContractReviewNodeConfig()
        const mockInvoke = vi.fn().mockResolvedValue({
            content: '{"partyA":"某科技公司","partyB":"张三","contractType":"咨询合同"}',
        })
        vi.mocked(createChatModel).mockReturnValue({ invoke: mockInvoke } as any)

        const paragraphs = ['合同正文', '约定双方合作事宜', '本合同一式两份。']
        const result = await detectParties(paragraphs)

        expect(result.partyA).toBe('某科技公司')
        expect(result.partyB).toBe('张三')
        expect(result.contractType).toBe('咨询合同')
        expect(result.source).toBe('llm')
        expect(mockInvoke).toHaveBeenCalled()
    })

    it('LLM 返回非法 JSON 时 partyA/partyB/contractType 置 null', async () => {
        mockContractReviewNodeConfig()
        vi.mocked(createChatModel).mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ content: '抱歉我不能识别' }),
        } as any)

        const result = await detectParties(['无甲乙方字样', '正文'])
        expect(result.partyA).toBeNull()
        expect(result.partyB).toBeNull()
        expect(result.contractType).toBeNull()
        expect(result.source).toBe('none')
    })

    it('LLM 抛错时 partyA/partyB/contractType 置 null（不阻塞整体流程，spec §13 R3）', async () => {
        mockContractReviewNodeConfig()
        vi.mocked(createChatModel).mockReturnValue({
            invoke: vi.fn().mockRejectedValue(new Error('network error')),
        } as any)

        const result = await detectParties(['无甲乙方字样', '正文'])
        expect(result.partyA).toBeNull()
        expect(result.partyB).toBeNull()
        expect(result.contractType).toBeNull()
        expect(result.source).toBe('none')
    })
})
```

- [ ] **Step 4.2：实现**

`server/services/assistant/contract/docx/partyDetector.ts`

```typescript
/**
 * 甲乙方与合同类型识别：先正则，后 LLM 兜底。
 *
 * 返回 source 字段指示命中路径，便于上层埋点与降级判断。
 */
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { getValidNodeConfig } from '~~/server/services/node/node.service'

export interface PartyDetectionResult {
    partyA: string | null
    partyB: string | null
    contractType: string | null
    source: 'regex' | 'llm' | 'none'
}

const PARTY_A_REGEX = /甲方[：:]\s*(.+?)(?:[\n。；]|$)/
const PARTY_B_REGEX = /乙方[：:]\s*(.+?)(?:[\n。；]|$)/

// prompt 内嵌的合同类型枚举为工程侧自决（spec §14 O6 提及合同类型由工程自决），不受 spec 硬约束
const LLM_PROMPT = `请从下面的合同前 1500 字中识别甲方名称、乙方名称、合同类型，以严格 JSON 输出：
{"partyA": "...", "partyB": "...", "contractType": "..."}

要求：
- 三个字段都必须存在
- 无法识别填 null
- 合同类型从 ["劳动合同","租赁合同","买卖合同","服务合同","借款合同","保密协议","其他"] 中选一个
- 只输出 JSON，不要任何解释文字

合同内容：
`

export async function detectParties(paragraphs: string[]): Promise<PartyDetectionResult> {
    const fullText = paragraphs.join('\n')

    // 1. 正则路径
    const matchA = PARTY_A_REGEX.exec(fullText)
    const matchB = PARTY_B_REGEX.exec(fullText)
    if (matchA && matchB) {
        return {
            partyA: matchA[1].trim(),
            partyB: matchB[1].trim(),
            contractType: null,
            source: 'regex',
        }
    }

    // 2. LLM 兜底（失败不抛错，降级为 none；对齐 spec §13 R3）
    try {
        const config = await getValidNodeConfig('contractReviewMain')
        // 严格对齐 server/services/workflow/agents/caseMainAgent.ts:87-95 的调用惯例：
        // - 字段路径从 config 扁平读取（modelSdkType / modelName / modelProviderBaseUrl）
        // - 先过滤 status=1 的可用 API key
        // - 若真实 NodeConfig 字段名略有出入，按 node.service.ts 的导出接口为准
        const activeKey = config.modelApiKeys.find((k) => k.status === 1)
        if (!activeKey) throw new Error('contractReviewMain 节点无可用 API 密钥（status=1）')

        const model = createChatModel({
            sdkType: config.modelSdkType,
            modelName: config.modelName,
            apiKey: activeKey.apiKey,
            baseUrl: config.modelProviderBaseUrl,
            temperature: 0,
        })
        const preview = fullText.slice(0, 1500)
        const response = await model.invoke(LLM_PROMPT + preview)
        const raw = typeof response.content === 'string' ? response.content : ''
        const jsonMatch = raw.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error('LLM 未返回 JSON')
        const parsed = JSON.parse(jsonMatch[0])
        return {
            partyA: parsed.partyA ?? null,
            partyB: parsed.partyB ?? null,
            contractType: parsed.contractType ?? null,
            source: 'llm',
        }
    } catch (_err) {
        return { partyA: null, partyB: null, contractType: null, source: 'none' }
    }
}
```

> `createChatModel` 签名见 `server/services/node/chatModelFactory.ts:27-42`（`ChatModelConfig` 含必填 `sdkType / modelName / apiKey` + 可选 `baseUrl`）。参考调用：`server/services/workflow/agents/caseMainAgent.ts:87-95`。实施时若 `NodeConfig` 接口的字段命名不完全吻合（例如 `modelSdkType` 真实叫 `sdkType`），按真实签名微调，同步更新测试 mock 的对象形状。

- [ ] **Step 4.3：验证**

```bash
npx vitest run tests/server/assistant/contract/docx/partyDetector.test.ts --reporter=verbose
```

**Expected：** 9 case 全绿（5 样本正则 + 1 命中率 + 3 LLM mock）

- [ ] **Step 4.4：提交**

```bash
git add server/services/assistant/contract/docx/partyDetector.ts tests/server/assistant/contract/docx/partyDetector.test.ts
git commit -m "feat(contract): 新增 partyDetector 正则+LLM 兜底识别"
```

---

## 8. Task 5：`textToDocx.service.ts` — 纯文本 → 最小 .docx（TDD）

**Files:**
- Create: `server/services/assistant/contract/textToDocx.service.ts`
- Create: `tests/server/assistant/contract/textToDocx.test.ts`

### Why

- spec §7.1 paste 源：`text: string` → `textToDocxService(text)` 生成最小 .docx（单段落纯文本，mammoth 可解）→ 上传 OSS
- spec §7.4："若项目未装 `docx` 库，直接用 jszip 手动构造"。当前仓库**未装** `docx` 包，走 jszip 手构
- 输出 Buffer 必须能被 mammoth 重新 parse（Task 3 的 parser 后续会消费）

### Steps

- [ ] **Step 5.1：先写测试**

`tests/server/assistant/contract/textToDocx.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import mammoth from 'mammoth'
import { textToDocxService } from '~~/server/services/assistant/contract/textToDocx.service'

describe('textToDocxService', () => {
    it('纯中文文本 → .docx → mammoth 重读内容一致', async () => {
        const text = '甲方：张三\n乙方：李四\n本合同签订于 2026 年 4 月。'
        const buf = await textToDocxService(text)
        expect(Buffer.isBuffer(buf)).toBe(true)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value).toContain('甲方：张三')
        expect(value).toContain('乙方：李四')
    })

    it('多段落文本按换行分段', async () => {
        const text = '段落一\n段落二\n段落三'
        const buf = await textToDocxService(text)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value).toContain('段落一')
        expect(value).toContain('段落二')
        expect(value).toContain('段落三')
    })

    it('含 XML 特殊字符（<, &, "）正确转义', async () => {
        const text = '风险条款：a < b & c = "d"'
        const buf = await textToDocxService(text)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value).toContain('a < b & c = "d"')
    })

    it('超长文本（~50KB）也能处理', async () => {
        const text = '条款内容。'.repeat(10000) // 约 50KB
        const buf = await textToDocxService(text)
        expect(buf.length).toBeGreaterThan(1000)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value.length).toBeGreaterThan(1000)
    })

    it('空字符串返回合法 .docx（单空段落）', async () => {
        const buf = await textToDocxService('')
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(typeof value).toBe('string')
    })
})
```

- [ ] **Step 5.2：实现**

`server/services/assistant/contract/textToDocx.service.ts`

```typescript
/**
 * 纯文本 → 最小合规 .docx Buffer。
 *
 * 用 jszip 直接构造五文件最小骨架（docx 官方包未装）；输出必须能被 mammoth 重新 parse。
 * 使用 docx/zipRewriter 封装与 docx/xmlUtils 的 escapeXml，统一 zip 操作与 XML 转义路径。
 */
import JSZip from 'jszip'
import { writeTextToZip, zipToBuffer, type DocxZip } from './docx/zipRewriter'
import { escapeXml } from './docx/xmlUtils'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`

function buildDocumentXml(text: string): string {
    const lines = text.length === 0 ? [''] : text.split(/\r?\n/)
    const paragraphs = lines
        .map(
            (line) =>
                `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
        )
        .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>${paragraphs}</w:body>
</w:document>`
}

export async function textToDocxService(text: string): Promise<Buffer> {
    // 新建空 zip 作为起点（zipRewriter.loadDocxZip 只处理已有 docx buffer，不适合空 zip 场景）
    const zip: DocxZip = new JSZip()
    writeTextToZip(zip, '[Content_Types].xml', CONTENT_TYPES)
    writeTextToZip(zip, '_rels/.rels', ROOT_RELS)
    writeTextToZip(zip, 'word/_rels/document.xml.rels', DOCUMENT_RELS)
    writeTextToZip(zip, 'word/document.xml', buildDocumentXml(text))
    return await zipToBuffer(zip)
}
```

> 说明：空 zip 初始化走 `new JSZip()`（JSZip 实例即 `DocxZip` 类型别名），剩余所有操作（写文件 + 序列化）全部通过 `zipRewriter` 封装，与 commentInjector 的路径一致。

- [ ] **Step 5.3：验证**

```bash
npx vitest run tests/server/assistant/contract/textToDocx.test.ts --reporter=verbose
```

**Expected：** 5 case 全绿。

- [ ] **Step 5.4：提交**

```bash
git add server/services/assistant/contract/textToDocx.service.ts tests/server/assistant/contract/textToDocx.test.ts
git commit -m "feat(contract): 新增 textToDocxService 纯文本转最小 .docx"
```

---

## 9. Task 6：`commentInjector.ts` — Word 原生批注注入（TDD，核心）

**Files:**
- Create: `server/services/assistant/contract/docx/commentInjector.ts`
- Create: `tests/server/assistant/contract/docx/commentInjector.test.ts`

### Why

- 合同审查 M2 的核心：把 AI 产出的 `Risk[]` 写成 Word 原生批注（不是普通文本 footnote）
- 对齐 spec §10.1 **四处**改动 + §10.2 五模块批注文本格式 + §10.3 单测清单
- commentInjector 产出的 .docx 必须：被 jszip 重新打开合法 / 被 mammoth 重读文本不丢失 / Word + WPS 能显示批注

### 9.1 批注文本格式（spec §10.2 原文）

```
[<level 中文>] <category>

【法律依据】<legalBasis>

【条款分析】
<analysis>

【法律风险】
<risk>

【修改建议】
<suggestion>
```

Level 映射：`high→高风险` / `medium→中风险` / `low→低风险`；`legalBasis` 为空时整个"【法律依据】"段省略。

### Steps

- [ ] **Step 6.1：先写测试**

`tests/server/assistant/contract/docx/commentInjector.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import type { Risk } from '#shared/types/contract'
import { injectComments } from '~~/server/services/assistant/contract/docx/commentInjector'
import { loadDocxZip, readTextFromZip } from '~~/server/services/assistant/contract/docx/zipRewriter'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

function makeRisk(index: number, overrides: Partial<Risk> = {}): Risk {
    return {
        id: `r-${index}`,
        clauseIndex: index,
        clauseText: `条款原文 ${index}`,
        level: 'high',
        category: '付款条件',
        problem: '付款周期过长',
        analysis: '条款约定"收到发票后 60 日内付款"，对乙方不利',
        risk: '甲方可能恶意拖延',
        suggestion: '改为 30 日内',
        legalBasis: '《民法典》第 509 条',
        suggestedClauseText: '甲方应在收到发票后 30 日内付款',
        ...overrides,
    }
}

describe('injectComments', () => {
    it('空 risks 数组时产出 .docx 与原文等效（不新增 comments.xml）', async () => {
        const original = await readFile(SAMPLE)
        const buf = await injectComments(original, [])
        const zip = await loadDocxZip(buf)
        expect(zip.file('word/comments.xml')).toBeNull()
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value.length).toBeGreaterThan(0)
    })

    it('注入 3 条批注 → comments.xml 存在且含 3 个 w:comment', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const risks = [makeRisk(1), makeRisk(2), makeRisk(3)].filter(
            (r) => r.clauseIndex < paragraphs.length,
        )
        const buf = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        const matches = comments.match(/<w:comment\s/g) ?? []
        expect(matches.length).toBe(risks.length)
    })

    it('批注 id 从 0 连续递增，无冲突', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const risks = [makeRisk(1), makeRisk(2), makeRisk(3)].filter(
            (r) => r.clauseIndex < paragraphs.length,
        )
        const buf = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain('w:id="0"')
        expect(comments).toContain('w:id="1"')
        expect(comments).toContain('w:id="2"')
        expect(comments).not.toContain('w:id="3"')
    })

    it('对同一 docx 重复执行两次 injectComments，两次输出的 id 均从 0 开始（spec §10.3 硬要求）', async () => {
        const original = await readFile(SAMPLE)
        // 第一次：1 条 risk
        const buf1 = await injectComments(original, [makeRisk(2)])
        const zip1 = await loadDocxZip(buf1)
        const comments1 = await readTextFromZip(zip1, 'word/comments.xml')
        expect(comments1).toContain('w:id="0"')
        expect(comments1).not.toContain('w:id="1"')

        // 第二次：对同一份 original 传入 2 条 risk，id 应从 0 重新分配（不累积）
        const buf2 = await injectComments(original, [makeRisk(1), makeRisk(2)])
        const zip2 = await loadDocxZip(buf2)
        const comments2 = await readTextFromZip(zip2, 'word/comments.xml')
        expect(comments2).toContain('w:id="0"')
        expect(comments2).toContain('w:id="1"')
        expect(comments2).not.toContain('w:id="2"')
    })

    it('document.xml 含 commentRangeStart / commentRangeEnd / commentReference', async () => {
        const original = await readFile(SAMPLE)
        const risks = [makeRisk(2)]
        const buf = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const doc = await readTextFromZip(zip, 'word/document.xml')
        expect(doc).toContain('<w:commentRangeStart w:id="0"')
        expect(doc).toContain('<w:commentRangeEnd w:id="0"')
        expect(doc).toContain('<w:commentReference w:id="0"')
    })

    it('[Content_Types].xml 含 comments Override', async () => {
        const original = await readFile(SAMPLE)
        const buf = await injectComments(original, [makeRisk(2)])
        const zip = await loadDocxZip(buf)
        const types = await readTextFromZip(zip, '[Content_Types].xml')
        expect(types).toContain('PartName="/word/comments.xml"')
        expect(types).toContain(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
        )
    })

    it('word/_rels/document.xml.rels 含 comments Relationship', async () => {
        const original = await readFile(SAMPLE)
        const buf = await injectComments(original, [makeRisk(2)])
        const zip = await loadDocxZip(buf)
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(rels).toContain('Target="comments.xml"')
        expect(rels).toContain(
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
        )
    })

    it('批注文本含五模块结构（高风险 + category + 法律依据 + 条款分析 + 法律风险 + 修改建议）', async () => {
        const original = await readFile(SAMPLE)
        const buf = await injectComments(original, [makeRisk(2)])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain('[高风险] 付款条件')
        expect(comments).toContain('【法律依据】')
        expect(comments).toContain('【条款分析】')
        expect(comments).toContain('【法律风险】')
        expect(comments).toContain('【修改建议】')
    })

    it('legalBasis 为空时省略【法律依据】段', async () => {
        const original = await readFile(SAMPLE)
        const risk = makeRisk(2, { legalBasis: undefined })
        const buf = await injectComments(original, [risk])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).not.toContain('【法律依据】')
        expect(comments).toContain('【条款分析】')
    })

    it.each([
        ['high', '高风险'],
        ['medium', '中风险'],
        ['low', '低风险'],
    ] as const)('level %s 映射为 %s', async (level, label) => {
        const original = await readFile(SAMPLE)
        const buf = await injectComments(original, [makeRisk(2, { level })])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        expect(comments).toContain(`[${label}]`)
    })

    it('批注数 ≥ 20 时 .docx 结构仍合法（unzip 能重打开）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const maxIndex = Math.min(paragraphs.length - 1, 25)
        const risks = Array.from({ length: 22 }, (_, i) => makeRisk(Math.min(i + 1, maxIndex)))
        const buf = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        expect(zip.file('word/comments.xml')).not.toBeNull()
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value.length).toBeGreaterThan(0)
    })

    it('批注含中文 / 英文 / 数字 / 括号 / 引号 时正常转义', async () => {
        const original = await readFile(SAMPLE)
        const risk = makeRisk(2, {
            problem: '条款 "A" 与 <B> 冲突 & 数字 123',
            analysis: '引号 "双引号" 与 \'单引号\'，括号（中文）(英文)',
        })
        const buf = await injectComments(original, [risk])
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        // XML 中合法转义
        expect(comments).toContain('&quot;A&quot;')
        expect(comments).toContain('&lt;B&gt;')
        expect(comments).toContain('&amp;')
        // 原样字符（不被转义）
        expect(comments).toContain('123')
        expect(comments).toContain('（中文）')
    })

    it('clauseIndex 越界时跳过该批注（spec §13 R4 缓释策略）', async () => {
        const original = await readFile(SAMPLE)
        const { paragraphs } = await parseContractDocx(original)
        const risks = [
            makeRisk(1),
            makeRisk(99999), // 越界
            makeRisk(2),
        ].filter((r) => true)
        const buf = await injectComments(original, risks)
        const zip = await loadDocxZip(buf)
        const comments = await readTextFromZip(zip, 'word/comments.xml')
        const matches = comments.match(/<w:comment\s/g) ?? []
        // 只注入 2 条（越界那条被跳过）
        expect(matches.length).toBe(2)
    })
})
```

- [ ] **Step 6.2：实现**

`server/services/assistant/contract/docx/commentInjector.ts`

```typescript
/**
 * Word 原生批注注入：按 spec §10.1 改四处文件，按 §10.2 五模块格式写 comments.xml。
 */
import type { Risk, RiskLevel } from '#shared/types/contract'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
import { appendChildXml, escapeXml } from './xmlUtils'

const LEVEL_LABEL: Record<RiskLevel, string> = {
    high: '高风险',
    medium: '中风险',
    low: '低风险',
}

const COMMENTS_OVERRIDE =
    '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'

const COMMENTS_REL =
    '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'

/** 生成五模块批注文本（含 \n 原样保留，最终落 <w:t> 时按行拆分 runs） */
function buildCommentText(risk: Risk): string {
    const lines: string[] = []
    lines.push(`[${LEVEL_LABEL[risk.level]}] ${risk.category}`)
    lines.push('')
    if (risk.legalBasis) {
        lines.push(`【法律依据】${risk.legalBasis}`)
        lines.push('')
    }
    lines.push('【条款分析】')
    lines.push(risk.analysis)
    lines.push('')
    lines.push('【法律风险】')
    lines.push(risk.risk)
    lines.push('')
    lines.push('【修改建议】')
    lines.push(risk.suggestion)
    return lines.join('\n')
}

/** 批注文本拆成多个 <w:p>（Word 批注换行） */
function buildCommentXmlBody(text: string): string {
    return text
        .split('\n')
        .map(
            (line) =>
                `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
        )
        .join('')
}

function buildCommentsXml(risks: Risk[]): string {
    const now = new Date().toISOString()
    const items = risks
        .map(
            (risk, i) =>
                `<w:comment w:id="${i}" w:author="LexSeek 审查助手" w:date="${now}">${buildCommentXmlBody(
                    buildCommentText(risk),
                )}</w:comment>`,
        )
        .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${items}</w:comments>`
}

/**
 * 在第 N 个非空 <w:p> 内插入批注范围标记。
 *
 * 策略：字符串级扫描 <w:p ...>...</w:p>（含自闭合 <w:p/>），按顺序计数；
 * 过滤掉空段落（自闭合或无 <w:r>）后按 index 定位；
 * 在段落起始 <w:p...> 右侧插入 <w:commentRangeStart>，
 * 在其 </w:p> 左侧插入 <w:commentRangeEnd> + <w:r><w:commentReference/></w:r>。
 */
function injectRangeMarkers(
    documentXml: string,
    injections: Array<{ index: number; id: number }>,
): string {
    const regex = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    const paragraphs: Array<{ text: string; start: number; end: number }> = []
    let m: RegExpExecArray | null
    while ((m = regex.exec(documentXml)) !== null) {
        paragraphs.push({ text: m[0], start: m.index, end: m.index + m[0].length })
    }

    // 过滤空段落（自闭合或只有 <w:pPr> 无 <w:r>）
    const nonEmpty = paragraphs.filter((p) => /<w:r[\s>]/.test(p.text))

    // 从后向前处理（保持前面的 offset 不变）
    const sortedInjections = [...injections]
        .map((inj) => ({ ...inj, target: nonEmpty[inj.index] }))
        .filter((inj) => inj.target !== undefined)
        .sort((a, b) => b.target!.start - a.target!.start)

    let result = documentXml
    for (const inj of sortedInjections) {
        const target = inj.target!
        const pText = target.text

        const openTagMatch = /^<w:p(?:\s[^>]*)?>/.exec(pText)
        if (!openTagMatch) continue // 不应发生（nonEmpty 已过滤自闭合），保留守卫避免 TS narrow 警告
        const openTagEnd = openTagMatch[0].length
        const closeTagStart = pText.lastIndexOf('</w:p>')
        if (closeTagStart < 0) continue

        const newP =
            pText.slice(0, openTagEnd) +
            `<w:commentRangeStart w:id="${inj.id}"/>` +
            pText.slice(openTagEnd, closeTagStart) +
            `<w:commentRangeEnd w:id="${inj.id}"/><w:r><w:commentReference w:id="${inj.id}"/></w:r>` +
            pText.slice(closeTagStart)

        result = result.slice(0, target.start) + newP + result.slice(target.end)
    }

    return result
}

/**
 * 注入 Word 原生批注，返回新 .docx Buffer。
 *
 * - 空 risks：返回原 Buffer 的等效拷贝（不写 comments.xml）
 * - clauseIndex 越界的 Risk：跳过并 logger.warn 记录（spec §13 R4）
 * - 批注 id 从 0 连续递增；同一 docx 重复调用时各次独立从 0 开始
 */
export async function injectComments(docxBuffer: Buffer, risks: Risk[]): Promise<Buffer> {
    if (risks.length === 0) {
        return Buffer.from(docxBuffer)
    }

    const zip = await loadDocxZip(docxBuffer)
    const documentXml = await readTextFromZip(zip, 'word/document.xml')
    const contentTypesXml = await readTextFromZip(zip, '[Content_Types].xml')
    const relsXml = await readTextFromZip(zip, 'word/_rels/document.xml.rels')

    // 段落计数（过滤空段落）
    const paraRegex = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
    const allParas: string[] = []
    let match: RegExpExecArray | null
    while ((match = paraRegex.exec(documentXml)) !== null) {
        allParas.push(match[0])
    }
    const nonEmptyCount = allParas.filter((p) => /<w:r[\s>]/.test(p)).length

    // 过滤越界 risk，重新分配连续 id
    const skipped = risks.filter((r) => r.clauseIndex < 0 || r.clauseIndex >= nonEmptyCount)
    if (skipped.length > 0) {
        logger.warn('[commentInjector] 跳过越界 risk', {
            total: risks.length,
            skipped: skipped.length,
            indices: skipped.map((r) => r.clauseIndex),
            nonEmptyCount,
        })
    }
    const validRisks = risks.filter(
        (r) => r.clauseIndex >= 0 && r.clauseIndex < nonEmptyCount,
    )
    if (validRisks.length === 0) {
        return Buffer.from(docxBuffer)
    }

    const injections = validRisks.map((r, i) => ({ index: r.clauseIndex, id: i }))

    // 1. 改 word/document.xml
    const newDocumentXml = injectRangeMarkers(documentXml, injections)
    writeTextToZip(zip, 'word/document.xml', newDocumentXml)

    // 2. 新建 word/comments.xml
    writeTextToZip(zip, 'word/comments.xml', buildCommentsXml(validRisks))

    // 3. 改 [Content_Types].xml（仅在未含 Override 时追加）
    if (!contentTypesXml.includes('PartName="/word/comments.xml"')) {
        writeTextToZip(
            zip,
            '[Content_Types].xml',
            appendChildXml(contentTypesXml, 'Types', COMMENTS_OVERRIDE),
        )
    }

    // 4. 改 word/_rels/document.xml.rels
    if (!relsXml.includes('Target="comments.xml"')) {
        writeTextToZip(
            zip,
            'word/_rels/document.xml.rels',
            appendChildXml(relsXml, 'Relationships', COMMENTS_REL),
        )
    }

    return await zipToBuffer(zip)
}
```

> 说明：段落定位用字符串正则扫描（非 DOM 操作），原因是 Office XML 有大量命名空间属性，DOM round-trip 在某些 edge case 会丢失或重写属性（尤其 `xml:space="preserve"`），字符串级操作更稳。`escapeXml` / `appendChildXml` 统一从 `xmlUtils` 导入，保证 XML 转义路径全 docx 子模块一致。`logger` 由 Nuxt 服务端自动导入，无需 import。

- [ ] **Step 6.3：验证**

```bash
npx vitest run tests/server/assistant/contract/docx/commentInjector.test.ts --reporter=verbose
```

**Expected：** 14 case 全绿（1 空 + 1 数量 + 1 id + 1 重复执行 id + 1 document + 1 ContentTypes + 1 rels + 1 五模块 + 1 legalBasis 省略 + 3 level 映射 + 1 ≥20 + 1 转义 + 1 越界）

- [ ] **Step 6.4：提交**

```bash
git add server/services/assistant/contract/docx/commentInjector.ts tests/server/assistant/contract/docx/commentInjector.test.ts
git commit -m "feat(contract): 新增 commentInjector Word 原生批注注入"
```

---

## 10. Task 7：`docx/index.ts` 汇总 + 集成测试（TDD）

**Files:**
- Create: `tests/server/assistant/contract/docx/integration.test.ts`
- Create: `server/services/assistant/contract/docx/index.ts`

### Why

- barrel 文件让 M3 的 agent / tool 导入时只需 `import { parseContractDocx, detectParties, injectComments } from '~~/server/services/assistant/contract/docx'`
- 集成测试把 parse → detect → inject 串起来，用 5 份真实样本验证全链路
- 同时验证 `textToDocxService` 的输出可以作为 `injectComments` 的输入（paste → docx → inject 链路闭环）
- 顺序：先写集成测试（其 import 依赖 barrel，首次运行必然 RED），再实现 barrel（GREEN），保持与 Task 1-6 相同的 TDD 节奏

### Steps

- [ ] **Step 7.1：先写集成测试（RED）**

`tests/server/assistant/contract/docx/integration.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import type { Risk } from '#shared/types/contract'
import {
    parseContractDocx,
    detectParties,
    injectComments,
} from '~~/server/services/assistant/contract/docx'
import { textToDocxService } from '~~/server/services/assistant/contract/textToDocx.service'

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../../../prisma/seeds/contract-samples')

// 5 份样本已在 M1 sampleFixtures.test.ts 验证正则 100% 命中甲乙方；
// 本集成测试期望 detect 走 regex 路径，因此 LLM mock 返回空 JSON 只作为极端兜底
vi.mock('~~/server/services/node/chatModelFactory', () => ({
    createChatModel: vi.fn(() => ({ invoke: vi.fn().mockResolvedValue({ content: '{}' }) })),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn().mockResolvedValue({
        id: 1,
        name: 'contractReviewMain',
        modelName: 'deepseek-chat',
        modelSdkType: 'openai',
        modelProviderBaseUrl: 'https://api.deepseek.com/v1',
        modelApiKeys: [{ apiKey: 'mock', status: 1 }],
        prompt: null,
    }),
}))

describe('docx 端到端集成', () => {
    it.each(SAMPLES)('%s.docx → parse → detect → inject 闭环', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))

        const parsed = await parseContractDocx(buf)
        expect(parsed.paragraphs.length).toBeGreaterThan(5)

        const parties = await detectParties(parsed.paragraphs)
        // 5 份样本正则路径应命中（spec §12.1 要求命中率 ≥ 80%，且 M1 sampleFixtures 已验证 100%）
        expect(parties.source).toBe('regex')
        expect(parties.partyA).not.toBeNull()
        expect(parties.partyB).not.toBeNull()

        const clauseIdx = Math.min(3, parsed.paragraphs.length - 1)
        const risks: Risk[] = [
            {
                id: 'r-1',
                clauseIndex: clauseIdx,
                clauseText: parsed.paragraphs[clauseIdx],
                level: 'high',
                category: '付款条件',
                problem: '付款周期过长',
                analysis: '分析',
                risk: '风险',
                suggestion: '建议',
                legalBasis: '《民法典》第 509 条',
                suggestedClauseText: '甲方应在收到发票后 30 日内付款',
            },
        ]
        const injected = await injectComments(buf, risks)

        const { value } = await mammoth.extractRawText({ buffer: injected })
        expect(value.length).toBeGreaterThan(0)
    })

    it('paste → textToDocx → parse → inject 链路', async () => {
        const text = '甲方：某公司\n乙方：张三\n本合同签订于 2026 年 4 月。\n付款条件：60 日内支付全款。\n违约金：日万分之五。\n合同期限：一年。'
        const docxBuf = await textToDocxService(text)
        const parsed = await parseContractDocx(docxBuf)
        expect(parsed.paragraphs.length).toBeGreaterThan(2)

        const clauseIdx = Math.min(1, parsed.paragraphs.length - 1)
        const risks: Risk[] = [
            {
                id: 'r-1',
                clauseIndex: clauseIdx,
                clauseText: parsed.paragraphs[clauseIdx],
                level: 'medium',
                category: '付款条件',
                problem: '周期过长',
                analysis: 'a',
                risk: 'r',
                suggestion: 's',
                suggestedClauseText: '改为 30 日',
            },
        ]
        const injected = await injectComments(docxBuf, risks)
        const { value } = await mammoth.extractRawText({ buffer: injected })
        expect(value).toContain('甲方')
    })
})
```

先跑一次：

```bash
npx vitest run tests/server/assistant/contract/docx/integration.test.ts
```

**Expected：** RED — barrel 尚未创建，`import ... from '~~/server/services/assistant/contract/docx'` 模块解析失败。

- [ ] **Step 7.2：实现 barrel（GREEN）**

`server/services/assistant/contract/docx/index.ts`

```typescript
export { parseContractDocx } from './parser'
export type { ParsedContract } from './parser'
export { detectParties } from './partyDetector'
export type { PartyDetectionResult } from './partyDetector'
export { injectComments } from './commentInjector'
export {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
export { appendChildXml, escapeXml } from './xmlUtils'
```

> `DocxZip` 类型 M2 内无跨文件消费方（commentInjector 与 zipRewriter 同目录，直接相对 import），不从 barrel 导出。M3+ 若真需要再补。

- [ ] **Step 7.3：验证覆盖率**

```bash
npx vitest run tests/server/assistant/contract/ --coverage 2>&1 | tail -50
```

**Expected：**

- 所有 M2 测试文件（7 个）全绿
- `server/services/assistant/contract/` 覆盖率 ≥ 90% 行覆盖（spec §12.2 硬要求，M2 仅 service/docx 子模块适用；API 层覆盖由 M3+ 补齐）
- 若覆盖率未达标：先补充缺口对应 Task（如 commentInjector 某路径未测），不是增加无意义测试凑数

- [ ] **Step 7.4：提交**

```bash
git add server/services/assistant/contract/docx/index.ts tests/server/assistant/contract/docx/integration.test.ts
git commit -m "test(contract): 新增 docx 子模块 barrel 与端到端集成测试"
```

---

## 11. Task 8：M2 全量验收

- [ ] **Step 8.1：跑全部 M2 测试**

```bash
npx vitest run tests/server/assistant/contract/ --reporter=verbose
```

**Expected：** 7 个测试文件全绿（xmlUtils 4 + zipRewriter 5 + parser 12 + partyDetector 9 + textToDocx 5 + commentInjector 14 + integration 6 = 共 55 case）。样本 fixture 测试（5 case）已在 M1 产出，本 Task 不计入。

- [ ] **Step 8.2：跑 typecheck**

```bash
npx nuxi typecheck
```

**Expected：** 除已知 `DocumentDraftPanel.vue` placeholders 基线错误外 0 新 error。

- [ ] **Step 8.3：确认 M2 交付物完整**

Checklist（对齐 spec §11 M2 验收）：

- [ ] `docx/xmlUtils.ts` 存在（提供 `appendChildXml` / `escapeXml` 两个字符串级原语）
- [ ] `docx/zipRewriter.ts` 存在（jszip 封装，5 个导出函数）
- [ ] `docx/parser.ts` 存在（mammoth 段落提取）
- [ ] `docx/partyDetector.ts` 存在（正则 + LLM 兜底，调 `createChatModel` 参数结构与 `caseMainAgent` 一致）
- [ ] `docx/commentInjector.ts` 存在（按 spec §10.1 **四处** XML 改动）
- [ ] `textToDocx.service.ts` 存在（用 `zipRewriter` 封装 + `xmlUtils.escapeXml`）
- [ ] `docx/index.ts` 导出 parse / detect / inject + zipRewriter 基本操作 + xmlUtils 两个字符串原语
- [ ] 5 份样本 `parseContractDocx` 段落数 > 5 且 < 500
- [ ] `detectParties` 正则命中率 ≥ 80%（实测 5 / 5）
- [ ] `injectComments` 对 22 条 risk 输出的 .docx 仍可被 mammoth 重读
- [ ] `injectComments` 越界 clauseIndex 自动跳过 + `logger.warn` 记录不抛错
- [ ] `injectComments` 对同一 docx 两次调用，id 各自从 0 开始（spec §10.3 "重复执行两次不冲突"）
- [ ] `textToDocxService` 输出可被 mammoth 重读
- [ ] `server/services/assistant/contract/` 覆盖率 ≥ 90%（M2 范围内只含 service/docx 子模块；API 层覆盖在 M3+ 补齐）

- [ ] **Step 8.4：提交前检查**

```bash
git status
git log --oneline main..HEAD
```

**Expected：** 7 个新提交（Task 8 不产生单独提交），`git log --oneline main..HEAD` 由新到旧输出前 7 行：

```
test(contract): 新增 docx 子模块 barrel 与端到端集成测试
feat(contract): 新增 commentInjector Word 原生批注注入
feat(contract): 新增 textToDocxService 纯文本转最小 .docx
feat(contract): 新增 partyDetector 正则+LLM 兜底识别
feat(contract): 新增 parser mammoth 段落提取
feat(contract): 新增 zipRewriter jszip 封装
feat(contract): 新增 xmlUtils fast-xml-parser v5 封装
```

- [ ] **Step 8.5：人工验证（脱机）**

Spec §10.3 要求，**不阻断自动化测试通过**：

1. 用 Task 6 测试产生的 22-批注 .docx（可临时写脚本 dump 到 `/tmp/labor-22-comments.docx`），拷到 Mac 上用：
   - **Microsoft Word**（365 或 2021）打开 → 批注面板完整显示 22 条 → 点击段落批注标记跳转正确
   - **WPS（Mac 版）** 打开 → 不崩溃、批注可见
2. 若任一失败，记录问题到 `docs/tech-docs/guides/pitfalls.md`，但**不作为 M2 阻断条件**（spec 定性为"人工验证"即取样验证，不是 gate）

---

## 12. 明确延后到后续里程碑

### 延后到 M3

- `reviewResultPersistence.middleware.ts` 文件本体（这是 M2 `injectComments` 的消费方）
- `server/services/workflow/middleware/index.ts` 追加 `export * from './reviewResultPersistence.middleware'`
- `contractReviewMainAgent.ts` + `runContractReviewChat`
- `parseAndAskStance` 工具（工具内部会调 `parseContractDocx` + `detectParties`）
- `contractReview.service.ts` / `contractReview.dao.ts`
- 5 个 API 端点（POST/GET/PATCH/rebuild-docx/download/stance）
- `PromptRenderContext` / `ToolContext` 扩展
- `pointConsumptionMiddleware` 接入

### 延后到 M4

- `/dashboard/assistant/contract` 路由与 6 个 Vue 组件
- `useContractReview` composable

### 延后到 M5

- 条款级 diff 对比 UI（消费 M1 装的 `diff-match-patch`）
- PATCH risks 编辑 / rebuild-docx 并发占位

---

## 13. M3 启动前首件事清单（供后续 plan 引用，M2 不执行）

M3 plan 需在 Step 0 处理以下 9 项：

1. 验证 `state.structuredResponse` 在 `afterAgent` 钩子可见的 PoC（spec §13 R1）
2. 创建 `server/services/workflow/middleware/reviewResultPersistence.middleware.ts`（消费 M2 的 `injectComments`）
3. 在 `server/services/workflow/middleware/index.ts` 追加 `export * from './reviewResultPersistence.middleware'`
4. 扩展 `PromptRenderContext` 接口加 optional `reviewId` / `contractType` 字段
5. 扩展 `ToolContext` 接口加 optional `reviewId` 字段
6. 校验 `getValidNodeConfig('contractReviewMain')` 可正常读取 M1 的节点与提示词
7. 校验 `pointConsumptionMiddleware(userId, 'contract_review_token', sessionId)` 可匹配 M1 的积分规则
8. 在 `agentWorker.executeRun` scope 分流补 `else if (session.scope === 'contract')` 分支
9. 为 M2 的 `seedData.sql` 补 `contract_review_token` 的 SQL 备份行已在 M1 完成（无需再做）；`contractReviewMain` 节点 + 提示词 SQL 也已在 M1 refactor 提交 b5d9a5e 中落地

---

## 14. 风险与缓释（M2 级别）

| # | 风险 | 缓释 |
|---|---|---|
| R1 | fast-xml-parser v5 API 与 v4 有 breaking change | Task 1 用最小封装 `xmlUtils.ts` 隔离 v5 调用，所有消费方只用封装；封装内部若 v5 下游问题暴露，一次性改一处 |
| R2 | commentInjector 用字符串级正则定位 `<w:p>` 可能遇到嵌套 `<w:p>`（Word 文档中 `<mc:AlternateContent>` 内可能嵌入另一个 `<w:p>`） | 5 份样本是纯文本合同，不含 AlternateContent；M2 不解决嵌套 edge case。若未来真实用户上传的 Word 出现嵌套 → 在 `pitfalls.md` 记录，M5 Hotfix |
| R3 | partyDetector LLM 兜底依赖 `contractReviewMain` 节点（M1 已落），若运行测试的环境未跑 seedData.sql，LLM 路径会失败 | Task 4 测试全程 mock `getValidNodeConfig` / `createChatModel`，不依赖真实 DB 数据；运行时环境由 M3 落地 seed 验证 |
| R4 | mammoth `extractRawText` 对 Word 批注是否会重复提取批注文本 | `injectComments` 注入的批注文本在 `word/comments.xml` 中，mammoth `extractRawText` 只读 `word/document.xml`，不会提取批注；已在 Task 6 集成测试中验证 mammoth 重读输出长度 |
| R5 | 覆盖率 90% 门槛若被某个 edge case 挡住 | Task 7 Step 7.3 先跑覆盖率报告；差口小则补单测，差口大则先 flag `DONE_WITH_CONCERNS` 让 review 决定 |
| R6 | 22 条批注的样本可能段落数不够 22（例如 loan.docx 只有 10 段） | Task 6 Step 6.1 测试代码已用 `Math.min(i + 1, maxIndex)` 把 clauseIndex 收敛到段落上限，避免硬造越界 |

---

## 15. 提交切片汇总

共 7 个原子提交（对齐 Task 1-7，Task 8 只做验收不提交）：

1. `feat(contract): 新增 xmlUtils fast-xml-parser v5 封装`
2. `feat(contract): 新增 zipRewriter jszip 封装`
3. `feat(contract): 新增 parser mammoth 段落提取`
4. `feat(contract): 新增 partyDetector 正则+LLM 兜底识别`
5. `feat(contract): 新增 textToDocxService 纯文本转最小 .docx`
6. `feat(contract): 新增 commentInjector Word 原生批注注入`
7. `test(contract): 新增 docx 子模块 barrel 与端到端集成测试`

> 顺序依据：xmlUtils ← zipRewriter（xmlUtils 的消费方）← parser（zipRewriter 的消费方）与 partyDetector 并行 → textToDocx 独立 → commentInjector（所有 docx 子模块的汇聚点）→ barrel + 集成。

---

## 16. 与 Spec §11 M2 验收条款对齐校验

| spec §11 M2 要求项 | 对应本 plan Task |
|---|---|
| `server/services/assistant/contract/docx/` parser | Task 3 |
| `server/services/assistant/contract/docx/` partyDetector（正则+LLM） | Task 4 |
| `server/services/assistant/contract/docx/` commentInjector（五模块批注格式，按 §10.1 **四处** XML 改动；spec §12.1 "三 XML" 属 spec 内部措辞不一致，以 §10.1 为准） | Task 6 |
| `server/services/assistant/contract/docx/` zipRewriter | Task 2 |
| `textToDocxService` | Task 5 |
| 对 5 份样本跑单测（批注 ≥20 / 中文 / id 不冲突（含"重复执行两次 id 从 0"）） | Task 6（≥20 / 中文 / id 连续 / 重复执行）+ Task 7（5 份样本 parse+detect+inject） |
| Word + WPS 人工验证 | Task 8 Step 8.5（脱机，不阻断自动化） |
| `npx vitest run` 全通 | Task 8 Step 8.1 |
| 覆盖率 ≥ 90%（M2 范围内 service/docx 子模块；spec §12.2 另含"API 层每端点 happy path + 4xx"一条，M2 无 API 端点，该条延后至 M3+） | Task 8 Step 8.3 Checklist + Task 7 Step 7.3 |

**本 plan 冻结 M2 实施范围。任何超出上述 Task 1-7 的改动（包括提前创建 reviewResultPersistence middleware 空骨架、提前扩展 PromptRenderContext、在 docx 子模块引入 diff-match-patch 等），一律延后。**
