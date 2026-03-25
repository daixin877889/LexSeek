# 案件信息提取与中断确认 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将案件信息提取节点重构为带工具调用和结构化输出的 Agent 节点，支持中断确认和三层存储

**Architecture:** extractInfo 工作流节点内部使用 `createDeepAgent`（deepagents SDK）创建临时 Agent，通过 `responseFormat`（toolStrategy）同时支持工具调用和结构化输出。Agent 自主调用工具查询案件材料后输出结构化 JSON，调用 `interrupt()` 暂停等待用户确认，确认后执行三层存储（DB 固定字段 + JSONB + PostgresStore 长期记忆）。

**Tech Stack:** deepagents SDK, LangChain `toolStrategy`, LangGraph `interrupt()`, PostgresStore, Prisma, Vue 3

**Spec:** `docs/superpowers/specs/2026-03-25-extract-case-info-interrupt-design.md`

---

## Task 1: 数据库 Schema 变更

**Files:**
- Modify: `prisma/models/case.prisma`
- Modify: `prisma/models/node.prisma`

- [ ] **Step 1: 修改 case.prisma — 新增 summary 和 extractedInfo 字段**

在 `cases` 模型的 `defendant` 字段之后添加：

```prisma
    /// 案件概述（从提取结果同步）
    summary       String?   @db.Text
    /// 全量提取结果（固定字段+动态扩展字段）
    extractedInfo Json?     @map("extracted_info") @db.JsonB
```

- [ ] **Step 2: 修改 node.prisma — 新增 outputSchema 字段**

在 `nodes` 模型的 `tools` 字段之后添加：

```prisma
    /// 结构化输出 schema（JSON Schema 格式，用于 extraction 类型节点）
    outputSchema Json?     @map("output_schema") @db.JsonB
```

- [ ] **Step 3: 生成并运行 Prisma migration**

Run: `bun run prisma:migrate -- --name add_extracted_info_and_output_schema`
Expected: Migration 成功，两个表新增字段

- [ ] **Step 4: 验证 migration**

Run: `bun run prisma:generate`
Expected: Prisma Client 重新生成成功

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(db): 新增 cases.extractedInfo/summary 和 nodes.outputSchema 字段"
```

---

## Task 2: 共享类型定义

**Files:**
- Modify: `shared/types/case.ts`

- [ ] **Step 1: 在 shared/types/case.ts 中新增 ExtractedInfo 类型**

在文件末尾添加提取结果的类型定义：

```typescript
/** 扩展字段项（LLM 根据案件类型自动提取的额外信息） */
export interface ExtraField {
  /** 英文标识（camelCase） */
  name: string
  /** 中文名称 */
  title: string
  /** 提取的值 */
  value: string
}

