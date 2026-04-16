# 已知陷阱与踩坑记录

本文档汇总 LexSeek 项目开发过程中遇到的关键陷阱和解决方案，按业务领域分类，供 AI 开发助手快速查阅。

## 一、Prisma Decimal 类型

### 问题

Prisma 从 PostgreSQL 查询 `Decimal(10, 2)` 字段时，返回的不是 JavaScript 的 `number`，而是 Prisma Decimal 对象：

```json
{ "s": 1, "e": 2, "d": [365] }
```

直接使用 `Number()` 转换会返回 `NaN`。

### 影响范围

所有涉及金额的场景：商品价格、会员升级价格、订单金额等。

### 正确做法

使用项目提供的 `decimalToNumber` 工具函数：

```typescript
import { decimalToNumber } from '#shared/utils/decimalToNumber'

// ❌ 错误
const price = Number(product.priceYearly)  // NaN

// ✅ 正确
const price = decimalToNumber(product.priceYearly)  // 365
```

### 相关文件

- 工具函数：`shared/utils/decimalToNumber.ts`
- 修复记录：`docs/bak/membership-upgrade-decimal-fix.md`、`docs/bak/product-price-fix.md`

## 二、useApiFetch 返回值

### 问题

`useApiFetch` 内部已经通过 `response.data` 提取了 API 响应的 `data` 字段，返回的直接就是数据内容。如果再次 `.data` 访问，得到的是 `undefined`。

### 示例

```typescript
// API 返回: { code: 0, success: true, data: { id: 1, name: 'test' } }

// ❌ 错误
const result = await useApiFetch('/api/xxx')
result?.data?.id  // undefined，因为 result 已经是 { id: 1, name: 'test' }

// ✅ 正确
const result = await useApiFetch('/api/xxx')
result?.id  // 1
```

### 类型定义陷阱

```typescript
// ❌ 错误：泛型参数不应包含外层包装
const r = await useApiFetch<{ code: number; data?: { recognized: boolean } }>('/api/xxx')
r?.data?.recognized  // undefined

// ✅ 正确：泛型参数直接对应实际数据结构
const r = await useApiFetch<{ recognized: boolean }>('/api/xxx')
r?.recognized  // 正确
```

### 注意

`useApi`（基于 `useFetch`）同样会自动提取 `data` 字段（通过 `transform` 配置），返回的 `data.value` 直接就是数据内容。

## 三、用户认证上下文

### 问题

服务端获取当前登录用户时，必须使用 `event.context.auth?.user`，不能使用 `event.context.user`（始终为 `undefined`）。

### 正确写法

```typescript
// ✅ 正确
const user = event.context.auth?.user
if (!user) return resError(event, 401, '请先登录')

// ❌ 错误
const user = event.context.user  // 始终 undefined
```

### 原因

认证中间件将解析后的用户信息挂在 `event.context.auth` 对象上，而非直接挂在 `event.context` 上。

## 四、材料识别

### 4.1 识别记录只在成功时创建

**设计原则**：识别记录（`image_recognition_records` / `doc_recognition_records` / `asr_records`）只在识别成功后才创建。识别失败时不创建记录，避免污染数据。

**错误的旧实现**：在提交识别任务时就创建记录（状态 PROCESSING），失败时更新为 FAILED。这导致数据库中残留大量失败记录。

**正确逻辑**：
- 任务状态由任务记录表（如 `asr_tasks`、MinerU 任务表）追踪
- 识别记录仅记录成功的识别结果
- 重试时检查是否已有成功记录，有则跳过

### 4.2 图片 10MB 限制

OpenAI Vision API 限制输入图片最大 10MB。系统在调用 API 前需要对图片进行压缩：

```
server/utils/imageCompression.ts
```

压缩策略：保持宽高比缩放 + 降低质量。如果首次压缩后仍超限，自动降低质量重试。

### 4.3 重复识别防护

