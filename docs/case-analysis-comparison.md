# 旧项目与现有项目案件分析流程对比

## 概述

本文档对比分析旧项目（lexseekApi）和现有项目（lexseek）的案件分析逻辑，总结两者的主要区别。

## 核心架构对比

### 旧项目（lexseekApi）

**技术栈**：
- Express.js + TypeScript
- LangChain + LangGraph（AI 工作流编排）
- Socket.IO（实时通信）
- Prisma ORM
- MemorySaver（内存检查点器）

**分析流程**：
1. 使用 Socket.IO 进行实时通信
2. 基于 LangGraph 的工作流图（`caseAnalysisGraph`、`caseAnalysisTaskGraph`）
3. 工作流节点串行执行（materialHandle → buildMaterialsPrompt → 分析节点链）
4. 每个分析模块是一个工作流节点
5. 支持动态节点生成（从数据库读取节点配置）
6. 分析结果保存到 `caseAnalyses` 表

**关键特点**：
- **LangGraph 工作流**：使用 StateGraph 定义分析流程，节点串行执行
- **Socket.IO 通信**：双向实时通信，支持消息持久化
- **动态节点生成**：从数据库读取节点配置，动态创建工作流节点
- **链式上下文传递**：通过 `lastExecutedModule`、`lastExecutedResult` 传递上下文
- **MemorySaver 检查点**：使用内存检查点器，不支持持久化
- **版本管理**：支持同一案件同一模块的多个版本，通过 `isActive` 字段标记当前生效版本

### 现有项目（lexseek）

**技术栈**：
- Nuxt 4 + Vue 3 + TypeScript
- LangGraph（AI 工作流编排）
- Socket.IO（实时通信）
- Prisma ORM
- PostgresSaver（PostgreSQL 检查点器）
- LangChain（AI 集成）

**分析流程**：
1. 使用 Socket.IO 进行实时通信
2. 基于 LangGraph 的工作流图（`caseAnalysisWorkflow`）
3. 工作流驱动的分析流程，支持中断点（interrupt）
4. 支持案件创建和分析任务分离
5. 分析结果保存到 `caseAnalyses` 表，同时进行向量化嵌入

**关键特点**：
- **LangGraph 工作流**：使用 StateGraph 定义分析工作流，通过状态机管理分析流程
- **中断点机制**：支持 3 个中断点（案情检查、信息提取、模块选择），等待用户交互
- **PostgresSaver 检查点**：使用 PostgreSQL 持久化检查点，支持断线重连和故障恢复
- **Socket.IO 通信**：双向实时通信，支持更复杂的交互（用户确认、任务状态更新）
- **向量化嵌入**：分析结果自动进行向量化嵌入，支持语义搜索
- **节点系统**：通过节点系统管理模型和提示词配置
- **工具调用**：支持动态工具加载（searchLaw、searchCaseMaterials）

## 详细对比

### 1. 工作流设计

#### 旧项目
```typescript
// 旧项目：简单的线性工作流
const workflow = new StateGraph(CaseAnalysisAnnotation)
    .addNode("materialHandle", materialHandleNode)
    .addNode("buildMaterialsPrompt", buildMaterialsPromptNode)
    .addNode("extractCaseBasInfo", extractCaseBasInfoNode)
    .addEdge("__start__", "materialHandle")
    .addEdge("materialHandle", "buildMaterialsPrompt")
    .addEdge("buildMaterialsPrompt", "extractCaseBasInfo")
    .addEdge("extractCaseBasInfo", "__end__");

export const caseAnalysisGraph = workflow.compile({
    checkpointer: new MemorySaver(),  // 内存检查点器
});
```

**特点**：
- 线性工作流，节点串行执行
- 使用 MemorySaver（内存检查点器）
- 不支持中断点（interrupt）
- 不支持持久化，重启后状态丢失

#### 现有项目
```typescript
// 现有项目：支持中断点的复杂工作流
const workflow = new StateGraph(CaseAnalysisAnnotation)
    .addNode(MATERIAL_PROCESS_NODE_NAME, materialProcessNode)
    .addNode(CASE_INFO_CHECK_NODE_NAME, caseInfoCheckNode)  // 中断点1
    .addNode(EXTRACT_INFO_NODE_NAME, extractInfoNode)       // 中断点2
    .addNode(MODULE_SELECT_NODE_NAME, moduleSelectNode)     // 中断点3
    .addNode(ANALYSIS_TASK_NODE_NAME, analysisTaskNode)
    .addEdge(START, MATERIAL_PROCESS_NODE_NAME)
    .addEdge(MATERIAL_PROCESS_NODE_NAME, CASE_INFO_CHECK_NODE_NAME)
    .addConditionalEdges(
        CASE_INFO_CHECK_NODE_NAME,
        (state) => state.caseInfoCheckPassed ? 'continue' : 'wait',
        { continue: EXTRACT_INFO_NODE_NAME, wait: END }
    )
    // ... 更多条件边

export const caseAnalysisWorkflow = workflow.compile({
    checkpointer: await getCheckpointer(),  // PostgreSQL 检查点器
});
```