/** 结构化提取结果（固定字段 + 动态扩展字段） */
export interface ExtractedCaseInfo {
  /** 案件标题 */
  title: string
  /** 原告列表 */
  plaintiff: string[]
  /** 被告列表 */
  defendant: string[]
  /** 案件类型（必须匹配 case_types 表中的值） */
  caseType: string
  /** 案件概述 */
  summary: string
  /** 扩展字段列表 */
  extraFields: ExtraField[]
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/types/case.ts
git commit -m "feat(types): 新增 ExtractedCaseInfo 和 ExtraField 类型定义"
```

---

## Task 3: 案件信息存储服务

**Files:**
- Create: `server/services/case/caseExtraction.service.ts`
- Test: `tests/server/case/caseExtraction.service.test.ts`

- [ ] **Step 1: 编写 saveCaseInfoService 的测试**

```typescript
// tests/server/case/caseExtraction.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
vi.mock('~~/server/utils/prisma', () => ({
  prisma: {
    cases: { update: vi.fn() },
  },
}))

// Mock store
vi.mock('~~/server/services/workflow/checkpointer', () => ({
  getStore: vi.fn(() => ({ put: vi.fn() })),
}))

describe('saveCaseInfoService', () => {
  it('匹配 caseType 时应更新 caseTypeId', async () => {
    const { saveCaseInfoService } = await import(
      '~~/server/services/case/caseExtraction.service'
    )
    const caseTypes = [{ id: 1, name: '民事' }, { id: 2, name: '刑事' }]
    const data = {
      title: '测试案件',
      plaintiff: ['张三'],
      defendant: ['李四'],
      caseType: '民事',
      summary: '测试摘要',
      extraFields: [],
    }

    await saveCaseInfoService(1, data, caseTypes)

    const { prisma } = await import('~~/server/utils/prisma')
    expect(prisma.cases.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ caseTypeId: 1 }),
      }),
    )
  })

  it('caseType 不匹配时不更新 caseTypeId', async () => {
    const { saveCaseInfoService } = await import(
      '~~/server/services/case/caseExtraction.service'
    )
    const caseTypes = [{ id: 1, name: '民事' }]
    const data = {
      title: '测试案件',
      plaintiff: ['张三'],
      defendant: ['李四'],
      caseType: '未知类型',
      summary: '测试摘要',
      extraFields: [],
    }

    await saveCaseInfoService(1, data, caseTypes)

    const { prisma } = await import('~~/server/utils/prisma')
    expect(prisma.cases.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ caseTypeId: expect.anything() }),
      }),
    )
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/case/caseExtraction.service.test.ts --reporter=verbose`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 saveCaseInfoService 和 formatCaseInfo**

```typescript
// server/services/case/caseExtraction.service.ts
import type { ExtractedCaseInfo } from '#shared/types/case'
import { getStore } from '../workflow/checkpointer'

/**
 * 三层存储：DB 固定字段 + JSONB + PostgresStore 长期记忆
 */
export async function saveCaseInfoService(
  caseId: number,
  confirmedData: ExtractedCaseInfo,
  caseTypes: Array<{ id: number; name: string }>,
): Promise<void> {
  // 1. caseType 匹配
  const matchedType = caseTypes.find(t => t.name === confirmedData.caseType)
  if (!matchedType) {
    logger.warn('caseType 未匹配 case_types 表', {
      caseId,
      caseType: confirmedData.caseType,
    })
  }

  // 2. DB 固定字段 + JSONB
  await prisma.cases.update({
    where: { id: caseId },
    data: {
      title: confirmedData.title,
      plaintiff: confirmedData.plaintiff,
      defendant: confirmedData.defendant,
      summary: confirmedData.summary,
      extractedInfo: confirmedData as any,
      ...(matchedType ? { caseTypeId: matchedType.id } : {}),
    },
  })

  // 3. 长期记忆
  const store = await getStore()
  await store.put(['cases', String(caseId)], 'basic_info', {
    text: formatCaseInfo(confirmedData),
    ...confirmedData,
  })
}

/**
 * 将 ExtractedCaseInfo 格式化为 LLM 友好的文本
 */