提交识别任务时需要检查：
1. 是否已有成功的识别记录 -> 跳过
2. 是否有正在处理中的任务 -> 跳过
3. 只有无记录或上次失败时才允许重新提交

### 4.4 加密文件识别

加密文件上传到 OSS 时，`Content-Type` 必须设为 `application/octet-stream`（Policy 要求）。识别时需要先下载并解密。

## 五、支付订单号

### 问题

传给微信支付的 `out_trade_no` 应该使用业务订单号（`LSD` 前缀），而非支付单号（`PAY` 前缀）。

### 原因

- 用户在微信支付页面和系统订单列表看到的应该是同一个号
- 客服用用户提供的订单号能直接在系统中查询
- 避免 LSD <-> PAY 的额外映射

### 修复

在 `payment.service.ts` 中，调用支付适配器时传入 `order.orderNo` 而非 `transaction.transactionNo`。

## 六、会员升级

### 6.1 sortOrder 排序逻辑

判断会员级别高低使用 `sortOrder` 字段而非 `id`。`sortOrder` 越大级别越高。

```typescript
// ❌ 错误：用 ID 判断级别
if (currentLevel.id < targetLevel.id)

// ✅ 正确：用 sortOrder 判断级别
if (currentLevel.sortOrder < targetLevel.sortOrder)
```

### 6.2 升级价格计算

升级价格 = 目标级别价格 - 当前级别剩余价值。所有价格计算都需要经过 `decimalToNumber` 转换。

### 6.3 最高级别判断

`useMembershipStatus.isHighestLevel()` 只考虑真正的会员级别（基础版/专业版/旗舰版），过滤掉测试数据。基于 `sortOrder` 最大值判断。

## 七、Embedding 状态时序

### 问题

文件上传 -> 文件识别 -> 向量化完成。但案件创建和材料记录创建可能在向量化完成之后才发生。

此时向量化服务尝试更新 `case_materials.embedding_status` 时，材料记录还不存在，更新失败。后续创建材料时 `embedding_status` 默认为 `pending`，永远不会更新。

### 解决方案

在 `batchAddCaseMaterialsService` 创建材料时，主动检查对应 OSS 文件的识别记录：
- 如果识别状态为成功（status=2）且有 `vector_ids` -> 设置 `embedding_status = 'completed'`
- 否则保持 `pending`

### 需要检查的表

| 材料类型 | 识别记录表 |
|----------|-----------|
| DOCUMENT | `doc_recognition_records` |
| IMAGE | `image_recognition_records` |
| AUDIO | `asr_records` |

## 八、测试稳定性

### 8.1 属性测试需 deterministic seed

使用 `fast-check` 等属性测试框架时，必须设置确定性 seed，否则不同运行间可能产生不同的随机输入导致测试不稳定。

```typescript
fc.assert(
    fc.property(fc.integer(), (n) => { /* ... */ }),
    { seed: 42 }  // 固定 seed
)
```

### 8.2 测试节点名称使用 UUID

测试中创建数据库记录时，名称字段不要使用硬编码字符串（如 `'test-node'`），应使用 UUID 生成唯一名称：

```typescript
// ❌ 错误：多测试并行时冲突
const node = await prisma.nodes.create({ data: { name: 'test-node' } })

// ✅ 正确：使用 UUID
import { randomUUID } from 'crypto'
const node = await prisma.nodes.create({ data: { name: randomUUID() } })
```

### 8.3 afterEach 清理

测试中创建的临时数据（如 nodeIds）必须在 `afterEach` 中清理，避免污染其他测试。

### 8.4 主/测试数据库 Schema 同步

开发数据库和测试数据库的 schema 必须保持同步：

```bash
DATABASE_URL='postgresql://...ls_new_testing...' bun run prisma:push --accept-data-loss
```

### 8.5 chatModelFactory 测试

`chatModelFactory` 相关测试在全量运行时可能受其他测试影响（全局状态污染），已通过固定 seed 修复。

## 九、@langchain/vue 已知问题

### 9.1 interruptComputed 只追踪 isLoading

