# 案件信息提取增强实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 让 `/api/v1/case/extract` 接口能够读取用户上传文件的实际内容，而非仅依赖 `ossFileId` 文本描述。

**架构方案：**
- 前端在调用提取接口前，先创建案件（title="未命名案件"）
- 后端 `extract` API 接收 `caseId` 后，复用现有材料流水线（识别→嵌入→上下文构建），将实际内容注入 LLM
- Token 超限时自动切换 summary 模式，LLM 通过 `search_case_materials` 工具按需检索详情

**技术栈：** Nuxt 4 + Vue 3 + TypeScript + Prisma + LangChain

---

## 文件变更总览

| 文件 | 改动类型 | 职责 |
|------|---------|------|
| `server/services/case/caseType.service.ts` | 新增函数 | 获取第一条可用案件类型 |
| `server/api/v1/case/create.post.ts` | 修改 | caseTypeId 为空时在 API 层取第一条可用记录，错误码 400 |
| `server/api/v1/case/extract.post.ts` | 重写核心逻辑 | 新增 caseId → 读取材料 → 就绪检查 → 上下文 → 提取 |
| `app/composables/useCaseCreation.ts` | 修改 | extractCaseInfo 简化为只接收 caseId + message |
| `app/pages/dashboard/cases/create.vue` | 修改 | handleAiSubmit 先调 createCase 再调 extract |
| `tests/server/case/caseType.service.test.ts` | 新增/修改 | 新增 caseTypeId 默认值测试 |

> **注意**：ManualForm 和 CreateCaseParams 不需要改动。前端表单本来就传 caseTypeId，后端兜底逻辑仅作防御性处理。

---

## 前置信息

### 核心设计决策

**extract API 不承担材料添加职责**，仅读取 `caseId` 已有材料后执行提取。原因：
- `createCase` 时已通过 `batchAddCaseMaterialsService` 添加材料
- `extract` 专注提取，无需重复管理材料
- 前端 `create.vue` 调用流程：`createCase`（含材料）→ `extract`（只读）

### extract API 参数说明

| 参数 | 说明 |
|------|------|
| caseId | 必填，案件 ID |
| message | 必填，用户消息 |

### caseTypeId 默认值逻辑

`findEnabledCaseTypesDao` 按 `priority asc` 排序，取 `list[0]` 即第一条可用记录。在 create API 层实现默认值，不改 schema optional。

### 材料上下文 token 阈值

`TOKEN_THRESHOLD = 32000`，超限时：
1. 自动生成摘要（`material_summarizer` 节点）
2. 切换 summary 模式
3. LLM 可通过 `search_case_materials` 工具检索详情

### 现有可复用服务

| 服务 | 职责 |
|------|------|
| `getMaterialsByCaseIdService` | 获取案件所有材料 |
| `ensureMaterialsReadyService` | 确保材料识别+嵌入就绪 |
| `getMaterialContextService` | 构建材料上下文（含 token 阈值处理） |
| `buildMaterialContextMessage` | 生成材料上下文文本 |
| `getEnabledCaseTypesService` | 获取可用案件类型列表 |
| `validateCaseAccessService` | 验证用户对案件的访问权限 |

---

## 任务列表

### Task 1: 后端 — 新增 `getFirstEnabledCaseTypeService`

**文件:**
- Modify: `server/services/case/caseType.service.ts`

- [ ] **Step 1: 添加函数**

在 `getEnabledCaseTypesService` 后追加：

```typescript
/**
 * 获取第一条启用的案件类型（按 priority 排序）
 * 用于创建案件时未指定类型时的默认值
 */
export const getFirstEnabledCaseTypeService = async (): Promise<caseTypes | null> => {
    const list = await findEnabledCaseTypesDao()
    return list[0] ?? null
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/case/caseType.service.ts
git commit -m "feat(case): 新增 getFirstEnabledCaseTypeService 获取第一条可用案件类型"
```

---

### Task 2: 后端 — create.post.ts 实现 caseTypeId 默认值

**文件:**
- Modify: `server/api/v1/case/create.post.ts`