export function formatCaseInfo(data: ExtractedCaseInfo): string {
  const lines: string[] = [
    `案件名称：${data.title}`,
    `原告：${data.plaintiff.join('、')}`,
    `被告：${data.defendant.join('、')}`,
    `案件类型：${data.caseType}`,
    `概述：${data.summary}`,
  ]

  for (const field of data.extraFields) {
    lines.push(`${field.title}：${field.value}`)
  }

  return lines.join('\n')
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/case/caseExtraction.service.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 编写 formatCaseInfo 测试**

```typescript
describe('formatCaseInfo', () => {
  it('应正确格式化固定字段和扩展字段', async () => {
    const { formatCaseInfo } = await import(
      '~~/server/services/case/caseExtraction.service'
    )
    const result = formatCaseInfo({
      title: '张三与李四买卖合同纠纷',
      plaintiff: ['张三'],
      defendant: ['李四'],
      caseType: '民事',
      summary: '原告张三购买车辆',
      extraFields: [
        { name: 'amount', title: '涉案金额', value: '68万元' },
      ],
    })

    expect(result).toContain('案件名称：张三与李四买卖合同纠纷')
    expect(result).toContain('涉案金额：68万元')
  })
})
```

- [ ] **Step 6: 运行测试验证通过**

Run: `npx vitest run tests/server/case/caseExtraction.service.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/services/case/caseExtraction.service.ts tests/server/case/
git commit -m "feat(analysis): 新增案件信息三层存储服务 saveCaseInfoService"
```

---

## Task 4: extractInfo 节点重构为 Agent 节点

**Files:**
- Modify: `server/services/workflow/nodes/extractInfo.ts`
- Modify: `server/services/workflow/state.ts`（新增 extractedInfo 状态字段）

**参考文件（理解现有模式）:**
- `server/services/agent/caseAgent.ts` — createDeepAgent 用法
- `server/services/node/node.service.ts` — getValidNodeConfig API
- `server/services/node/chatModelFactory.ts` — createChatModel API

> 这是最大的改动。现有 `extractInfo.ts`（524 行）需要大幅重构：
> - 移除 `aggregatedContent` 依赖
> - 移除手动 JSON 解析逻辑（`parseExtractedInfo`, `extractFromText`）
> - 新增 `createDeepAgent` + `responseFormat` 结构化提取
> - 新增 `case_types` 表查询和 prompt 注入
> - 保留 `interrupt()` + `Command` 中断恢复机制

- [ ] **Step 1: 在 state.ts 中新增 extractedInfo 状态字段**

在 `basicInfoConfirmed` 之后添加：

```typescript
    /** 结构化提取结果（固定字段+扩展字段） */
    extractedInfo: Annotation<ExtractedCaseInfo | null>({
        reducer: replaceReducer,
        default: () => null,
    }),
```

同时在 `createInitialState` 中添加 `extractedInfo: null`。

需要 `import type { ExtractedCaseInfo } from '#shared/types/case'`。

- [ ] **Step 2: 重写 extractInfo.ts — 导入和常量**

替换整个文件头部的导入和类型定义：

```typescript
import { interrupt, Command } from '@langchain/langgraph'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { createDeepAgent } from 'deepagents'
import { toolStrategy } from 'langchain'
import { createChatModel } from '../../node/chatModelFactory'
import { getValidNodeConfig } from '../../node/node.service'
import { getToolInstancesService } from '../tools'
import { getCheckpointer } from '../checkpointer'
import { renderContent } from '../../node/prompt.service'
import { saveCaseInfoService } from '../../case/caseExtraction.service'
import type { CaseAnalysisState, CaseAnalysisStateUpdate } from '../state'
import type { ExtractedCaseInfo } from '#shared/types/case'
import { InterruptType, WorkflowPhase } from '#shared/types/case'
import { logger } from '#shared/utils/logger'

export const EXTRACT_INFO_NODE_NAME = 'extract_info'
export const EXTRACT_INFO_NODE_CONFIG_NAME = 'extractInfo'
```

- [ ] **Step 3: 重写 extractInfoNode 主函数**

```typescript
export async function extractInfoNode(
    state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate | Command> {
    const { caseId, sessionId, userId, basicInfoConfirmed } = state

    logger.info('基本信息提取节点开始执行', { caseId, sessionId })

    try {
        // 已确认则跳过
        if (basicInfoConfirmed) {
            return {
                currentPhase: WorkflowPhase.MODULE_SELECT,
                messages: [new AIMessage({ content: '基本信息已确认，正在获取可用的分析模块...' })],
            }
        }

        // 1. 获取节点配置
        const nodeConfig = await getValidNodeConfig(EXTRACT_INFO_NODE_CONFIG_NAME, '基本信息提取')

        // 2. 查询 case_types 可选值
        const caseTypes = await prisma.caseTypes.findMany({
            where: { status: 1, deletedAt: null },
            select: { id: true, name: true },
            orderBy: { priority: 'asc' },
        })
        const caseTypeOptions = caseTypes.map(t => t.name).join('、')

        // 3. 加载工具（从节点配置动态读取）
        const tools = getToolInstancesService(nodeConfig.tools, {
            userId,
            caseId,
            sessionId,
        })

        // 4. 创建模型
        const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
        if (!activeApiKey) {
            throw new Error(`${EXTRACT_INFO_NODE_CONFIG_NAME} 节点没有可用的 API 密钥`)
        }
        const model = createChatModel({
            sdkType: nodeConfig.modelSdkType,
            modelName: nodeConfig.modelName,
            apiKey: activeApiKey.apiKey,
            baseUrl: nodeConfig.modelProviderBaseUrl,
            temperature: 0.3,
            streaming: false,
        })

        // 5. 渲染 system prompt（注入 caseTypeOptions）
        const systemPromptConfig = nodeConfig.prompts.find(p => p.type === 'system' && p.status === 1)
        if (!systemPromptConfig) {
            throw new Error(`${EXTRACT_INFO_NODE_CONFIG_NAME} 节点缺少生效的系统提示词`)
        }
        const systemPrompt = renderContent(systemPromptConfig.content, { caseTypeOptions })

        // 6. 获取 outputSchema（必须在 Task 8 完成后 NodeConfig 已包含此字段）
        const { outputSchema } = nodeConfig
        if (!outputSchema) {
            throw new Error(`${EXTRACT_INFO_NODE_CONFIG_NAME} 节点未配置 outputSchema`)
        }

        // 7. 创建 Agent（工具 + 结构化输出）
        const checkpointer = await getCheckpointer()
        const agent: any = createDeepAgent({
            model,
            systemPrompt,
            tools,
            checkpointer,
            responseFormat: toolStrategy(outputSchema),
        })

        // 8. Agent 自主执行
        const result = await agent.invoke(
            { messages: state.messages },
            {
                configurable: { thread_id: `${sessionId}-extract-${Date.now()}` },
            },
        )
        const extracted: ExtractedCaseInfo = result.structuredResponse

        logger.info('结构化提取完成', {
            caseId,
            title: extracted.title,
            caseType: extracted.caseType,
            extraFieldsCount: extracted.extraFields.length,
        })

        // 9. interrupt 暂停等待用户确认
        const userInput = interrupt({
            type: InterruptType.BASIC_INFO_CONFIRM,
            message: '已从案件材料中提取以下信息，请确认或修改',
            extractedInfo: extracted,
        })

        // 10. 解析用户确认
        const confirmedData = parseUserConfirmation(userInput, extracted)

        // 11. 三层存储
        await saveCaseInfoService(caseId, confirmedData, caseTypes)

        logger.info('案件信息已保存', { caseId, title: confirmedData.title })

        // 12. 继续执行模块选择
        return new Command({
            update: {
                title: confirmedData.title,
                plaintiff: confirmedData.plaintiff,
                defendant: confirmedData.defendant,
                summary: confirmedData.summary,
                caseTypeName: confirmedData.caseType,
                extractedInfo: confirmedData,
                basicInfoConfirmed: true,
                currentPhase: WorkflowPhase.MODULE_SELECT,
                messages: [
                    new HumanMessage({
                        content: `用户确认基本信息：\n标题：${confirmedData.title}\n原告：${confirmedData.plaintiff.join('、')}\n被告：${confirmedData.defendant.join('、')}`,
                    }),
                    new AIMessage({
                        content: '基本信息已确认保存，正在获取可用的分析模块...',
                    }),
                ],
            },
            goto: 'module_select',
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        logger.error('基本信息提取节点执行异常', { caseId, error: errorMessage })
        return {
            error: `基本信息提取异常: ${errorMessage}`,
            currentPhase: WorkflowPhase.EXTRACT_INFO,
            messages: [
                new AIMessage({
                    content: `基本信息提取过程中发生异常：${errorMessage}。请稍后重试。`,
                }),
            ],
        }
    }
}
```

- [ ] **Step 4: 重写 parseUserConfirmation（支持 extraFields）**

```typescript
function parseUserConfirmation(
    userInput: unknown,
    defaultInfo: ExtractedCaseInfo,
): ExtractedCaseInfo {
    if (typeof userInput === 'object' && userInput !== null) {
        const input = userInput as Partial<ExtractedCaseInfo>
        return {
            title: input.title || defaultInfo.title,
            plaintiff: input.plaintiff || defaultInfo.plaintiff,
            defendant: input.defendant || defaultInfo.defendant,
            caseType: input.caseType || defaultInfo.caseType,
            summary: input.summary || defaultInfo.summary,
            extraFields: input.extraFields || defaultInfo.extraFields,
        }
    }

    // 字符串输入（简单确认或 JSON）
    const inputStr = String(userInput).trim()
    if (/^(确认|确定|ok|yes|是|好的|可以|没问题)$/i.test(inputStr)) {
        return defaultInfo
    }

    try {
        const parsed = JSON.parse(inputStr) as Partial<ExtractedCaseInfo>
        return {
            title: parsed.title || defaultInfo.title,
            plaintiff: parsed.plaintiff || defaultInfo.plaintiff,
            defendant: parsed.defendant || defaultInfo.defendant,
            caseType: parsed.caseType || defaultInfo.caseType,
            summary: parsed.summary || defaultInfo.summary,
            extraFields: parsed.extraFields || defaultInfo.extraFields,
        }
    } catch {
        return defaultInfo
    }
}
```

- [ ] **Step 5: 移除不再需要的函数**

删除以下函数（已被 Agent + responseFormat 取代）：
- `extractBasicInfo`
- `validateNodeConfig`
- `buildPrompts`
- `createChatModelFromConfig`
- `parseExtractedInfo`
- `extractFromText`
- `formatInterruptMessage`
- 旧的 `ExtractedInfoSchema`、`ExtractedInfo` 类型、`ConfirmedInfo` 接口、`ExtractInfoInterruptData` 接口

保留：
- `isBasicInfoConfirmed`
- `getExtractedBasicInfo`（需更新返回类型为 `ExtractedCaseInfo`）
- 常量 `EXTRACT_INFO_NODE_NAME` / `EXTRACT_INFO_NODE_CONFIG_NAME`

- [ ] **Step 6: 更新 getExtractedBasicInfo 函数**

```typescript
export function getExtractedBasicInfo(state: CaseAnalysisState): ExtractedCaseInfo | null {
    return state.extractedInfo ?? null
}
```

- [ ] **Step 7: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 8: Commit**

```bash
git add server/services/workflow/nodes/extractInfo.ts server/services/workflow/state.ts
git commit -m "refactor(analysis): 重构 extractInfo 为 Agent 节点（createDeepAgent + responseFormat）"
```

---

## Task 5: 中断恢复支持（Worker + API + Agent）

**Files:**
- Modify: `server/api/v1/case/analysis/chat.post.ts:107-109`
- Modify: `server/services/agent/caseAgent.ts:154-173`（runCaseChat）
- Modify: `server/services/agent/agentWorker.ts:114-139`（executeRun）

> `chat.post.ts` 已经提取 `command` 参数（第 24 行），但第 107 行 `if (!message)`
> 会阻断纯 command 请求（中断恢复时无 message 只有 command）。需修复此逻辑。

- [ ] **Step 1: 修改 chat.post.ts 允许 command-only 请求**

将第 107-109 行：
```typescript
    if (!message) {
      // 无活跃 run + 无消息 → 返回错误
      return resError(event, 400, '消息不能为空')
    }
```

改为：
```typescript
    if (!message && !command) {
      // 无活跃 run + 无消息也无 command → 返回错误
      return resError(event, 400, '消息不能为空')
    }
```

- [ ] **Step 2: 修改 runCaseChat 支持 command 参数**

在 `caseAgent.ts` 中，修改 `runCaseChat` 函数签名和实现：

```typescript
export async function runCaseChat(
    sessionId: string,
    message: string | undefined,
    options: CaseAgentOptions & { command?: unknown },
) {
    const { command, ...agentOptions } = options
    const agent = await createCaseAgent(sessionId, agentOptions)

    // command 模式：中断恢复
    if (command) {
        const { Command } = await import('@langchain/langgraph')
        return agent.stream(
            new Command({ resume: command }),
            {
                configurable: { thread_id: sessionId },
                streamMode: ['values', 'messages', 'updates'],
                version: 'v2' as const,
                subgraphs: true,
                encoding: 'text/event-stream',
            },
        )
    }

    // 普通消息模式
    return agent.stream(
        { messages: [new HumanMessage(message!)] },
        {
            configurable: { thread_id: sessionId },
            streamMode: ['values', 'messages', 'updates'],
            version: 'v2' as const,
            subgraphs: true,
            encoding: 'text/event-stream',
        },
    )
}
```

- [ ] **Step 3: 修改 agentWorker.ts executeRun 支持 command**

修改 `executeRun` 方法中调用 Agent 的部分（约第 134-139 行）：

```typescript
// 调用 Agent
const input = run.input as { message?: string; command?: unknown }
const { runCaseChat } = await import('./caseAgent')
const stream = await runCaseChat(
    run.sessionId,
    input.message,
    {
        userId: run.userId,
        caseId: run.caseId,
        command: input.command,
    },
)
```

- [ ] **Step 4: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add server/services/agent/caseAgent.ts server/services/agent/agentWorker.ts server/api/v1/case/analysis/chat.post.ts
git commit -m "feat(analysis): 支持 command 参数实现中断恢复（Worker + API + Agent）"
```

---

## Task 6: 前端 ExtractInfoTool 扩展字段支持

**Files:**
- Modify: `app/components/caseAnalysis/tools/ExtractInfoTool.vue`

> 现有组件使用扁平结构（`caseNumber`, `court`, `causeOfAction`, `amount` 作为固定可选字段）。
> 改为动态 `extraFields` 数组渲染，支持编辑/添加/删除扩展字段。

- [ ] **Step 1: 更新 CaseInfo 接口**

```typescript
interface ExtraField {
    name: string
    title: string
    value: string
}

interface CaseInfo {
    title: string
    plaintiff: string[]
    defendant: string[]
    caseType: string
    summary: string
    extraFields: ExtraField[]
}
```

移除旧的可选字段（`caseNumber`, `court`, `causeOfAction`, `amount`）。

- [ ] **Step 2: 更新 createFormData 函数**

```typescript
function createFormData(): CaseInfo {
    const data = parsedOutput.value
    return {
        title: data?.title || '',
        plaintiff: data?.plaintiff?.length ? [...data.plaintiff] : [''],
        defendant: data?.defendant?.length ? [...data.defendant] : [''],
        caseType: data?.caseType || '',
        summary: data?.summary || '',
        extraFields: data?.extraFields?.length
            ? data.extraFields.map((f: ExtraField) => ({ ...f }))
            : [],
    }
}
```

- [ ] **Step 3: 替换 Collapsible 可选字段区域为动态 extraFields**

将模板中的 `<Collapsible>` 区域（第 75-100 行）替换为：

```vue
<!-- 扩展字段（LLM 动态提取） -->
<div v-if="formData.extraFields.length > 0" class="space-y-3">
    <Label class="text-sm text-muted-foreground">扩展信息</Label>
    <div v-for="(field, idx) in formData.extraFields" :key="field.name"
        class="flex items-center gap-2">
        <div class="w-24 shrink-0">
            <Input v-model="formData.extraFields[idx].title"
                placeholder="字段名" class="text-sm" />
        </div>
        <Input v-model="formData.extraFields[idx].value"
            placeholder="字段值" class="flex-1" />
        <Button variant="ghost" size="icon" class="h-9 w-9 shrink-0"
            @click="removeExtraField(idx)">
            <XIcon class="h-4 w-4" />
        </Button>
    </div>
</div>
<Button variant="outline" size="sm" @click="addExtraField">
    <PlusIcon class="h-4 w-4 mr-1" />
    添加字段
</Button>
```

- [ ] **Step 4: 添加 extraFields 操作函数**

```typescript
function addExtraField() {
    formData.value.extraFields.push({
        name: `field_${Date.now()}`,
        title: '',
        value: '',
    })
}

function removeExtraField(index: number) {
    formData.value.extraFields.splice(index, 1)
}
```

- [ ] **Step 5: 更新 handleConfirm 函数**

```typescript
function handleConfirm() {
    if (!canSubmit.value) return

    const cleaned: CaseInfo = {
        title: formData.value.title.trim(),
        plaintiff: formData.value.plaintiff.filter(p => p.trim().length > 0),
        defendant: formData.value.defendant.filter(d => d.trim().length > 0),
        caseType: formData.value.caseType.trim(),
        summary: formData.value.summary.trim(),
        extraFields: formData.value.extraFields
            .filter(f => f.title.trim() && f.value.trim())
            .map(f => ({
                name: f.name,
                title: f.title.trim(),
                value: f.value.trim(),
            })),
    }

    confirmedData.value = cleaned
    approval.value = { id: 'extract-info', approved: true }
    confirmationState.value = 'approval-responded'
    emit('confirm', cleaned)
}
```

- [ ] **Step 6: 更新 AiElementsConfirmationAccepted 已确认展示**

替换已确认区域，增加 extraFields 展示：

```vue
<AiElementsConfirmationAccepted>
    <div class="space-y-3">
        <div class="flex items-center gap-2 text-green-600">
            <CheckCircleIcon class="h-5 w-5" />
            <span class="font-medium">案件信息已确认</span>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div v-if="confirmedData?.title">
                <span class="text-muted-foreground">案件标题</span>
                <p>{{ confirmedData.title }}</p>
            </div>
            <div v-if="confirmedData?.caseType">
                <span class="text-muted-foreground">案件类型</span>
                <p>{{ confirmedData.caseType }}</p>
            </div>
            <div v-if="confirmedData?.plaintiff?.length">
                <span class="text-muted-foreground">原告</span>
                <p>{{ confirmedData.plaintiff.join('、') }}</p>
            </div>
            <div v-if="confirmedData?.defendant?.length">
                <span class="text-muted-foreground">被告</span>
                <p>{{ confirmedData.defendant.join('、') }}</p>
            </div>
            <div v-if="confirmedData?.summary" class="col-span-2">
                <span class="text-muted-foreground">案件摘要</span>
                <p class="line-clamp-3">{{ confirmedData.summary }}</p>
            </div>
            <template v-if="confirmedData?.extraFields?.length">
                <div v-for="field in confirmedData.extraFields" :key="field.name">
                    <span class="text-muted-foreground">{{ field.title }}</span>
                    <p>{{ field.value }}</p>
                </div>
            </template>
        </div>
    </div>
</AiElementsConfirmationAccepted>
```

- [ ] **Step 7: 移除 Collapsible 相关导入（如不再使用）**

检查模板中是否还有其他地方使用 `Collapsible`、`CollapsibleTrigger`、`CollapsibleContent`、`ChevronRightIcon`，如果没有则移除相关导入和 `showOptionalFields` ref。

- [ ] **Step 8: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 9: Commit**

```bash
git add app/components/caseAnalysis/tools/ExtractInfoTool.vue
git commit -m "feat(ui): ExtractInfoTool 支持动态扩展字段渲染（extraFields）"
```

---

## Task 7: 数据库 Seed — extractInfo 节点配置

**Files:**
- Create: `prisma/seed/extractInfoNode.ts`（或在现有 seed 机制中添加）

> 需要更新数据库中 extractInfo 节点的 `outputSchema` 和 `tools` 配置。
> 如果项目有 seed 脚本则添加到其中，否则创建一个手动迁移 SQL。

- [ ] **Step 1: 创建 migration SQL 更新 extractInfo 节点配置**

```sql
-- 更新 extractInfo 节点的 outputSchema
UPDATE nodes SET output_schema = '{
  "type": "object",
  "properties": {
    "title": { "type": "string", "description": "案件名称（如：张三与李四买卖合同纠纷）" },
    "plaintiff": { "type": "array", "items": { "type": "string" }, "description": "原告列表" },
    "defendant": { "type": "array", "items": { "type": "string" }, "description": "被告列表" },
    "caseType": { "type": "string", "description": "案件类型，必须从系统可选值中选取" },
    "summary": { "type": "string", "description": "案件简要概述（200字以内）" },
    "extraFields": {
      "type": "array",
      "description": "根据案件材料提取的其他有价值信息",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "英文标识（camelCase）" },
          "title": { "type": "string", "description": "中文名称" },
          "value": { "type": "string", "description": "提取的值" }
        },
        "required": ["name", "title", "value"]
      }
    }
  },
  "required": ["title", "plaintiff", "defendant", "caseType", "summary", "extraFields"]
}'::jsonb
WHERE name = 'extractInfo';