`@langchain/vue` 的 `useStreamCustom` 返回的 `interrupt` computed 只依赖 `isLoading`（`stream.custom.js:49-52`），不会在 interrupt 数据变化时更新。

**解决方案**：从 `values.__interrupt__` 直接读取中断数据：

```typescript
const interruptData = computed(() => {
    const v = s.values as any
    if (!v?.__interrupt__?.length) return null
    const raw = v.__interrupt__
    const resolved = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : raw) : raw
    return resolved?.value ?? resolved
})
```

### 9.2 values/messages 是 ES6 getter

`useStreamCustom` 返回的 `values`、`messages`、`interrupt` 是 ES6 getter（非 Vue Ref）。getter 内部读取 `shallowRef.value`，外层 `computed` 通过 Vue `activeEffect` 追踪。使用时必须用 `computed` 包装：

```typescript
// ✅ 正确
const messages = computed(() => s.messages as BaseMessage[])

// ❌ 错误：直接赋值不会保持响应式
const messages = s.messages
```

## 十、API 路由参数位置

### 规则

动态参数（params）必须在 URL 最末尾：

```
❌ /admin/legal-main/:id/articles
✅ /admin/legal-main/articles/:id
```

### 原因

Nuxt Server（Nitro）的文件系统路由约定要求动态参数作为路径的最后一个段。

## 十一、Tailwind CSS v4

### 深色模式声明

使用 `@custom-variant`（非 v3 的 `darkMode: 'class'`）：

```css
@custom-variant dark (&:is(.dark *));
```

### 主题变量

使用 `@theme inline` 声明 CSS 变量映射（非 v3 的 `theme.extend`）：

```css
@theme inline {
    --color-primary: var(--primary);
    --color-background: var(--background);
}
```

### OKLCH 颜色

所有颜色值使用 OKLCH 色彩空间（非 HSL）：

```css
--primary: oklch(0.205 0 0);
```

## 十二、SSR 相关

### 12.1 Cookie 转发

SSR 阶段请求 API 时需要手动转发浏览器 cookie：

```typescript
const requestHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined
```

`useApi` 已内置此逻辑。但如果直接使用 `$fetch` 或 `useFetch`，需要手动添加。

### 12.2 ClientOnly 防水合不匹配

依赖客户端状态（如 localStorage、window）的组件必须用 `<ClientOnly>` 包裹：

```vue
<ClientOnly>
    <GeneralThemeToggle />
    <template #fallback>
        <Button variant="ghost" size="icon"><Sun class="h-5 w-5" /></Button>
    </template>
</ClientOnly>
```

### 12.3 import.meta.client / import.meta.server

Nuxt 提供编译时常量区分运行环境：

```typescript
if (import.meta.client) {
    // 仅客户端执行
    localStorage.setItem('key', 'value')
}
if (import.meta.server) {
    // 仅服务端执行
    const headers = useRequestHeaders(['cookie'])
}
```

## 十三、商品购买限制

### 问题

商品表有 `purchase_limit` 字段限制用户购买次数，但创建订单时没有校验，导致用户可以无限购买。

### 解决方案

在 `createOrderService` 中添加购买次数校验：查询用户已有的有效订单数量，超过限制时返回错误。

## 十四、ASR 任务轮询

### 问题

ASR（音频识别）任务提交后需要轮询状态，但轮询逻辑存在以下问题：
- 标签页不可见时仍在轮询，浪费资源
- 超时后未正确清理

### 解决方案

使用 `useDocumentVisibility()` 检测标签页可见性，不可见时暂停轮询。设置最大轮询次数（60 次 = 2 分钟），超时后标记为 error。

## 十五、shadcn-vue 组件

### 禁止修改

`app/components/ui/` 下的所有组件由 shadcn-vue CLI 生成，禁止手动修改。重新安装组件时会被覆盖。

### 自定义组件

需要在 `app/components/` 的其他目录创建自定义组件。

## 十六、日期处理

### 统一使用 dayjs

