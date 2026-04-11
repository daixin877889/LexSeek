# Composables 参考

LexSeek 前端共 34 个 composable，位于 `app/composables/`，全部自动导入无需手动 import。

## 一、数据请求

### useApi（SSR 数据请求）

基于 `useFetch` 的封装，支持 SSR 和响应式。

**适用场景**：组件 setup 阶段、需要 SSR 的数据加载

```typescript
// setup 阶段直接使用
const { data, error, status, refresh } = await useApi<UserInfo>('/api/v1/users/me')

// 事件处理函数中使用（必须 immediate: false）
const { data, execute } = useApi('/api/v1/sms/send', {
    method: 'POST',
    body: { phone, type },
    immediate: false,
})
await execute()
```

**核心行为**：
- 自动通过 `transform` 提取响应中的 `data` 字段
- SSR 阶段自动转发 cookies（`useRequestHeaders(['cookie'])`）
- 业务错误（`success: false`）自动 toast 提示（可通过 `showError: false` 禁用）
- 401 响应自动清理认证状态并跳转登录页

**返回值**：`{ data: Ref<T>, error: Ref, status: Ref, refresh: () => Promise<void> }`

### useApiFetch（客户端数据请求）

基于 `$fetch` 的封装，返回 Promise。

**适用场景**：事件处理函数、不需要 SSR 的请求

```typescript
const data = await useApiFetch<{ items: CaseTypeOption[] }>('/api/v1/case-types')
if (data) {
    // data 已经是 API 响应中 data 字段的内容
    console.log(data.items)
}
```

**核心行为**：
- 自动提取响应中的 `data` 字段返回
- 业务错误返回 `null`，自动 toast 提示
- 401 处理同 useApi

**返回值**：`Promise<T | null>`

### 关键陷阱：data 字段自动提取

```typescript
// API 返回: { code: 0, success: true, data: { id: 1, name: 'test' } }

// ❌ 错误：不要再次访问 .data
const wrong = await useApiFetch('/api/xxx')
wrong?.data?.id  // 永远是 undefined

// ✅ 正确：直接使用返回值
const correct = await useApiFetch('/api/xxx')
correct?.id  // 正确获取到值

// ❌ 错误：类型多嵌套了一层
const r = await useApiFetch<{ data?: { recognized: boolean } }>(`/api/xxx`)
r?.data?.recognized  // undefined

// ✅ 正确：类型直接对应实际数据
const r = await useApiFetch<{ recognized: boolean }>(`/api/xxx`)
r?.recognized  // 正确
```

### useApi vs useApiFetch 对比

| 特性 | useApi | useApiFetch |
|------|--------|-------------|
| 基于 | `useFetch` | `$fetch` |
| 返回值 | `{ data, error, status, refresh }` | `Promise<T \| null>` |
| SSR | 支持 | 不支持 |
| 响应式 | 是 | 否 |
| 适用场景 | setup 阶段 | 事件处理函数 |
| 错误处理 | `error.value` | 返回 `null` |

## 二、流式聊天

### useStreamChat

泛型流管理底层 composable，封装 `@langchain/vue` 的 `useStream` + `FetchStreamTransport`。

```typescript
const stream = useStreamChat<MyState>({
    apiUrl: '/api/v1/case/init-analysis',
    threadId: 'xxx',
    messagesKey: 'messages',
    onCustomEvent: (data) => { /* 自定义事件 */ },
})

// 状态
stream.messages     // computed<BaseMessage[]>
stream.values       // computed<T | undefined>
stream.isLoading    // shallowRef<boolean>
stream.error        // shallowRef
stream.interruptData // computed（绕过 Vue 响应式 bug）
stream.hasHistoryLoaded // ref<boolean>

// 操作
stream.submit(input, config)  // 发送消息或重连
stream.stop()                 // 停止 SSE
stream.reconnect()            // 重连并加载历史
stream.loadHistory()          // 同 reconnect
stream.getMessagesMetadata(msg, idx) // 获取消息元数据
```

**技术细节**：
- `FetchStreamTransport` 走 `useStreamCustom` 路径（非 `useStreamLGP`）
- `useStreamCustom` 返回的 `values/interrupt/messages` 是 ES6 getter（非 Ref）
- `interruptData` 必须从 `values.__interrupt__` 读取，不能用 `stream.interrupt`

## 三、案件相关

### useCaseCreation

案件创建流程管理。

**状态**：`step` / `isExtracting` / `isSubmitting` / `caseTypes` / `extractedFormData` / `uploadedFiles`

