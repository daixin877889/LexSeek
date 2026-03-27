# 案件分析工作流动态模块加载实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将硬编码的分析模块改为从数据库动态加载，并重构 Service 方法名称。

**Architecture:** 重命名 `getSubagentConfigsService` 为 `getNodeConfigsByTypes`，在工作流中异步加载模块并使用闭包模式处理路由函数。

**Tech Stack:** TypeScript, Prisma, LangGraph

**参考设计文档:** `docs/superpowers/specs/2026-03-27-case-analysis-dynamic-modules-design.md`

---

## 文件清单

- **修改:** `server/services/node/node.service.ts` - 重命名方法
- **修改:** `server/services/agent/caseAgent.ts` - 更新导入和使用
- **修改:** `server/services/workflow/caseAnalysis.workflow.new.ts` - 动态加载模块

---

## 实施步骤

### Task 1: 重命名 Service 方法

- [ ] **Step 1: 重命名 `getSubagentConfigsService` 为 `getNodeConfigsByTypes`**

修改 `server/services/node/node.service.ts` 第 546 行：

```typescript
// 修改前
export const getSubagentConfigsService = async (
    types: string[] = ['analysis', 'document']
): Promise<NodeConfig[]> => {

// 修改后
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
): Promise<NodeConfig[]> => {
```

- [ ] **Step 2: 提交**

```bash
git add server/services/node/node.service.ts
git commit -m "refactor(node): 重命名 getSubagentConfigsService 为 getNodeConfigsByTypes"
```

### Task 2: 更新调用方

- [ ] **Step 3: 更新 `caseAgent.ts` 导入和使用**

修改 `server/services/agent/caseAgent.ts` 第 12 行和第 72 行：

```typescript
// 修改前
import { getValidNodeConfig, getSubagentConfigsService } from '../node/node.service'
// ...
const subagentConfigs = await getSubagentConfigsService(['analysis', 'document'])

// 修改后
import { getValidNodeConfig, getNodeConfigsByTypes } from '../node/node.service'
// ...
const subagentConfigs = await getNodeConfigsByTypes(['analysis', 'document'])
```

- [ ] **Step 4: 提交**

```bash
git add server/services/agent/caseAgent.ts
git commit -m "refactor(agent): 更新使用 getNodeConfigsByTypes"
```

### Task 3: 工作流动态加载

- [ ] **Step 5: 重构 `caseAnalysis.workflow.new.ts`**

**修改导入**（第 14-19 行）：

```typescript
// 添加导入
import { getNodeConfigsByTypes } from '../node/node.service'
```

**移除全局常量**（删除第 50-54 行）：

```typescript
// 删除：
const MODULE_ORDER = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'] as const
```

**移除全局路由函数**（删除第 55-66 行）：

```typescript
// 删除：
const getNextNode = (current: string, state: typeof WorkflowState.State) => { ... }
```

**重构 `getCaseAnalysisWorkflow` 函数**（第 140-168 行）：

```typescript
export async function getCaseAnalysisWorkflow() {
    if (workflowInstance) return workflowInstance

    // 1. 异步加载模块
    const analysisModules = await getNodeConfigsByTypes(['analysis'])
    const MODULE_ORDER = analysisModules.map(m => m.name)

    // 2. 创建路由函数（闭包访问 MODULE_ORDER）
    const getNextNode = (current: string, state: typeof WorkflowState.State): string => {
        const idx = MODULE_ORDER.indexOf(current)
        if (idx === -1) return END
        const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
        return next ?? END
    }

    // 3. 动态创建节点和边
    const graph = new StateGraph(WorkflowState)

    // 注册节点
    for (const module of analysisModules) {
        graph.addNode(module.name, createAnalysisNode(module.name, module.title || module.name))
    }

    // START 入口
    graph.addConditionalEdges(START, (state) => {
        const first = MODULE_ORDER.find(m => state.selectedModules.includes(m))
        return first ?? END
    })

    // 模块间边
    for (const moduleName of MODULE_ORDER) {
        graph.addConditionalEdges(moduleName, (state) => getNextNode(moduleName, state))
    }

    workflowInstance = await graph.compile({ checkpointer })
    return workflowInstance
}
```

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/caseAnalysis.workflow.new.ts
git commit -m "feat(workflow): 支持从数据库动态加载分析模块"
```

### Task 4: 类型检查

- [ ] **Step 7: 运行类型检查**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
npx nuxi typecheck
```

预期：无类型错误

### Task 5: 测试验证

- [ ] **Step 8: 运行现有测试**

```bash
npx vitest run tests/server/workflow
```

预期：测试通过

- [ ] **Step 9: 手动验证**

在数据库中：
1. 添加一个新的 analysis 模块（`priority = 150`），验证工作流自动包含它
2. 禁用一个模块（`status = 0`），验证工作流自动跳过它

---

## 验证场景

| selectedModules | 预期执行路径 |
|----------------|-------------|
| 数据库有 7 个 analysis 模块 | 按 priority 顺序执行选中的模块 |
| 数据库新增第 8 个模块 | 自动包含，无需改代码 |
| 前端传入不存在的模块名 | 路由函数跳过（`indexOf` 返回 -1） |
| 数据库中某个模块 `status = 0` | 不会出现在 `MODULE_ORDER` 中，自动跳过 |
| 数据库中某个模块 `deletedAt != null` | 不会出现在 `MODULE_ORDER` 中，自动跳过 |