项目中所有日期处理统一使用 `dayjs`，不使用原生 `Date` 的格式化方法。

```typescript
import dayjs from 'dayjs'

dayjs(dateString).format('YYYY-MM-DD HH:mm')
dayjs(dateString).fromNow()  // 需要 relativeTime 插件
```

### 数据库时区

数据库时区为 `Asia/Shanghai`。Prisma 连接使用 `TimeZone=UTC` 以避免双偏移 bug。

## 九、shadcn-vue DialogContent 宽度覆盖

### 问题

`DialogContent` 组件内置默认样式 `sm:max-w-lg`（见 `app/components/ui/dialog/DialogContent.vue`）。如果直接写 `max-w-4xl` 等不带断点前缀的 class，在 ≥640px 屏幕上会被内置的 `sm:max-w-lg` 覆盖，导致宽度设置不生效。

### 影响范围

所有使用 `<DialogContent>` 且需要自定义宽度的弹框。

### 正确做法

必须加 `sm:` 前缀来覆盖同断点的默认值：

```vue
<!-- ❌ 错误：max-w-4xl 被内置 sm:max-w-lg 覆盖 -->
<DialogContent class="max-w-4xl">

<!-- ✅ 正确：sm: 前缀与内置断点同级，成功覆盖 -->
<DialogContent class="sm:max-w-4xl">

<!-- ✅ 正确：使用任意值写法也可以 -->
<DialogContent class="sm:max-w-[700px]">
```

### 项目现有用法参考

- `sm:max-w-[500px]`：`OrderDetailDialog.vue`
- `sm:max-w-2xl`：`CaseDetailXiaosuo.vue`
- `sm:max-w-[700px]`：`CaseExportDialog.vue`
- `md:min-w-[70vw]`：`DocPreviewDialog.vue`（用 min-w 实现大弹窗）

## 十七、init-analysis 页面 type=1 sessionId 导致历史消息不加载

### 问题

案件创建时 `createCaseService` 生成的是 type=1（主会话）session，前端 `useCaseCreation.ts` 拿这个 sessionId 导航到 `/dashboard/cases/init-analysis/${sessionId}`。但 init-analysis 页面的 `loadStatus` 调用 status API 时传入 type=1 的 sessionId，`getInitAnalysisStatusService` 在 `sessions.find(s => s.sessionId === sessionId && s.type === 2)` 中找不到匹配，直接返回 `status: 'not_started'`。前端 phase 被覆盖为 `'select'`，不会调用 `stream.submit(undefined)` 重连 SSE，历史消息无法加载。

### 影响范围

所有通过案件创建流程进入 init-analysis 页面的场景。URL 中的 sessionId 是 type=1 而非 type=2，刷新后 phase 回到模块选择页。

### 解决方案

在 `getInitAnalysisStatusService` 中，当传入的 sessionId 不匹配任何 type=2 session 时，**回退到同案件的最新 type=2 session**：

```typescript
// server/services/case/initAnalysis.service.ts
primarySession = sessions.find(s => s.sessionId === sessionId && s.type === 2)
if (!primarySession) {
    // 回退到最新 type=2 session（sessionId 可能是 type=1 主会话）
    primarySession = sessions.find(s => s.type === 2)
    if (!primarySession) {
        return { status: 'not_started', ... }
    }
}
```

### 相关文件

- 前端入口：`app/composables/useCaseCreation.ts:104`（用 type=1 sessionId 导航）
- 后端 session 创建：`server/services/case/case.service.ts:92`（`createSessionDao` 默认 type=1）
- Status API：`server/services/case/initAnalysis.service.ts:91-99`

## 十八、SSE checkpoint fallback 路径中已完成 run 连接不关闭

### 问题

`init-analysis.post.ts` 的 `createSSEResponse` 中，当 Redis Stream 无数据（过期/重启）时走 checkpoint fallback 路径。发送 `values` 事件后，代码将 `missed = []` 并注释"跳过后续的实时订阅"，但实际并未跳过 — 代码继续执行到 `createEventSubscription`，对于已完成的 run 不会有新事件，SSE 连接永久挂起。