**特点**：
- 支持条件分支和中断点
- 使用 PostgresSaver（PostgreSQL 检查点器）
- 支持断线重连和故障恢复
- 状态持久化到数据库

### 2. 动态节点生成

#### 旧项目
```typescript
// 旧项目：从数据库动态生成节点
async function getAnalysisNodeConfigs(): Promise<AnalysisNodeConfig[]> {
    const nodeList = await getDbNodeList({ type: ['2', '3'] });
    return nodeList.map(node => ({
        moduleName: node.name.replace(/Analysis$|Document$/, ''),
        analysisType: node.name,
        stateKey: moduleName,
        title: node.title || moduleName,
        type: node.type
    }));
}

// 动态创建节点并连接
const analysisNodes = await createAnalysisNodes(await getAnalysisNodeConfigs());
for (const node of analysisNodes) {
    const nodeName = Object.keys(node)[0];
    workflow.addNode(nodeName, node[nodeName]);
    nodeNames.push(nodeName);
}

// 构建线性链：node1 -> node2 -> node3 -> ...
for (let i = 0; i < nodeNames.length - 1; i++) {
    workflow.addEdge(nodeNames[i], nodeNames[i + 1]);
}
```

**特点**：
- 节点配置存储在数据库
- 启动时动态生成工作流
- 节点串行执行（线性链）
- 通过 `lastExecutedResult` 传递上下文

#### 现有项目
```typescript
// 现有项目：静态定义工作流，节点配置动态加载
export const ANALYSIS_TASK_NODE_NAME = 'analysis_task';

async function analysisTaskNode(state: CaseAnalysisState) {
    // 从状态中获取要执行的模块列表
    const modules = state.selectedModules || [];
    
    // 按顺序执行每个模块
    for (const moduleName of modules) {
        // 动态加载节点配置（模型、提示词、工具）
        const nodeConfig = await getNodeConfigService(moduleName);
        
        // 动态加载工具
        const tools = await loadToolsForNode(nodeConfig);
        
        // 执行分析
        const result = await executeAnalysis(nodeConfig, tools, state);
        
        // 保存结果
        await saveAnalysisResult(result);
    }
}
```

**特点**：
- 工作流结构静态定义
- 节点配置动态加载（模型、提示词、工具）
- 单个节点内循环执行多个模块
- 支持中断和恢复

### 3. 材料处理

#### 旧项目
```typescript
// 旧项目：构建材料提示词
export async function buildMaterialsPrompt(
  caseMaterials: CaseMaterialParamTypeWithContent[],
  prompt: string
): Promise<string> {
  let basePrompt = `用户提供了以下${caseMaterials.length}份案情材料：`;
  
  for (const [index, material] of caseMaterials.entries()) {
    if (material.type === CaseMaterialType.AUDIO) {
      // 音频材料：提示使用 searchMaterialsTool 查询
      const asrPrompt = await getCaseMaterialEntitiesPrompt(
        String(material.userId), 
        Number(material.asrRecordId), 
        "asr"
      );
      basePrompt += `\n${asrPrompt}`;
    }
    if (material.type === CaseMaterialType.DOCUMENT) {
      // 文档材料：提示使用 searchMaterialsTool 查询
      const docPrompt = await getCaseMaterialEntitiesPrompt(
        String(material.userId), 
        Number(material.docRecognitionId), 
        "doc"
      );
      basePrompt += `\n${docPrompt}`;
    }
    if (material.type === CaseMaterialType.CASE_CONTENT) {
      // 文本材料：直接包含内容
      basePrompt += `内容为：\n${material.content}`;
    }
  }
  
  return basePrompt;
}
```

**特点**：
- 材料内容通过提示词传递给 LLM
- 音频和文档材料通过工具调用获取（searchMaterialsTool）
- 文本材料直接包含在提示词中
- 使用知识图谱提示词（getCaseMaterialEntitiesPrompt）