> **关键**：不改 schema 的 caseTypeId 为 optional，只在 API 层逻辑中处理空值。schema 保持必填。

- [ ] **Step 1: 添加 caseTypeId 默认值解析逻辑**

在 `const { title, content, caseTypeId, ... } = result.data` 之前添加：

```typescript
// 如果未提供 caseTypeId，取第一条可用记录
let caseTypeId = result.data.caseTypeId
if (!caseTypeId) {
    const firstType = await getFirstEnabledCaseTypeService()
    if (!firstType) {
        return resError(event, 400, '系统未配置任何案件类型，请联系管理员')
    }
    caseTypeId = firstType.id
}
```

（`getFirstEnabledCaseTypeService` 已自动导入，无需 import）

- [ ] **Step 2: Commit**

```bash
git add server/api/v1/case/create.post.ts
git commit -m "feat(api): create 接口支持 caseTypeId 为空时取第一条可用记录"
```

---

### Task 3: 后端 — 重写 extract.post.ts 核心逻辑

**文件:**
- Modify: `server/api/v1/case/extract.post.ts`

> **职责说明**：extract API 仅读取 `caseId` 已有材料，不承担材料添加职责。材料在 `createCase` 时已通过 `batchAddCaseMaterialsService` 添加。

- [ ] **Step 1: 更新 schema**

将 Zod schema 从：
```typescript
const schema = z.object({
    message: z.string().min(1),
    materials: z.array(z.object({
        ossFileId: z.number().int().positive(),
        name: z.string(),
    })).optional(),
})
```

改为：
```typescript
const schema = z.object({
    /** 案件 ID（必填） */
    caseId: z.number().int().positive({ message: '案件 ID 必须为正整数' }),
    /** 用户消息 */
    message: z.string().min(1),
})
```

（移除了 `materials` 和 `sessionId` 参数 — 材料由 createCase 添加，extract 只读。`HumanMessage`、`SystemMessage`、`getValidNodeConfig`、`createChatModel` 的原有 import 保留。）

- [ ] **Step 2: 替换处理逻辑（完整实现）**

将 `defineEventHandler` 函数体从 `// 2. 解析请求体` 到末尾全部替换为以下完整实现：

```typescript
// 2. 解析请求体
const body = await readBody(event)
const parsed = schema.safeParse(body)
if (!parsed.success) {
    return resError(event, 400, parsed.error.issues[0]?.message ?? '参数校验失败')
}

const { caseId, message } = parsed.data

// 3. 验证案件归属（case.service 自动导入）
await validateCaseAccessService(caseId, user.id)

// 4. 获取案件材料
const materials = await getMaterialsByCaseIdService(caseId)

// 5. 确保材料就绪（识别 + 嵌入）
const { materials: readyMaterials, failed } = await ensureMaterialsReadyService(caseId, user.id)

if (failed.length > 0) {
    logger.warn('部分材料识别失败', { caseId, failed })
}

// 6. 构建材料上下文（token 超限时自动切换 summary 模式）
const materialContextResult = await getMaterialContextService(readyMaterials)
const materialContextText = buildMaterialContextMessage(materialContextResult)

logger.info('材料上下文构建完成', {
    caseId,
    mode: materialContextResult.mode,
    totalTokens: materialContextResult.totalTokens,
    materialCount: readyMaterials.length,
})

// 7. 加载 extractInfo 节点配置
let nodeConfig
try {
    nodeConfig = await getValidNodeConfig(EXTRACT_NODE_NAME, '信息提取')
} catch (err: any) {
    return resError(event, 500, err.message)
}

const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
if (!activeApiKey) {
    return resError(event, 500, '信息提取节点无可用 API 密钥')
}

// 8. 创建模型（提取任务用低温度）
const model = createChatModel({
    sdkType: nodeConfig.modelSdkType,
    modelName: nodeConfig.modelName,
    apiKey: activeApiKey.apiKey,
    baseUrl: nodeConfig.modelProviderBaseUrl,
    temperature: 0,
    streaming: false,
})

// 9. 构建提示
const systemPromptConfig = nodeConfig.prompts?.find(
    (p: { type: string; status: number }) => p.type === 'system' && p.status === 1,
)
const systemPrompt = systemPromptConfig?.content ?? ''
const materialContext = materialContextResult.materialList.length > 0
    ? '\n\n' + materialContextText
    : ''

// 10. 查询可用案件类型，限制模型只能从中选择
const enabledCaseTypes = await getEnabledCaseTypesService()
const caseTypeNames = enabledCaseTypes.map(ct => ct.name)
const caseTypeConstraint = `\n\n## 案件类型约束\n案件类型（caseType）必须从以下列表中选择，不得自行创造：\n${caseTypeNames.map(n => `- ${n}`).join('\n')}\n如果无法确定案件类型，请选择最接近的一个。`