**方法**：
- `loadCaseTypes()`: 加载案件类型列表
- `extractCaseInfo(message, files)`: AI 提取案件信息 -> 跳转确认表单
- `createCase(params)`: 创建案件 -> 自动导航到初始分析

### useInitAnalysis

初始分析全生命周期管理（~490 行）。详见 `case-analysis-ui.md`。

**核心状态**：`phase` / `moduleStates` / `allModuleCards` / `mergedResult` / `streamMessages`

**核心方法**：
- `loadStatus()`: 初始化，恢复分析状态
- `startAnalysis()`: 开始分析（提交选中的模块）
- `resumeWorkflow()`: 恢复中断的分析
- `retryModule(name)`: 重试失败的模块

### useCaseDetail

案件详情页数据管理。

**数据**（均为响应式 `useApi` 返回）：
- `caseInfo`: 案件基本信息
- `materials`: 材料列表
- `analysisStatus`: 分析状态

**派生**：
- `allModuleCards`: 7 模块卡片状态
- `analysisResults`: 已完成的分析结果
- `isInitAnalysisRunning` / `hasPendingInterrupt` / `lockedModules`

**操作**：
- `addMaterials(files)` / `deleteMaterials(ids)` / `retryMaterial(id, ossFileId)`

### useCaseChat

基于 `useStreamChat` 的案件对话特化封装。

```typescript
const chat = useCaseChat({ sessionId: 'xxx' })
chat.sendMessage('分析一下合同效力')
chat.stopGeneration()
chat.resumeInterrupt(data)
```

### useChatSessionManager

多 session 管理基类，封装小索和模块对话共同的多 session 生命周期管理。

**功能**：effectScope 管理、竞态防护、hasActiveRun 自动 reconnect、双重取消。

### useModuleChatManager

模块对话多实例管理器。每个分析模块一个 `useChatSessionManager` 实例。

**特有功能**：
- `generatingModules`: 正在生成中的模块列表
- `expandedModule`: 当前展开的模块
- 跨标签页广播模块生成状态

### useXiaosuoChat

小索 AI 助手，基于 `useChatSessionManager` 的薄包装，使用独立的 session API 端点。

## 四、文件操作

### useBatchUpload

批量文件上传管理。

```typescript
const { detectMimeType, validateFile, uploadToOSS } = useBatchUpload()
```

**功能**：
- `detectMimeType(file)`: 检测文件 MIME 类型（含扩展名兜底）
- `validateFile(file, scene)`: 根据场景配置验证文件类型和大小
- `uploadToOSS(file, signature, onProgress, contentType)`: 上传文件到 OSS

### useFileReader

浏览器端文件内容读取。

**支持格式**：
- 文本文件：`.md`, `.mkd`, `.txt` -> 直接读取 UTF-8 文本
- Word 文档：`.docx`, `.doc` -> 使用 mammoth.js 提取

**方法**：
- `readFile(file)` / `readFiles(files)`: 读取文件内容
- `extractDocx(file)`: 提取 docx 内容（HTML + Markdown + 图片）
- `extractMarkdown(file)`: 提取 Markdown 内容和嵌入图片

**图片处理**：支持 base64 内嵌图片和远程 URL 图片，三级降级策略：Canvas -> fetch -> 服务端代理。

### useFileUploadWorker

Web Worker 后台上传，避免阻塞主线程。

```typescript
const worker = useFileUploadWorker()
const taskId = worker.upload(file, signature, {
    onProgress: (p) => {},
    onSuccess: (data) => {},
    onError: (err) => {},
})
worker.cancel(taskId)
```

**特点**：
- 引用计数管理 Worker 生命周期
- 多组件共享同一个 Worker 实例
- 组件卸载时自动释放引用

### useFileRecognition

文件识别状态轮询。

```typescript
const { fileRecognitionStatus, getRecognitionStatus, handleRecognitionResults, stopAllPolling } = useFileRecognition()
```

**参数**：每 2 秒轮询，最多 60 次（2 分钟），标签页不可见时暂停。

### useLocalFileCache

基于 IndexedDB 的本地文件缓存，用于 docx 识别时避免重复下载。

```typescript
const cache = useLocalFileCache()
await cache.cacheFile(ossFileId, file)
const content = await cache.getCachedFile(ossFileId)
await cache.clearExpiredCache()
```

默认 24 小时过期。

## 五、会员/支付

### useMembershipStatus

会员状态判断工具。

```typescript
const { isNotEffective, isHighestLevel } = useMembershipStatus(membershipLevels)
```

- `isNotEffective(startDate)`: 判断会员是否未生效（startDate > now）
- `isHighestLevel(levelId)`: 判断是否为最高级别（基于 sortOrder）

### usePointStatus