#### 现有项目
```typescript
// 现有项目：材料向量化嵌入
// 1. 创建材料时自动触发向量化
await materialEmbeddingService.embedTextMaterialService(materialId, userId);

// 2. 分析结果也进行向量化
const vectorIds = await embedMaterials(analysisResult, {
  userId,
  sourceId: analysisRecordId,
  source: MaterialTypeEnum.ANALYSIS_RESULT,
});

// 3. 更新向量 ID
await caseAnalysisDao.update(analysisRecordId, {
  vectorIds: vectorIds.ids,
  lastEmbeddingAt: new Date(vectorIds.lastEmbeddingAt),
});

// 4. 工具调用获取材料
const tools = [
  searchLawTool,           // 搜索法律知识库
  searchCaseMaterialsTool, // 搜索案件材料
];
```

**特点**：
- 材料创建时自动向量化
- 分析结果也进行向量化
- 支持语义搜索和相关性匹配
- 向量 ID 存储在记录中
- 通过工具调用动态获取材料内容

### 4. 识别服务集成

#### 旧项目
```typescript
// 旧项目：识别服务分散
// 音频识别
import * as asrController from "@/services/ai/asr/asr.controller.js";
import * as asrRecordDao from "@/services/ai/asr/asrRecord.dao.js";

// 文档识别
import * as docRecognitionService from "@/services/ai/docRecognition/docRecognition.service.js";

// 图片识别
import * as imageRecognitionService from "@/services/ai/imageRecognition/imageRecognition.service.js";
```

**特点**：
- 识别服务分散在不同目录
- 每种识别类型独立实现
- 没有统一的识别流程

#### 现有项目
```typescript
// 现有项目：统一的识别服务
// 所有识别服务在 server/services/material/ 下
import { createImageRecognitionByBase64Service } from '../material/ocr.service';
import { transcribeAudioService } from '../material/asr.service';
import { submitMineruBatchService } from '../material/mineruResult.service';
```

**特点**：
- 识别服务统一在 `material` 目录下
- 统一的服务接口设计
- 统一的向量化嵌入流程
- 统一的节点系统管理（模型、提示词）

### 5. 实时通信

#### 旧项目
```typescript
// 旧项目：混合使用 SSE 和 Socket.IO
// 在 caseAnalysis.service.ts 中使用 SSE 推送分析进度
export function sendSSEMessage(
  res: Response,
  type: string,
  message: string,
  data?: any
): boolean {
  res.write(`data: ${JSON.stringify({ type, message, data })}\n\n`);
  return true;
}

// 使用示例
sendSSEMessage(res, "analysisStart", "开始案件分析", { modules });
sendSSEMessage(res, `${moduleName}:start`, `开始${module.title}分析`);
sendSSEMessage(res, `generate:${moduleName}`, `${module.title}...`, chunk);

// 在 socket/case.ts 中使用 Socket.IO 进行案件事件通信
socket.emit("case:created", { caseId, sessionId });
socket.emit("case:analysis:start", { caseId, modules });
```

**特点**：
- **混合通信方式**：分析进度使用 SSE，案件事件使用 Socket.IO
- SSE 单向推送（服务端 → 客户端）
- Socket.IO 双向通信（服务端 ↔ 客户端）
- SSE 连接断开后无法恢复
- Socket.IO 支持断线重连
- 消息不持久化

#### 现有项目
```typescript
// 现有项目：无实时通信层，通过 API 轮询或工作流状态查询
// 工作流执行是异步的，前端通过以下方式获取状态：

// 1. 启动工作流
const result = await workflow.invoke(initialState, {
  configurable: { thread_id: sessionId }
});

// 2. 查询工作流状态
const state = await workflow.getState({
  configurable: { thread_id: sessionId }
});

// 3. 恢复中断的工作流
const result = await workflow.invoke(
  new Command({ resume: userInput }),
  { configurable: { thread_id: sessionId } }
);
```

**特点**：
- **无实时通信层**：不使用 SSE 或 Socket.IO
- 通过 API 请求-响应模式交互
- 工作流状态持久化到 PostgreSQL（通过 PostgresSaver）
- 支持中断和恢复（通过 LangGraph 的 interrupt 机制）
- 前端可通过轮询或长轮询获取进度
- 更简单的架构，减少了实时通信的复杂性

### 6. 积分扣减