-- 更新 extractInfo 节点的工具配置（添加材料查询工具）
UPDATE nodes SET tools = '["search_case_materials"]'::jsonb
WHERE name = 'extractInfo' AND tools = '[]'::jsonb;
```

- [ ] **Step 2: 执行 SQL**

根据项目 seed 机制执行。如果用 Prisma migration：

Run: `bun run prisma:migrate -- --name seed_extract_info_node_config`

- [ ] **Step 3: 验证节点配置**

Run: `bun run prisma:studio`
Expected: 在 nodes 表中确认 extractInfo 节点的 `output_schema` 和 `tools` 字段已更新

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "chore(db): seed extractInfo 节点的 outputSchema 和 tools 配置"
```

---

## Task 8: NodeConfig 类型扩展

**Files:**
- Modify: `server/services/node/node.service.ts`

> `NodeConfig` 接口和 `getNodeConfigService` 查询需要包含新的 `outputSchema` 字段。

- [ ] **Step 1: 在 NodeConfig 接口中添加 outputSchema**

在 `NodeConfig` 接口中添加：

```typescript
    /** 结构化输出 schema（JSON Schema 格式，用于 extraction 类型节点） */
    outputSchema: Record<string, unknown> | null
```

- [ ] **Step 2: 更新 getNodeConfigService 查询**

