---
inclusion: fileMatch
fileMatchPattern: "server/services/workflow/**"
---
# Workflow 节点开发规范

## 概述
本规范定义了 LangGraph 工作流中节点的配置管理方式，确保所有节点统一使用项目的节点配置管理系统。

## 节点配置管理架构

### 核心服务
- `getNodeConfigService(name)` - 通过节点名称获取完整配置
- `getNodeConfigByIdService(id)` - 通过节点 ID 获取完整配置
- `renderContent(template, variables)` - 渲染提示词模板

### 配置数据结构
```typescript
interface NodeConfig {
  id: number                    // 节点 ID
  name: string                  // 节点名称（唯一标识）
  title: string                 // 节点标题
  description: string           // 节点描述
  type: string                  // 节点类型
  prompts: NodePromptConfig[]   // 提示词列表
  modelId: number               // 模型 ID
  modelName: string             // 模型名称
  modelType: string             // 模型类型
  modelStatus: number           // 模型状态
  modelProviderId: number       // 提供商 ID
  modelProviderName: string     // 提供商名称
  modelProviderBaseUrl: string  // API 基础 URL
  modelApiKeys: NodeApiKeyConfig[] // API 密钥列表
  tools: string[]               // 节点工具列表
}
```

## 节点开发规范

### 1. 节点命名约定
每个节点必须定义两个常量：
```typescript
/** 节点名称（LangGraph 工作流中使用） */
export const XXX_NODE_NAME = 'xxx_node'

/** 节点配置名称（数据库中的节点名称，必须在后台配置） */
export const XXX_NODE_CONFIG_NAME = 'xxxNode'
```

### 2. 获取节点配置
```typescript
import { getNodeConfigService, type NodeConfig } from '../../node/node.service'
import { renderContent } from '../../node/prompt.service'

// 获取配置（必须在后台配置）
const nodeConfig = await getNodeConfigService(XXX_NODE_CONFIG_NAME)

if (!nodeConfig) {
  throw new Error(`节点配置不存在：${XXX_NODE_CONFIG_NAME}，请在后台管理中配置该节点`)
}
```

### 3. 验证节点配置完整性
```typescript
function validateNodeConfig(nodeConfig: NodeConfig): void {
  // 检查系统提示词
  const systemPrompt = nodeConfig.prompts.find(p => p.type === 'system' && p.status === 1)
  if (!systemPrompt) {
    throw new Error(`节点 ${NODE_CONFIG_NAME} 缺少生效的系统提示词，请在后台管理中配置`)
  }

  // 检查用户提示词
  const userPrompt = nodeConfig.prompts.find(p => p.type === 'user' && p.status === 1)
  if (!userPrompt) {
    throw new Error(`节点 ${NODE_CONFIG_NAME} 缺少生效的用户提示词，请在后台管理中配置`)
  }

  // 检查 API 密钥
  const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
  if (!activeApiKey) {
    throw new Error(`节点 ${NODE_CONFIG_NAME} 关联的模型没有可用的 API 密钥，请在后台管理中配置`)
  }
}
```

### 4. 构建提示词
```typescript
function buildPrompts(
  nodeConfig: NodeConfig,
  variables: Record<string, string>
): { systemPrompt: string; userPrompt: string } {
  // 获取生效的提示词
  const systemPromptConfig = nodeConfig.prompts.find(p => p.type === 'system' && p.status === 1)!
  const userPromptConfig = nodeConfig.prompts.find(p => p.type === 'user' && p.status === 1)!

  // 渲染用户提示词（替换变量）
  const userPrompt = renderContent(userPromptConfig.content, variables)

  return {
    systemPrompt: systemPromptConfig.content,
    userPrompt,
  }
}
```

### 5. 创建 AI 模型
```typescript
import { ChatOpenAI } from '@langchain/openai'

function createChatModel(nodeConfig: NodeConfig): ChatOpenAI {
  const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)!

  return new ChatOpenAI({
    model: nodeConfig.modelName,
    apiKey: activeApiKey.apiKey,
    configuration: {
      baseURL: nodeConfig.modelProviderBaseUrl,
    },
    temperature: 0.3, // 根据节点需求调整
  })
}
```