#### 旧项目
```typescript
// 旧项目：分析前扣减积分
// 在 executeAnalysisTaskByModule 中
try {
  // 首先检查积分是否足够
  const pointConsumptionItem = await pointConsumptionItemsDao
    .getPointConsumptionItemsByGroup("analysisModules", { name: moduleName });
  
  if (pointConsumptionItem.length > 0) {
    const countNeedPoint = Math.ceil(
      pointConsumptionItem[0].pointAmount * Number(pointConsumptionItem[0].discount || 1)
    );
    
    // 获取用户可用积分
    const userPoint = await pointRecordsDao.getMembershipAvailablePoint(userId);
    if (userPoint.remaining < countNeedPoint) {
      throw new Error(`您的可用积分不足，需要 ${countNeedPoint}，可用积分 ${userPoint.remaining}`);
    }
    
    // 创建分析记录后立即扣减积分
    await pointConsumptionRecordsService.createPointConsumptionRecord(
      userId,
      pointConsumptionItem[0].id,
      countNeedPoint,
      {
        sourceId: analysisRecord.id,
        remark: `案件(${caseId})${module.title}分析消耗积分`,
      }
    );
  }
  
  // 然后执行分析...
} catch (error) {
  // 如果分析失败，积分已扣减（需要退款机制）
}
```

**特点**：
- **分析开始前扣减积分**
- 先检查积分是否足够
- 创建分析记录后立即扣减
- 如果分析失败，积分已扣减（需要退款机制）
- 积分扣减失败会中断分析流程

#### 现有项目
```typescript
// 现有项目：分析成功后扣减积分
// 在 analysisTaskNode 中
try {
  // 先执行分析...
  const result = await executeAnalysis(...);
  
  // 保存分析结果
  const createdAnalysisRecord = await caseAnalysisDao.create({
    caseId,
    analysisType: moduleName,
    analysisResult: result.content,
    status: CaseAnalysisStatus.COMPLETED,
    // ...
  });
  
  // 分析成功后才扣减积分
  try {
    const pointConsumptionItem = await pointConsumptionItemsDao
      .getPointConsumptionItemsByGroup("analysisModules", { name: moduleName });
    
    if (pointConsumptionItem.length > 0) {
      await pointConsumptionRecordsService.createPointConsumptionRecord(
        userId,
        pointConsumptionItem[0].id,
        actualPoints,
        {
          sourceId: createdAnalysisRecord.id,
          remark: `案件(${caseId})${moduleInfo?.title}分析消耗积分`,
        }
      );
    }
  } catch (pointError) {
    // 积分扣减失败不影响主流程
    logger.error(`积分扣减失败`, { error: pointError });
  }
} catch (error) {
  // 分析失败，积分未扣减
}
```

**特点**：
- **分析成功后才扣减积分**
- 不需要退款机制
- 积分扣减失败不影响分析结果
- 更合理的扣减时机
- 避免用户因分析失败而损失积分

## 主要区别总结

### 1. 架构设计

| 维度 | 旧项目 | 现有项目 |
|------|--------|----------|
| AI 框架 | LangGraph 工作流 | LangGraph 工作流 |
| 检查点器 | MemorySaver（内存） | PostgresSaver（数据库） |
| 通信方式 | SSE + Socket.IO（混合） | API 请求-响应（无实时通信） |
| 分析模式 | 工作流驱动 | 工作流驱动 |
| 流程控制 | 串行执行 | 状态机管理 + 中断点 |
| 状态持久化 | 不持久化 | 持久化到 PostgreSQL |

### 2. 功能特性

| 功能 | 旧项目 | 现有项目 |
|------|--------|----------|
| 案件创建 | 创建后立即分析 | 创建和分析分离 |
| 用户交互 | 单向推送（SSE） | API 请求-响应 |
| 中断点支持 | 不支持 | 支持 3 个中断点 |
| 断线重连 | 不支持（SSE）/ 支持（Socket.IO） | 通过状态持久化支持 |
| 材料处理 | 提示词传递 + 工具调用 | 向量化嵌入 + 工具调用 |
| 识别服务 | 分散实现 | 统一管理 |
| 积分扣减 | 分析前扣减 | 分析后扣减 |
| 消息持久化 | 不持久化 | 工作流状态持久化 |
| 节点生成 | 动态生成节点 | 静态工作流 + 动态配置 |

### 3. 技术优势

#### 旧项目优势
- **动态节点生成**：从数据库读取节点配置，动态创建工作流节点
- **链式上下文传递**：通过 `lastExecutedModule`、`lastExecutedResult` 传递上下文
- **工具调用灵活**：支持多种工具调用（searchLawTool、searchAsrTool、searchMaterialsTool）
- **版本管理**：支持同一案件同一模块的多个版本