### 影响范围

Redis Stream 数据过期（>7天）或 Redis 重启后，已完成 session 的 SSE 重连。前端虽然收到了 `values` 事件，但 `isLoading` 一直为 `true`。

### 解决方案

在 fallback 发送 checkpoint 后，查询 run 状态并在终结时直接 return 关闭 SSE：

```typescript
// 发送 checkpoint values 后
const run = await prisma.agentRuns.findUnique({
    where: { id: runId },
    select: { status: true },
})
if (run && TERMINAL_STATUSES.includes(run.status)) {
    // 发送终结状态事件并关闭 SSE
    controller.enqueue(encoder.encode(
        `event: status\ndata: ${JSON.stringify({ type: 'status_change', runId, status: run.status })}\n\n`,
    ))
    return
}
// run 仍在进行中才进入实时订阅
```

### 相关文件

- `server/api/v1/case/init-analysis.post.ts:329-374`（`createSSEResponse` fallback 路径）
- `server/services/workflow/agents/threadState.ts`（`getThreadValuesService`）

## 十九、vue-stream-markdown 表格底部 loading 图标不消失

### 问题

分析结果页面中，当 Markdown 内容包含表格（如"案件大事记"）时，表格底部始终显示一个旋转的 loading 图标（Spin 组件）。

### 原因

`vue-stream-markdown` 的 `<Markdown>` 组件 `mode` prop 默认值为 `streaming`。在 streaming 模式下，解析器会将 AST 中最后一个叶节点标记为 `loading: true`。表格组件内部通过 `hasLoadingNode()` 递归检查子节点的 loading 状态，如果存在则渲染 `<Spin>` 加载动画。

对于已完成的分析结果（非实时流式传输），由于没有显式传 `mode="static"`，默认走 `streaming` 模式，导致表格最后一个节点永远被标记为 loading。

### 影响范围

所有使用 `<AiElementsMessageResponse>` 展示**已完成内容**且内容中包含表格的场景。

### 正确做法

```vue
<!-- ❌ 错误：默认 mode="streaming"，已完成内容的表格会一直显示 loading -->
<AiElementsMessageResponse :content="content" />

<!-- ✅ 正确：已完成内容使用 static 模式 -->
<AiElementsMessageResponse :content="content" mode="static" />

<!-- ✅ 正确：流式传输中的内容使用默认的 streaming 模式 -->
<AiElementsMessageResponse :content="streamingContent" />
```

### 相关文件

- 组件：`app/components/ai-elements/message/MessageResponse.vue`（新增 `mode` prop 透传）
- 库源码：`node_modules/vue-stream-markdown/dist/table-CZIsOIpV.js`（`hasLoadingNode` 检查）
- 已修复的使用点：`AnalysisResults.vue`、`AnalysisVersionSheet.vue`、`CaseDetailMaterialPreview.vue`、`AiMessageListVirtualItem.vue`、`ModuleResult.vue`（fallback 场景）

## 二十、不要在前端按工具名过滤 thinking/text（意图识别已由后端剥离）

### 问题

init-analysis 页面（以及任何经过 `AiChat` 的界面）中，模块分析主线 AI 消息的 thinking 在思考结束后突然消失 —— 用户在截图中明显看到"二次检索…请提供请求权法律清单…"这种主线推理内容,但 UI 在 tool_call 一到达就把 thinking 和 text 整块清空。

### 根因

`commit 9e3340d (fix(ui): 优化检索工具的消息展示)` 在前端增加了一段"检索类工具调用时过滤 thinking 和 text"的逻辑：

```ts
// ❌ app/components/ai/composables/useMessageParser.ts（已回退）
const SEARCH_TOOL_NAMES = new Set(['search_law', 'search_case_materials'])
const isSearchOnly = toolCalls.length > 0
  && toolCalls.every(tc => SEARCH_TOOL_NAMES.has(tc.name))
const effectiveThinking = isSearchOnly ? undefined : thinking
const effectiveContent  = isSearchOnly ? '' : content
```