## 提示词变量规范

### 变量格式
提示词中使用 `{{variableName}}` 格式定义变量：
```
请分析以下材料内容：
{{materials}}

{{supplementedInfo}}
```

### 变量渲染
```typescript
import { renderContent } from '../../node/prompt.service'

const renderedPrompt = renderContent(promptTemplate, {
  materials: '材料内容...',
  supplementedInfo: '补充信息...',
})
```

## 节点函数模板

```typescript
/**
 * XXX 节点
 *
 * @see Requirements X.X
 * @see design.md - 相关设计文档
 */

import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import {
  type CaseAnalysisState,
  type CaseAnalysisStateUpdate,
  WorkflowPhase,
} from '../state'
import { getNodeConfigService, type NodeConfig } from '../../node/node.service'
import { renderContent } from '../../node/prompt.service'
import { logger } from '#shared/utils/logger'

export const XXX_NODE_NAME = 'xxx_node'
export const XXX_NODE_CONFIG_NAME = 'xxxNode'

export async function xxxNode(
  state: CaseAnalysisState
): Promise<CaseAnalysisStateUpdate> {
  const { caseId, sessionId } = state

  logger.info('XXX 节点开始执行', { caseId, sessionId })

  try {
    // 1. 获取节点配置
    const nodeConfig = await getNodeConfigService(XXX_NODE_CONFIG_NAME)
    if (!nodeConfig) {
      throw new Error(`节点配置不存在：${XXX_NODE_CONFIG_NAME}`)
    }

    // 2. 验证配置完整性
    validateNodeConfig(nodeConfig)

    // 3. 构建提示词
    const { systemPrompt, userPrompt } = buildPrompts(nodeConfig, {
      // 传入变量
    })

    // 4. 创建模型并调用
    const model = createChatModel(nodeConfig)
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ])

    // 5. 处理响应并返回状态更新
    return {
      // 状态更新
      currentPhase: WorkflowPhase.NEXT_PHASE,
      messages: [new AIMessage({ content: '处理完成' })],
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    logger.error('XXX 节点执行异常', { caseId, error: errorMessage })

    return {
      error: `XXX 节点异常: ${errorMessage}`,
      currentPhase: WorkflowPhase.CURRENT_PHASE,
      messages: [new AIMessage({ content: `处理异常：${errorMessage}` })],
    }
  }
}
```

## 错误处理规范

### 配置错误
- 节点配置不存在：提示用户在后台配置
- 提示词缺失：明确指出缺少哪种类型的提示词
- API 密钥无效：提示检查模型提供商配置

### 运行时错误
- 使用 try-catch 包裹主逻辑
- 记录详细日志（包含 caseId、sessionId）
- 返回用户友好的错误消息
- 更新工作流状态为当前阶段（允许重试）

## 日志规范

```typescript
import { logger } from '#shared/utils/logger'

// 节点开始
logger.info('节点名称开始执行', { caseId, sessionId, phase: state.currentPhase })

// 关键步骤
logger.info('步骤描述', { caseId, key: value })

// 警告
logger.warn('警告信息', { caseId, reason: '原因' })

// 错误
logger.error('错误信息', { caseId, error: errorMessage, stack: error.stack })
```

## 后台配置要求

每个工作流节点在使用前必须在后台管理系统中完成以下配置：

1. **创建节点**：设置节点名称（与 `NODE_CONFIG_NAME` 一致）、标题、描述、类型
2. **关联模型**：选择合适的 AI 模型
3. **配置提示词**：
   - 系统提示词（system）：定义 AI 角色和行为规范
   - 用户提示词（user）：定义输入格式和变量占位符
4. **激活提示词**：确保所需的提示词版本处于生效状态
5. **配置 API 密钥**：确保模型提供商有可用的 API 密钥