#### 现有项目优势
- **PostgresSaver 检查点**：状态持久化到数据库，支持断线重连和故障恢复
- **中断点机制**：支持 3 个中断点（案情检查、信息提取、模块选择），等待用户交互
- **简化的通信架构**：无需实时通信层，通过 API 请求-响应模式交互，架构更简单
- **向量化搜索**：材料和分析结果向量化，支持语义搜索
- **节点系统**：统一管理模型和提示词配置
- **工作流状态持久化**：所有工作流状态保存到数据库，支持历史回溯
- **更合理的积分扣减**：分析成功后才扣减积分，避免失败时的积分损失
- **工作流可视化**：LangGraph 提供可视化的工作流定义和调试

## 建议

### 1. 保留现有架构
现有项目的工作流驱动架构更适合复杂的案件分析场景，建议保留：
- **LangGraph 工作流编排**：清晰的流程定义和状态管理
- **PostgresSaver 检查点**：支持断线重连和故障恢复
- **API 请求-响应模式**：简化的通信架构，无需维护实时连接
- **向量化嵌入**：支持语义搜索和智能推荐
- **节点系统**：统一管理模型和提示词配置
- **中断点机制**：支持用户确认和交互

### 2. 借鉴旧项目优点
可以从旧项目借鉴以下特性：
- **动态节点生成**：考虑在现有项目中实现动态节点配置加载
- **链式上下文传递**：在分析任务节点中实现模块间的上下文传递
- **版本管理**：支持同一案件同一模块的多个版本
- **工具调用机制**：在 LangGraph 工作流中集成更多工具调用

### 3. 优化方向
- **工作流可视化**：提供工作流的可视化编辑和监控
- **错误恢复机制**：增强工作流的错误恢复能力
- **性能优化**：优化向量化嵌入的性能
- **测试覆盖**：增加工作流的单元测试和集成测试
- **动态配置**：支持从数据库动态加载节点配置，而不是硬编码在代码中

### 4. 架构演进建议
- **保持 LangGraph 工作流**：两个项目都使用 LangGraph，说明这是正确的技术选择
- **增强中断点机制**：现有项目的中断点机制是重要创新，应继续完善
- **简化通信架构**：现有项目去除了实时通信层，通过 API 和状态持久化实现交互，架构更简单
- **持久化优先**：PostgresSaver 的持久化能力是关键优势，应继续强化

## 结论

两个项目都采用了 LangGraph 工作流架构，这说明 LangGraph 是处理复杂案件分析流程的正确技术选择。现有项目在旧项目的基础上进行了重要的架构升级和功能增强。

### 核心架构对比
- **相同点**：都使用 LangGraph StateGraph 定义工作流，都支持工具调用
- **主要区别**：
  - **检查点器**：MemorySaver（内存，不持久化） vs PostgresSaver（数据库，持久化）
  - **中断点**：不支持 vs 支持 3 个中断点（案情检查、信息提取、模块选择）
  - **节点生成**：动态生成节点 vs 静态工作流 + 动态配置
  - **通信方式**：SSE + Socket.IO（混合） vs API 请求-响应（无实时通信）

### 主要改进点

1. **PostgresSaver 检查点** vs MemorySaver：
   - 支持断线重连和故障恢复
   - 状态持久化到数据库
   - 更好的可靠性和可维护性

2. **中断点机制**：
   - 支持用户确认和交互
   - 更灵活的流程控制
   - 更好的用户体验

3. **简化通信架构**：
   - 去除了实时通信层（SSE/Socket.IO）
   - 通过 API 请求-响应模式交互
   - 架构更简单，减少了维护成本

4. **向量化嵌入**：
   - 支持语义搜索和智能推荐
   - 更智能的材料检索

5. **工作流状态持久化**：
   - 支持历史回溯和审计
   - 更好的数据完整性
   - 通过 PostgresSaver 实现断线重连

6. **更合理的积分扣减**：
   - 分析成功后才扣减积分
   - 避免失败时的积分损失

### 技术演进方向

现有项目代表了案件分析系统的技术演进方向：
- **从内存到持久化**：MemorySaver → PostgresSaver
- **从实时到异步**：SSE/Socket.IO → API 请求-响应
- **从静态到动态**：硬编码 → 数据库配置
- **从简单到复杂**：线性流程 → 状态机 + 中断点

这些改进使得现有项目更适合处理复杂的业务场景，同时保持了良好的可扩展性和可维护性。