积分记录状态判断。

```typescript
const { isAvailable, isNotEffective } = usePointStatus()
```

- `isAvailable(record)`: 判断积分是否在有效期内
- `isNotEffective(record)`: 判断积分是否未生效

### usePurchaseFlow

完整购买流程封装。

```typescript
const purchase = usePurchaseFlow({
    onSuccess: () => { /* 支付成功 */ },
    onCancel: () => { /* 取消 */ },
    onError: (msg) => { /* 失败 */ },
})

purchase.buy(productId)  // 入口方法
```

**流程**：
1. 微信浏览器 -> 跳转专用购买页
2. 未登录 -> 弹出认证弹框 -> 登录后继续购买
3. 已登录 -> 创建订单 -> 显示微信支付二维码 -> 每 2 秒轮询支付状态

### useWechatPayment

微信 JSAPI 支付封装（微信浏览器内支付）。

功能：环境检测、OpenID 获取和缓存（24 小时有效）、JSAPI 调用。

### useOrderStatus

订单状态文本和样式映射（待支付/已支付/已取消/已退款）。

## 六、法律搜索

### useLegalSearch

法律法规列表搜索，支持筛选、分页和统计。

```typescript
const { legalList, loading, search, setFilters, setPage } = useLegalSearch()
await search('合同法')
setFilters({ type: 'law', validityStatus: 'valid' })
```

### useArticleSearch

法条向量语义搜索。

```typescript
const { results, searchArticles } = useArticleSearch()
await searchArticles('借款合同的效力认定', { legalType: 'law' })
```

### useLegalParser

法律内容解析器，将法律文本解析为结构化条文。

### useLegalEditorCache

法律编辑器草稿缓存，使用 localStorage + 防抖保存。退出登录时自动清除。

## 七、UI 工具

### useDraggableResize

可拖拽可缩放窗口 composable，用于模块对话框和小索对话框。

```typescript
const { style, onDragStart, onEdgeDetect, onResizeStart, reset } = useDraggableResize({
    initialWidth: 380,
    initialHeight: 640,
    minWidth: 300,
    minHeight: 350,
    zIndex: zIndexRef,
})
```

**功能**：标题栏拖拽、四边四角 resize、边界纠正、视口缩小自动纠正、动态 z-index。

### useColorMode

颜色模式管理（light/dark/system）。

```typescript
const { colorMode, resolvedMode, isDark, setColorMode, toggleDark } = useColorMode()
```

使用 `useState` 跨组件共享，`localStorage` 持久化。

### useTheme

主题色管理（8 种预设主题色）。

```typescript
const { themeColor, themeColors, setThemeColor, initTheme } = useTheme()
setThemeColor('blue')
```

通过 `<html>` 标签的 CSS 类切换主题（如 `theme-blue`）。

### useFormatters

通用格式化工具集。

```typescript
const { formatDate, formatDateRelative, formatAmount, formatNumber } = useFormatters()

formatDate('2024-01-15T10:30:00Z')         // '2024-01-15 18:30'
formatDateRelative('2024-01-14T10:30:00Z')  // '昨天'
formatAmount(1234.5)                         // '1234.50'
formatNumber(1234567)                        // '1,234,567'
```

## 八、其他

### useUrlState

URL 查询参数与筛选状态双向同步。

```typescript
const { syncToUrl, restoreFromUrl } = useUrlState({
    defaultValues: { keyword: '', type: 'all', page: 1 },
    validValues: { type: ['all', 'law', 'regulation'] },
})

onMounted(() => {
    const state = restoreFromUrl()  // 从 URL 恢复
})

watch(filter, () => {
    syncToUrl(filter)  // 同步到 URL
})
```

等于默认值的参数不出现在 URL 中，保持 URL 简洁。

### useCrossTabEvents

跨标签页事件通信（基于 BroadcastChannel）。

```typescript
// 发送
postCrossTabEvent('analysis:updated', { caseId: 123 })

// 监听（自动清理）
useCrossTabListener('analysis:updated', (data) => {
    if (data.caseId === currentCaseId.value) refreshAnalysis()
})
```

已定义的事件类型：
- `analysis:updated`: 分析结果更新
- `module:generating`: 模块对话生成状态
- `points:changed`: 积分变化（预留）
- `auth:logout`: 登出（预留）

### useUserNavigation

用户导航操作封装（退出登录、重置 store、跳转）。

### useAdminMenu

Admin 菜单数据处理，配合 `useAdminMenuStore` 使用。

### useStopActiveRun

双重取消：SSE stop + 查询 runId + 调用 cancel API。

```typescript
await stopActiveRun(sessionId)
```