try {
    const messages = [
        new SystemMessage(systemPrompt + materialContext + caseTypeConstraint),
        new HumanMessage(message),
    ]

    // 11. 调用模型（结构化输出或普通文本）
    if (nodeConfig.outputSchema) {
        const structuredModel = model.withStructuredOutput(nodeConfig.outputSchema)
        const result = await structuredModel.invoke(messages)
        return resSuccess(event, '提取成功', {
            message: '已为您提取案件信息，请确认以下内容：',
            extractedInfo: result,
            materialContext: {
                mode: materialContextResult.mode,
                totalMaterials: readyMaterials.length,
                failedMaterials: failed.map(f => ({ name: f.name, error: f.error })),
            },
        })
    } else {
        const result = await model.invoke(messages)
        const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
        return resSuccess(event, '提取成功', {
            message: content,
            extractedInfo: null,
            materialContext: {
                mode: materialContextResult.mode,
                totalMaterials: readyMaterials.length,
                failedMaterials: failed.map(f => ({ name: f.name, error: f.error })),
            },
        })
    }
} catch (err: any) {
    logger.error('信息提取失败:', err)
    return resError(event, 500, '信息提取失败，请重试')
}
```

> **注意**：`getMaterialsByCaseIdService`、`ensureMaterialsReadyService`、`getMaterialContextService`、`buildMaterialContextMessage`、`getEnabledCaseTypesService`、`validateCaseAccessService` 均已在 Nuxt 自动导入范围内，无需手动 import。`EXTRACT_NODE_NAME`、`getValidNodeConfig`、`createChatModel`、`HumanMessage`、`SystemMessage` 的原有 import 保留。

- [ ] **Step 3: 验证类型**

Run: `npx nuxi typecheck 2>&1 | head -30`
Expected: 无新增类型错误

- [ ] **Step 4: Commit**

```bash
git add server/api/v1/case/extract.post.ts
git commit -m "feat(api): extract 接口接入材料流水线，支持识别、嵌入和上下文构建"
```

---

### Task 4: 前端 — useCaseCreation extractCaseInfo 简化

**文件:**
- Modify: `app/composables/useCaseCreation.ts`

> extract API 不再接收 materials 参数，材料已在 createCase 时添加。extractCaseInfo 简化为传 caseId + message。

- [ ] **Step 1: 修改 extractCaseInfo 签名和请求体**

将 `extractCaseInfo` 改为：
```typescript
async function extractCaseInfo(message: string, caseId: number) {
    isExtracting.value = true
    try {
        const text = message.trim() || '请根据上传的材料提取案件信息'

        const result = await useApiFetch<{
            message: string
            extractedInfo?: ExtractedCaseInfo
            materialContext?: { mode: string; totalMaterials: number }
        }>('/api/v1/case/extract', {
            method: 'POST',
            body: {
                caseId,
                message: text,
            },
        })

        if (result?.extractedInfo) {
            rawExtractedInfo.value = result.extractedInfo
            extractedFormData.value = {
                ...mapExtractedInfoToFormData(result.extractedInfo, caseTypes.value),
                content: message.trim() || undefined,
            }
            step.value = 'confirm'
        } else {
            toast.warning(result?.message || '未能提取到案件信息，请尝试补充描述或手动创建')
        }
    } catch {
        toast.error('提取失败，请重试或切换到手动创建')
    } finally {
        isExtracting.value = false
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/composables/useCaseCreation.ts
git commit -m "feat(ui): extractCaseInfo 简化为只接收 caseId 和 message"
```

---

### Task 5: 前端 — create.vue 实现两步调用

**文件:**
- Modify: `app/pages/dashboard/cases/create.vue`

- [ ] **Step 1: 修改 handleAiSubmit**

将:
```typescript
async function handleAiSubmit(data: AiPromptSubmitData) {
  await extractCaseInfo(data.text, data.files)
}
```

改为:
```typescript
async function handleAiSubmit(data: AiPromptSubmitData) {
  // step1: 先创建案件（title="未命名案件"，caseTypeId 由后端取第一条可用记录）
  let caseId: number | null = null
  try {
    const createResult = await useApiFetch<{ caseId: number }>('/api/v1/case/create', {
      method: 'POST',
      body: {
        title: '未命名案件',
        // caseTypeId 不传，后端自动取第一条可用记录
        content: data.text.trim() || undefined,
        materials: data.files?.map(f => ({
          type: getMaterialType(f.fileType),
          name: f.fileName,
          ossFileId: f.id,
        })),
      },
    })
    caseId = createResult?.caseId ?? null
  } catch {
    toast.error('创建案件失败，请重试')
    return
  }

  if (!caseId) {
    toast.error('创建案件失败，请重试')
    return
  }

  // step2: 提取案件信息（材料已在 createCase 时添加到案件，extract 只读）
  await extractCaseInfo(data.text, caseId)
}
```

头部 import 中确认已包含：
```typescript
import { toast } from 'vue-sonner'
import { getMaterialType } from '~/utils/caseMaterial'
```

- [ ] **Step 2: Commit**

```bash
git add app/pages/dashboard/cases/create.vue
git commit -m "feat(ui): create 页面提取前先创建案件"
```

---

### Task 6: 测试 — caseTypeId 默认值逻辑

**文件:**
- Modify 或 Create: `tests/server/case/caseType.service.test.ts`

> 测试应直接测 `getFirstEnabledCaseTypeService`，而非 `createCaseService`（Service 层不支持 caseTypeId 为空，默认值在 API 层实现）。

- [ ] **Step 1: 编写测试用例**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { getFirstEnabledCaseTypeService } from '~~/server/services/case/caseType.service'

describe('getFirstEnabledCaseTypeService', () => {
    it('应返回按 priority 排序的第一条启用记录', async () => {
        const first = await getFirstEnabledCaseTypeService()
        expect(first).not.toBeNull()

        // 验证返回的是 priority 最小的
        const all = await prisma.caseTypes.findMany({
            where: { status: 1, deletedAt: null },
            orderBy: { priority: 'asc' },
            take: 1,
        })
        expect(first!.id).toBe(all[0]!.id)
    })

    it('无启用记录时应返回 null', async () => {
        // 临时禁用所有记录
        await prisma.caseTypes.updateMany({
            data: { status: 0 },
        })

        const result = await getFirstEnabledCaseTypeService()
        expect(result).toBeNull()

        // 恢复
        await prisma.caseTypes.updateMany({
            data: { status: 1 },
        })
    })
})
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/server/case/caseType.service.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/server/case/caseType.service.test.ts
git commit -m "test(case): add test for getFirstEnabledCaseTypeService"
```

---

## 验证清单

完成所有任务后，按以下步骤验证：

1. **类型检查** — `npx nuxi typecheck 2>&1 | head -30`
2. **单元测试** — `npx vitest run tests/server/case/`
3. **手动测试流程**：
   - 访问 `/dashboard/cases/create`
   - 上传 PDF/图片/文本文件
   - 点击"提取信息"
   - 确认案件被创建（title="未命名案件"）
   - 确认提取结果包含文件实际内容而非 ossFileId 文本
   - 跳转到确认页
   - 确认案件类型有默认值且可修改

---

## 已知限制

- **extract API 不处理材料添加**：这是设计决策，简化职责。材料统一由 `createCase` 添加。
- **前端提取失败兜底**：如果 `createCase` 成功但 `extract` 失败，案件已创建。用户可重新从案件详情页发起分析。