在 `prisma.nodes.findFirst` 的 `select` 中添加 `outputSchema: true`。

在结果映射中添加：`outputSchema: node.outputSchema as Record<string, unknown> | null`。

- [ ] **Step 3: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add server/services/node/node.service.ts
git commit -m "feat(node): NodeConfig 接口新增 outputSchema 字段"
```

> **关于 PostgresStore 和语义搜索**：
> - 本计划复用 `checkpointer.ts` 中已有的 `getStore()`（无嵌入模型配置），满足精确读写需求
> - Spec 第 3.4 节的嵌入模型配置（`runtimeConfig.embedding`、`nuxt.config.ts` 修改）和语义搜索能力推迟到后续迭代
> - 当前 `store.put` / `store.get` 功能已足够支持长期记忆的存取

---

## Task 9: 集成验证

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: 所有测试通过

- [ ] **Step 2: 运行类型检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误

- [ ] **Step 3: 启动开发服务器验证**

Run: `bun dev`
Expected: 服务正常启动，无错误

- [ ] **Step 4: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix(analysis): 修复集成测试中发现的问题"
```

---

## 依赖关系

```
Task 1 (DB Schema) ──→ Task 7 (Seed)
         │
         ├──→ Task 2 (Types)
         │        │
         │        └──→ Task 3 (Storage Service)
         │                    │
         │                    └──→ Task 4 (ExtractInfo Node) ──→ Task 9 (验证)
         │
         ├──→ Task 8 (NodeConfig) ──→ Task 4
         │
         ├──→ Task 5 (Worker Command) ──→ Task 9
         │
         └──→ Task 6 (Frontend) ──→ Task 9
```

可并行的任务组：
- **Group A**: Task 2 → Task 3 → Task 4（后端核心链路）
- **Group B**: Task 5（Worker command）
- **Group C**: Task 6（前端）
- Task 1、7、8 是前置依赖
