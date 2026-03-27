# 案件分析工作流动态模块加载设计

## 背景

当前 `caseAnalysis.workflow.new.ts` 中硬编码了 7 个分析模块（`MODULE_ORDER`），无法动态调整模块顺序或增删模块。数据库中已有 `nodes` 表存储节点配置，包含 `type`、`priority`、`status` 等字段，支持动态管理。

## 目标

1. 将硬编码的模块列表改为从数据库动态加载
2. 按 `priority` 升序排序
3. 重构现有服务方法，统一语义

## 设计

### 1. Service 方法重构

**当前方法**（语义不清晰）：
```typescript
// 方法名暗示"子代理"，但实际功能是"按类型获取节点配置"
export const getSubagentConfigsService = async (
    types: string[] = ['analysis', 'document']
): Promise<NodeConfig[]>
```

**重构后**（语义清晰）：
```typescript
/**
 * 按类型获取节点配置列表
 *
 * 查询指定类型的节点，按 priority 升序排序
 * 用于工作流模块加载、子代理列表等场景
 *
 * @param types - 节点类型列表，如 ['analysis'] 或 ['analysis', 'document']
 * @returns NodeConfig 列表，按 priority 升序排序
 */
export const getNodeConfigsByTypes = async (
    types: string[] = ['analysis', 'document']
): Promise<NodeConfig[]>
```

**改动**：
- 方法名：`getSubagentConfigsService` → `getNodeConfigsByTypes`
- 功能：不变（仍查询 `type IN types`，`status = 1`，`deletedAt = null`，按 `priority` 排序）
- 语义：从"获取子代理"变为"按类型获取节点配置"

### 2. 调用方更新

**`server/services/agent/caseAgent.ts`**：
```typescript
// 修改前
import { getSubagentConfigsService } from '../node/node.service'
const subagentConfigs = await getSubagentConfigsService(['analysis', 'document'])

// 修改后
import { getNodeConfigsByTypes } from '../node/node.service'
const subagentConfigs = await getNodeConfigsByTypes(['analysis', 'document'])
```

### 3. 工作流动态加载

**`server/services/workflow/caseAnalysis.workflow.new.ts`**：

```typescript
// 修改前（硬编码）
const MODULE_ORDER = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'] as const

// 修改后（动态加载）
import { getNodeConfigsByTypes } from '../node/node.service'

// 在 getCaseAnalysisWorkflow() 中动态加载
const analysisModules = await getNodeConfigsByTypes(['analysis'])
const MODULE_ORDER = analysisModules.map(m => m.name) // string[]，按 priority 排序

// 动态注册节点
const graph = new StateGraph(WorkflowState)
for (const module of analysisModules) {
    graph.addNode(module.name, createAnalysisNode(module.name, module.title || module.name))

    // 动态添加条件边
    graph.addConditionalEdges(module.name, (state) => getNextNode(module.name, state))
}

// START 入口：指向第一个选中的模块
graph.addConditionalEdges(START, (state) => {
    const first = MODULE_ORDER.find(m => state.selectedModules.includes(m))
    return first ?? END
})
```

### 4. 路由函数适配

由于 `MODULE_ORDER` 从 `const` 数组变为运行时 `string[]`，路由函数需要适配：

```typescript
// 修改后（支持运行时数组）
const getNextNode = (current: string, state: typeof WorkflowState.State): string => {
    const idx = MODULE_ORDER.indexOf(current)
    if (idx === -1) {
        // 当前节点不在数据库中，结束工作流
        return END
    }
    const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
    return next ?? END
}
```

### 5. 验证场景

| 场景 | 行为 |
|------|------|
| 数据库有 7 个 analysis 模块 | 按 priority 顺序执行选中的模块 |
| 数据库新增第 8 个模块 | 自动包含，无需改代码 |
| 前端传入不存在的模块名 | 路由函数跳过（`indexOf` 返回 -1） |
| 数据库中某个模块 `status = 0` | 不会出现在 `MODULE_ORDER` 中，自动跳过 |
| 数据库中某个模块 `deletedAt != null` | 不会出现在 `MODULE_ORDER` 中，自动跳过 |

## 修改文件

- `server/services/node/node.service.ts` - 重命名方法
- `server/services/agent/caseAgent.ts` - 更新导入和使用
- `server/services/workflow/caseAnalysis.workflow.new.ts` - 动态加载模块

## 验证方式

1. 运行现有测试，确保 caseAgent 不受影响
2. 在数据库中添加一个新的 analysis 模块（`priority = 150`），验证工作流自动包含它
3. 在数据库中禁用一个模块（`status = 0`），验证工作流自动跳过它
