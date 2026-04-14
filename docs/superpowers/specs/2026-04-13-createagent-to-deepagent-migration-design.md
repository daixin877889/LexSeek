# 接入 Agent Skills 生态设计

## 概述

在现有 `createAgent` 架构上接入 [Agent Skills 开放标准](https://agentskills.io/specification)，通过 `deepagents` 包的 `createSkillsMiddleware` 中间件实现标准 Skills 发现和加载能力。

**现有 `createAgent` 代码零改动。仅追加中间件和工具。**

### 为什么使用 `deepagents` 而非自建

项目在 2026-04-07 曾移除 `deepagents` 依赖（当时是整体迁移到 `createAgent`）。本次重新引入仅使用 `createSkillsMiddleware` + `FilesystemBackend` 两个导出，原因：

- Agent Skills 规范细节繁多（name 校验规则、Unicode 处理、symlink 安全、多 source 优先级覆盖、state reducer 等），`createSkillsMiddleware` 已实现并经社区验证
- 自建 50 行中间件只能覆盖核心路径，边界情况和规范兼容性无法保证
- `createSkillsMiddleware` 返回标准 `AgentMiddleware`（来自 `langchain` 包），与 `createAgent` 完全兼容，不引入架构耦合

### Skills 系统与 Nodes 配置的职责边界

项目已有 Nodes 表 + Prompts 系统（数据库存储、管理后台管理），本质上也是一种"技能系统"。两者职责划分：

| | Nodes 配置 | Agent Skills |
|---|---|---|
| 存储 | 数据库 | 文件系统（`.deepagents/skills/`） |
| 管理 | 管理后台 UI | 文件编辑 / `npx skills add` |
| 适用场景 | 项目内部的业务节点（案件分析、模块对话等） | 跨项目/跨平台的通用技能（法律检索、代码审查等） |
| 生态 | 项目私有 | 开放标准（skills.sh 1370+ 技能库） |

## 动机

接入 Agent Skills 生态（skills.sh 1370+ 技能库），使 LexSeek 的 Agent 能够：
1. 自动发现和加载 SKILL.md 定义的领域技能
2. 执行 Skill 中的脚本（Phase 2，有实际业务需求时实现）
3. 与 Claude Code、Codex、Copilot 等共享同一套 Skill 格式

> **注意**：本文档中的 `lexseek` Skill 仅作为验证示范，不代表最终要接入的 Skill 内容。实际 Skills 将根据业务需求另行设计。

## 已验证的技术可行性

通过 `/tmp/deepagents-test/verify.cjs` 和 `verify-risks.cjs` 脚本验证：

| 验证项 | 结果 |
|-------|------|
| `createSkillsMiddleware` 创建 | ✓ 返回标准 `AgentMiddleware`（来自 `langchain` 包） |
| `FilesystemBackend` 发现 SKILL.md | ✓ 使用相对路径 `./skills/` |
| `createAgent` 接受 skillsMiddleware | ✓ 编译成功，与 `summarizationMiddleware` 等共存 |
| SKILL.md 读取 | ✓ 正确解析 YAML frontmatter + Markdown |
| 中间件顺序（洋葱模型） | ✓ 末尾注册 = 最外层 = 最先注入 prompt |
| 旧 checkpoint 恢复 | ✓ 新增 state channel 使用默认值，无需迁移 |

## 约束

- 所有现有 `createAgent` 代码不动（caseMainAgent、moduleAgent、caseAnalysis、subAgentToolFactory）
- 所有现有中间件不动（积分、材料上下文、摘要、截断等）
- 所有现有工具不动（search_law、search_case_materials 等）
- `caseAnalysisV2.workflow.ts` 不动（StateGraph 不支持 AgentMiddleware，Skills 仅对 `createAgent` 有效）
- SSE/Redis/Worker 管道不动

## 架构设计

### 分阶段实施

**Phase 1（本次）**：Skills 发现 + Skill 文件读取
- `createSkillsMiddleware` 中间件
- `read_skill_file` 工具

**Phase 2（有实际业务需求时）**：脚本执行
- `run_skill_script` 工具

### 改动点

```
Phase 1 新增:
├── 1. createSkillsMiddleware 追加到现有 middleware 数组
└── 2. read_skill_file 工具（读取 SKILL.md 和 references）

Phase 2 新增（延后）:
└── 3. run_skill_script 工具（执行 skills/*/scripts/ 下的脚本）

不受影响（全部现有代码）:
├── createAgent 调用方式不变
├── 中间件栈不变（只在末尾追加）
├── 工具列表不变（只追加新工具）
└── 其余所有文件不变
```

### 集成方式

以 caseMainAgent 为例：

```typescript
// === 新增 import ===
import { createSkillsMiddleware, FilesystemBackend } from 'deepagents'
import { createTool as createReadSkillFileTool } from '../tools/readSkillFile.tool'

// === Skills 中间件（模块级单例） ===
const skillsMiddleware = createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: '/app' }),
    sources: ['./.deepagents/skills/'],
})

// === 现有代码不动，只在 middleware 和 tools 末尾追加 ===
const agent: ReactAgent = createAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: [
        ...allTools,                              // 现有工具不动
        createReadSkillFileTool(toolContext),      // 新增：读取 Skill 文件
    ],
    middleware: [
        // 现有中间件不动
        pointConsumptionMiddleware(...),
        caseProcessMaterialMiddleware(...),
        caseMaterialContextMiddleware(...),
        summarizationMiddleware({...}),
        safetyTrimMiddleware({...}),
        // 新增：Skills 发现和加载（末尾注册 = 洋葱模型最外层 = 最先注入 prompt）
        skillsMiddleware,
    ],
})
```

moduleAgent 同理，区别在于现有中间件栈不同（使用 `moduleContextMiddleware` 而非 `caseProcessMaterialMiddleware`/`caseMaterialContextMiddleware`），追加方式一致。

**注意**：`caseAnalysisV2.workflow.ts` 使用 StateGraph，不支持 AgentMiddleware，因此不接入 Skills。`subAgentToolFactory.ts` 创建的子代理暂不注入 Skills（避免增加子代理 prompt 长度）。

### read_skill_file 工具

遵循项目 `ToolModule` 接口（`toolDefinition` + `createTool`），注册到工具注册表：

```typescript
import { tool } from '@langchain/core/tools'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolModule } from './types'

const SKILLS_ROOT = resolve('/app/.deepagents/skills')

const schema = z.object({
    path: z.string().describe('文件路径，如 lexseek/SKILL.md'),
})

export const toolDefinition = {
    name: 'read_skill_file',
    description: '读取 skill 文件内容（SKILL.md、references 等）',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async ({ path: filePath }) => {
            if (filePath.includes('..') || filePath.startsWith('/')) {
                return 'Error: 非法路径'
            }
            const fullPath = resolve(SKILLS_ROOT, filePath.replace(/^\.?\/?skills\//, ''))
            if (!fullPath.startsWith(SKILLS_ROOT)) {
                return 'Error: 只允许读取 skills 目录内的文件'
            }
            try {
                return await readFile(fullPath, 'utf-8')
            } catch {
                return `Error: 文件不存在 ${filePath}`
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        }
    )
}
```

### Skills 目录

遵循 [Agent Skills 规范](https://agentskills.io/specification) 的标准目录结构：

```
.deepagents/
└── skills/
    └── <skill-name>/
        ├── SKILL.md            # 必需：指令 + YAML frontmatter
        ├── scripts/            # 可选：Agent 可执行的脚本（Phase 2）
        ├── references/         # 可选：按需加载的参考文档
        └── assets/             # 可选：模板、图片等资源
```

### 多用户隔离

| 组件 | 隔离性 | 说明 |
|------|--------|------|
| SkillsMiddleware | ✅ 安全 | 只读取 SKILL.md 元数据，不写文件 |
| `skillsMetadata` state | ✅ 安全 | 存在 agent state 中，per-thread 隔离 |
| `files` state channel | ✅ 安全 | SkillsMiddleware 添加但不写入，per-thread 隔离 |
| read_skill_file 工具 | ✅ 安全 | 只读、白名单限制、禁止路径遍历 |
| 现有中间件/工具 | ✅ 不变 | 不受影响 |

Skills 是共享只读资源，无跨用户污染。

### 工具名冲突检查

| 新增工具名 | 现有工具 | deepagent 内置 | 冲突？ |
|-----------|---------|---------------|--------|
| `read_skill_file` | 无 | 无同名 | ✅ 无冲突 |

## 文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/tools/readSkillFile.tool.ts` | Skill 文件读取工具（遵循 ToolModule 接口） |
| `.deepagents/skills/` | Skills 根目录 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/workflow/tools/index.ts` | 注册 `read_skill_file` 到 toolModules |
| `server/services/workflow/agents/caseMainAgent.ts` | middleware 末尾追加 `skillsMiddleware`，tools 追加 read_skill_file |
| `server/services/workflow/agents/moduleAgent.ts` | 同上 |
| `server/services/workflow/middleware/types.ts` | 添加 `SKILLS_DISCOVERY` 到 `MIDDLEWARE_PRIORITY` |
| `package.json` | 新增 `deepagents@^1.9.0` |
| `Dockerfile` | runner 阶段第39行后追加 `COPY --from=builder /app/.deepagents ./.deepagents` |

### 不受影响

- `createAgent` 调用参数结构不变（只追加数组元素）
- 所有现有中间件不变
- 所有现有工具不变
- `caseAnalysisV2.workflow.ts` 不变（StateGraph，不支持 AgentMiddleware）
- `subAgentToolFactory.ts` 不变
- `caseAnalysis.ts` 不变
- SSE/Redis/Worker 管道不变
- 所有 API 端点不变

### 依赖变更

| 操作 | 包名 | 版本 | 说明 |
|------|------|------|------|
| 新增 | `deepagents` | ^1.9.0 | 仅使用 `createSkillsMiddleware` + `FilesystemBackend` |
| 升级 | `langsmith` | >=0.5.15 | deepagents peerDep，项目当前间接依赖 0.5.10 |

## 风险评估

### 低风险
- **兼容性已验证**：createSkillsMiddleware 返回标准 AgentMiddleware，createAgent 接受无误
- **零改动现有代码**：只追加，不修改
- **无工具冲突**：使用业务前缀命名
- **多用户安全**：Skills 只读，read_skill_file 白名单限制

### 中等风险
- **FilesystemBackend 路径**：必须使用相对路径（`./skills/`），绝对路径无效（已验证）
- **Docker 部署路径**：需在 Docker 中验证 `.deepagents/skills/` 路径解析
- **langsmith 升级**：0.5.10 → >=0.5.15，需验证不影响现有 langchain 生态包

### 已验证 ✓

- **中间件顺序** ✓：末尾注册 = 洋葱模型最外层 = 最先注入 prompt
- **旧 checkpoint 恢复** ✓：新增 state channel 使用默认值，无需迁移

## 实施步骤

### Phase 1：Skills 发现 + 文件读取

1. `bun add deepagents langsmith`
2. 创建 `.deepagents/skills/` 根目录
3. 实现 `readSkillFile.tool.ts`（遵循 ToolModule 接口），注册到 `tools/index.ts`
4. `middleware/types.ts` 添加 `SKILLS_DISCOVERY` 优先级常量
5. caseMainAgent.ts 追加 middleware + tool
6. moduleAgent.ts 追加 middleware + tool
7. Dockerfile runner 阶段追加 `COPY --from=builder /app/.deepagents ./.deepagents`
8. 本地验证：Skill 发现 → SKILL.md 读取（可用 lexseek 示范 Skill）
9. 中断恢复验证：从旧 checkpoint 恢复后 agent 正常工作
10. Docker 验证：路径解析

### Phase 2：脚本执行（有实际业务需求时）

1. 实现 `runSkillScript.tool.ts`（结构化参数、白名单限制）
2. 注册到工具注册表
3. 追加到 agent 的 tools 数组
4. 安全审计：环境隔离、资源限制、审计日志

## 参考资料

- [Agent Skills 规范](https://agentskills.io/specification)
- [Skills - LangChain Docs](https://docs.langchain.com/oss/javascript/langchain/multi-agent/skills)
- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [deepagents npm](https://www.npmjs.com/package/deepagents)
- [skills.sh - Skill 社区生态](https://skills.sh)