以及 `ModuleResult.vue` 中对应的 `isSearchOnlyMessage` 也做了相同判定。

这段逻辑把"**主 Agent 决定调用 search_law / search_case_materials 的那条主线 AI 消息**"误判成了"意图识别消息"，于是在那条消息上把用户真正要看的 thinking 和 text 一并清空。

### 关键事实：意图识别不在这条消息里

真正的"意图识别"LLM 调用在 `server/services/retrieval/intentClassifier.service.ts::classifyIntentService`，它是 **search 工具内部**（`searchLaw.tool.ts` / `materialPipeline.service.ts` → `retrievalRouter.service.ts::retrievalRouterService`）起的独立小模型调用，用于判定 `exact / hybrid / semantic` 检索策略。它的特点：

1. 使用 `model.withStructuredOutput(outputSchema)`，输出是结构化 JSON `{intent, legalName, articleRef, keywords, rewrittenQuery}`，**完全没有 `tool_calls` 字段**，所以前端 `isSearchOnly`（要求 `tool_calls` 全是 `search_*`）**永远不可能命中这条消息**。
2. 调用时标记 `tags: ['internal']`，`server/services/agent/agentWorker.ts::stripSystemMessages` 会把 `messages` 事件里 `metadata.tags` 含 `'internal'` 的整条事件 `return null`。三类会话（`startCaseAnalysisV2` / `runModuleChat` / `runCaseChat`）都走同一个 `agentWorker.executeRun` → `stripSystemMessages` 流水线 → **前端永远收不到意图识别消息**。

所以"隐藏意图识别的 thinking/text"这件事后端已经完整做了，前端再做任何基于工具名的过滤必然是错位打击。

### 影响范围

所有走 `useMessageParser` 或 `ModuleResult.vue` 的界面：init-analysis 页面、小索、模块对话。症状是：主线 thinking / text 在 AI 决定调用 `search_law` / `search_case_materials` 时整段消失，流式过程中"思考完就不见了"。

### 正确做法

**前端不做任何基于工具名的 thinking/text 过滤**，`thinking` 和 `content` 按原样渲染。

```ts
// ✅ app/components/ai/composables/useMessageParser.ts
const thinking = extractThinking(m as any, false)
if (!content && !toolCalls.length && !thinking) return null
return { id, type: 'ai', content, thinking, toolCalls, raw: m }
```

```ts
// ✅ app/components/initAnalysis/ModuleResult.vue
function getMessageText(message: any): string { /* 直接取 text，不按工具名判空 */ }
function getReasoningText(message: any): string {
  return extractThinking(message as AIMessageType, false) ?? ''
}
```

### 原则

**"隐藏内部 LLM 调用消息"是 SSE/事件源层的职责，前端不该也没能力正确判断"哪条消息属于内部调用"。**

- 新增内部 LLM 调用（如未来新增的 rerank、摘要前置模型等）：在服务端 `invoke(..., { tags: ['internal'] })` 标记，`agentWorker.stripSystemMessages` 会自动剥离。
- 前端永远不要基于 `tool_calls[].name` 去猜某条消息是不是"意图识别/内部调用"。只要这条消息能到前端，就是主 Agent 要给用户看的。

### 相关文件

- 后端意图识别及 tag 标记：`server/services/retrieval/intentClassifier.service.ts:163,177-179`
- 后端 SSE 过滤入口：`server/services/agent/agentWorker.ts:208,229`（`stripSystemMessages` 调用点）
- 后端过滤实现：`server/services/agent/agentWorker.ts:544-612`（`isInternalLLMEvent` / `stripSystemMessages`）
- 前端修复：`app/components/ai/composables/useMessageParser.ts`、`app/components/initAnalysis/ModuleResult.vue`
- 错误提交（反例，勿回退）：`9e3340d fix(ui): 优化检索工具的消息展示`

