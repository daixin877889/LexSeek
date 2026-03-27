# 案件分析工作流模块选择跳过机制实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过 `selectedModules` 列表控制分析模块的跳过逻辑，使用 LangGraph 条件边实现。

**Architecture:** 将 `caseAnalysis.workflow.new.ts` 中固定的串行边（`addEdge`）替换为条件边（`addConditionalEdges`），通过通用路由函数 `getNextNode` 判断下一个执行的模块。

**Tech Stack:** LangGraph, TypeScript, Zod

**参考设计文档:** `docs/superpowers/specs/2026-03-27-case-analysis-modules-design.md`

---

## 文件清单

- **修改:** `server/services/workflow/caseAnalysis.workflow.new.ts`

---

## 实施步骤

### Task 1: 修改状态字段

- [ ] **Step 1: 将 `modules` 字段重命名为 `selectedModules`**

修改 `WorkflowState` 定义（第 38-39 行）：

```ts
// 修改前
modules: z.array(z.string()).default(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'])

// 修改后
selectedModules: z.array(z.string()).default(['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'])
```

### Task 2: 添加路由函数

- [ ] **Step 2: 添加 `MODULE_ORDER` 常量和 `getNextNode` 函数**

在 `createAnalysisNode` 函数之前添加：

```ts
/**
 * 模块执行顺序（固定顺序，不可调整）
 */
const MODULE_ORDER = ['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence'] as const

/**
 * 获取当前节点后的下一个待执行模块
 *
 * @param current - 当前节点名称
 * @param state - 工作流状态（含 selectedModules）
 * @returns 下一个模块名称，如果后续没有选中模块则返回 END
 */
const getNextNode = (current: string, state: typeof WorkflowState.State) => {
    const idx = MODULE_ORDER.indexOf(current as typeof MODULE_ORDER[number])
    const next = MODULE_ORDER.slice(idx + 1).find(m => state.selectedModules.includes(m))
    return next ?? END
}
```

### Task 3: 替换边定义

- [ ] **Step 3: 替换 `START` 入口边**

移除第 135 行 `.addEdge(START, 'summary')`，替换为：

```ts
// START 入口：指向第一个选中的模块（按 MODULE_ORDER 顺序）
.addConditionalEdges(START, (state: typeof WorkflowState.State) => {
    const first = MODULE_ORDER.find(m => state.selectedModules.includes(m))
    return first ?? END
})
```

- [ ] **Step 4: 替换节点间的固定边**

移除第 136-142 行的固定边，替换为条件边：

```ts
.addConditionalEdges('summary', (state) => getNextNode('summary', state))
.addConditionalEdges('chronicle', (state) => getNextNode('chronicle', state))
.addConditionalEdges('claim', (state) => getNextNode('claim', state))
.addConditionalEdges('trend', (state) => getNextNode('trend', state))
.addConditionalEdges('cause', (state) => getNextNode('cause', state))
.addConditionalEdges('defense', (state) => getNextNode('defense', state))
.addConditionalEdges('evidence', (state) => getNextNode('evidence', state))
```

> **注意：** 需要移除原有的 `.addEdge('evidence', END)`，否则固定边优先级高于条件边。

### Task 4: 类型检查

- [ ] **Step 5: 运行类型检查**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
npx nuxi typecheck
```

预期：无类型错误

### Task 5: 提交

- [ ] **Step 6: 提交代码**

```bash
git add server/services/workflow/caseAnalysis.workflow.new.ts
git commit -m "feat(workflow): 支持通过 selectedModules 选择性执行分析模块"
```

---

## 验证场景

| selectedModules | 预期执行路径 |
|----------------|-------------|
| `['summary', 'chronicle', 'claim', 'trend', 'cause', 'defense', 'evidence']` | 全部 7 个模块 |
| `['summary', 'chronicle', 'evidence']` | summary → chronicle → evidence |
| `['evidence']` | evidence |
| `['chronicle', 'evidence']` | chronicle → evidence |
| `[]` | START → END（无执行） |
