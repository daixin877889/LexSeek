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

---

### 2. 工作流架构调整（关键）

#### 问题：异步加载与全局作用域冲突

**当前代码**（硬编码常量）：
```typescript
// 编译时常量，可在全局作用域访问
const MODULE_ORDER = ['summary', 'chronicle', ...] as const

// 路由函数在全局定义
const getNextNode = (current: string, state) => {
    const idx = MODULE_ORDER.indexOf(current)  // ✅ MODULE_ORDER 已定义
    ...
}
```

**重构后**（异步加载）：
```typescript
// MODULE_ORDER 变为运行时变量，无法在全局作用域访问
const analysisModules = await getNodeConfigsByTypes(['analysis'])
const MODULE_ORDER = analysisModules.map(m => m.name) // ❌ 异步加载，全局作用域无法访问
```

#### 解决方案：每次调用都重新编译工作流

移除单例模式，每次调用 `getCaseAnalysisWorkflow()` 都从数据库加载最新模块并重新编译：

```typescript
/**
 * 获取案件分析工作流实例（每次调用都重新编译）
 *
 * 不缓存工作流实例，每次调用都：
 * 1. 从数据库加载最新的 analysis 类型节点
 * 2. 按 priority 排序构建 MODULE_ORDER
 * 3. 动态编译 StateGraph
 */
export async function getCaseAnalysisWorkflow() {
    // 1. 异步加载模块（每次都查数据库）
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

    return await graph.compile({ checkpointer })
}
```

**架构决策**：
- **不缓存工作流实例**：每次调用都重新编译，确保获取最新模块
- **数据库变更实时生效**：修改 `priority`、新增/禁用模块后，下次调用立即生效
- **性能权衡**：每次调用增加一次数据库查询 + 图编译开销（约 10-50ms）

---

### 3. 调用方更新

**`server/services/agent/caseAgent.ts`**：
```typescript
// 修改前
import { getSubagentConfigsService } from '../node/node.service'
const subagentConfigs = await getSubagentConfigsService(['analysis', 'document'])

// 修改后
import { getNodeConfigsByTypes } from '../node/node.service'
const subagentConfigs = await getNodeConfigsByTypes(['analysis', 'document'])
```

### 4. 修改文件

- `server/services/node/node.service.ts` - 重命名方法
- `server/services/agent/caseAgent.ts` - 更新导入和使用
- `server/services/workflow/caseAnalysis.workflow.new.ts` - 动态加载模块（移除单例）

### 5. 验证场景

| 场景 | 行为 |
|------|------|
| 数据库有 7 个 analysis 模块 | 按 priority 顺序执行选中的模块 |
| 数据库新增第 8 个模块 | **下次调用立即生效**，无需重启 |
| 前端传入不存在的模块名 | 路由函数跳过（`indexOf` 返回 -1） |
| 数据库中某个模块 `status = 0` | **下次调用时**不会出现在 `MODULE_ORDER` 中 |
| 数据库中某个模块 `deletedAt != null` | **下次调用时**不会出现在 `MODULE_ORDER` 中 |
| 修改模块的 `priority` | **下次调用时**顺序立即改变 |

### 6. 性能影响

| 操作 | 耗时 | 说明 |
|------|------|------|
| 数据库查询 | ~5-10ms | 查询 analysis 类型节点 |
| 图编译 | ~5-20ms | LangGraph StateGraph 编译 |
| 总计 | ~10-30ms | 每次调用增加一次开销 |

**优化建议**（可选）：
- 如果性能成为瓶颈，可考虑添加 Redis 缓存（TTL=5min）
- 或使用版本号检测机制，仅在数据变更时重新编译

## 修改文件

- `server/services/node/node.service.ts` - 重命名方法
- `server/services/agent/caseAgent.ts` - 更新导入和使用
- `server/services/workflow/caseAnalysis.workflow.new.ts` - 动态加载模块

## 验证方式

1. 运行现有测试，确保 caseAgent 不受影响
2. 在数据库中添加一个新的 analysis 模块（`priority = 150`），验证工作流自动包含它
3. 在数据库中禁用一个模块（`status = 0`），验证工作流自动跳过它
