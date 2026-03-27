# 案件分析工作流模块选择跳过机制

## 背景

`caseAnalysis.workflow.new.ts` 中已定义 `modules` 字段用于指定要分析的模块，但目前未使用——所有节点固定串行执行。前端需要支持选择分析模块（传入后只分析选中模块，未选中模块不分析）。

## 目标

通过状态中的 `selectedModules` 列表判断是否要跳过当前分析节点。如果模块不在列表中，则跳过该节点。

## 设计

### 1. 字段重命名

将 `WorkflowState.modules` 重命名为 `selectedModules`，与 `initAnalysis.executor.ts` 保持一致。

```ts
// 修改前
modules: z.array(z.string()).default(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'])

// 修改后
selectedModules: z.array(z.string()).default(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'])
```

### 2. 条件边（Conditional Edge）

使用 LangGraph 的 `addConditionalEdges` 在边定义处判断下一节点是否执行，而非在节点函数内部判断。

**优势**：
- 未选中的模块节点永远不会被调用，LangSmith 等追踪服务中不会看到跳过的节点
- 追踪日志更简洁

### 3. 通用路由函数

定义模块固定顺序和通用路由函数，避免为每个节点写重复的 if-else：

```ts
const MODULE_ORDER = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence']

// 获取当前节点后的下一个待执行模块
const getNextNode = (current: string, state) => {
  const idx = MODULE_ORDER.indexOf(current)
  const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
  return next ?? END
}
```

### 4. 边定义

每个节点使用条件边替代固定边：

```ts
// 修改前
.addEdge('summary', 'chronicle')
.addEdge('chronicle', 'claim')
// ...

// 修改后
.addConditionalEdges('summary', (state) => getNextNode('summary', state))
.addConditionalEdges('chronicle', (state) => getNextNode('chronicle', state))
.addConditionalEdges('claim', (state) => getNextNode('claim', state))
.addConditionalEdges('trend', (state) => getNextNode('trend', state))
.addConditionalEdges('cause', (state) => getNextNode('cause', state))
.addConditionalEdges('defense', (state) => getNextNode('defense', state))
.addConditionalEdges('evidence', (state) => getNextNode('evidence', state))
```

### 5. 行为示例

`selectedModules = ['summary', 'chronicle', 'evidence']` 时：

```
START → summary → chronicle → (跳过 claim/trend/cause/defense) → evidence → END
```

## 修改文件

- `server/services/workflow/caseAnalysis.workflow.new.ts`

## 验证方式

- 运行现有测试
- 手动测试不同 `selectedModules` 组合的执行路径
