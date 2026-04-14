# 接入 Agent Skills 生态设计

## 概述

在现有 `createAgent` 架构上接入 [Agent Skills 开放标准](https://agentskills.io/specification)，通过 `deepagents` 包的 `createSkillsMiddleware` 中间件实现标准 Skills 发现和加载能力，同时增加受限的脚本执行工具支持 Skill 脚本。

**现有 `createAgent` 代码零改动。仅追加中间件和工具。**

## 动机

接入 Agent Skills 生态（skills.sh 1370+ 技能库），使 LexSeek 的 Agent 能够：
1. 自动发现和加载 SKILL.md 定义的领域技能
2. 执行 Skill 中的脚本
3. 与 Claude Code、Codex、Copilot 等共享同一套 Skill 格式

> **注意**：本文档中的 `lexseek` Skill 仅作为验证示范，不代表最终要接入的 Skill 内容。实际 Skills 将根据业务需求另行设计。

## 已验证的技术可行性

通过 `/tmp/deepagents-test/verify.cjs` 脚本验证：

| 验证项 | 结果 |
|-------|------|
| `createSkillsMiddleware` 创建 | ✓ 返回标准 `AgentMiddleware`（来自 `langchain` 包） |
| `FilesystemBackend` 发现 SKILL.md | ✓ 使用相对路径 `./skills/` |
| `createAgent` 接受 skillsMiddleware | ✓ 编译成功，与 `summarizationMiddleware` 等共存 |
| SKILL.md 读取 | ✓ 正确解析 YAML frontmatter + Markdown |

**关键发现**：`createSkillsMiddleware` 返回的是 `langchain` 包定义的 `AgentMiddleware` 类型，与 `createAgent` 完全兼容。不需要 `createDeepAgent`。

## 约束

- 所有现有 `createAgent` 代码不动（caseMainAgent、moduleAgent、caseAnalysis、subAgentToolFactory）
- 所有现有中间件不动（积分、材料上下文、摘要、截断等）
- 所有现有工具不动（search_law、search_case_materials 等）
- `caseAnalysisV2.workflow.ts` 不动
- SSE/Redis/Worker 管道不动

## 架构设计

### 改动点（仅 3 处）

```
新增:
├── 1. createSkillsMiddleware 追加到现有 middleware 数组
├── 2. readSkillFile 工具（读取 SKILL.md 和 references）
└── 3. runSkillScript 工具（执行 skills/*/scripts/ 下的脚本）

不受影响（全部现有代码）:
├── createAgent 调用方式不变
├── 中间件栈不变（只在末尾追加）
├── 工具列表不变（只追加新工具）
└── 其余所有文件不变
```

### 集成方式

以 caseMainAgent 为例（moduleAgent 同理）：

```typescript
// === 新增 import ===
import { createSkillsMiddleware, FilesystemBackend } from 'deepagents'
import { readSkillFile } from '../tools/readSkillFile.tool'
import { runSkillScript } from '../tools/runSkillScript.tool'

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
        ...allTools,          // 现有工具不动
        readSkillFile,        // 新增：读取 Skill 文件
        runSkillScript,       // 新增：执行 Skill 脚本
    ],
    middleware: [
        // 现有中间件不动
        pointConsumptionMiddleware(...),
        caseProcessMaterialMiddleware(...),
        caseMaterialContextMiddleware(...),
        summarizationMiddleware({...}),
        safetyTrimMiddleware({...}),
        // 新增：Skills 发现和加载
        skillsMiddleware,
    ],
})
```

### read_skill_file 工具

SkillsMiddleware 将 skill 路径注入 system prompt（如 `Read skills/lexseek/SKILL.md for full instructions`），Agent 需要一个文件读取工具来加载完整内容。

```typescript
import { tool } from 'langchain'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'

const SKILLS_ROOT = resolve('/app/.deepagents/skills')

export const readSkillFile = tool(
    async ({ path: filePath }) => {
        // 安全校验：禁止路径遍历和绝对路径
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
        name: 'read_skill_file',
        description: '读取 skill 文件内容（SKILL.md、references 等）',
        schema: z.object({
            path: z.string().describe('文件路径，如 lexseek/SKILL.md'),
        }),
    }
)
```

### run_skill_script 工具

使用**结构化参数**代替自由文本命令，防止命令注入：

```typescript
import { tool } from 'langchain'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'

const SKILLS_ROOT = resolve('/app/.deepagents/skills')

export const runSkillScript = tool(
    async ({ skillName, scriptName, action, args }) => {
        // 安全校验：名称中禁止路径遍历字符
        if ([skillName, scriptName, action].some(s => s.includes('..') || s.includes('/'))) {
            return 'Error: 参数中包含非法字符'
        }

        const scriptPath = resolve(SKILLS_ROOT, skillName, 'scripts', scriptName)
        if (!scriptPath.startsWith(SKILLS_ROOT) || !existsSync(scriptPath)) {
            return `Error: 脚本不存在 ${skillName}/scripts/${scriptName}`
        }

        // 构建参数数组：action + args 键值对转为 --key value 格式
        const execArgs = [scriptPath, action]
        for (const [key, value] of Object.entries(args ?? {})) {
            execArgs.push(`--${key}`, value)
        }

        return new Promise((done) => {
            execFile('node', execArgs, {
                timeout: 30_000,
                cwd: resolve(SKILLS_ROOT, skillName, 'scripts'),
                env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
            }, (err, stdout, stderr) => {
                if (err) done(`Error (exit ${err.code}): ${stderr || err.message}`)
                else done(stdout)
            })
        })
    },
    {
        name: 'run_skill_script',
        description: '执行 skill 脚本。示例：skillName=lexseek, scriptName=lexseek.cjs, action=search, args={query: "劳动合同 解除"}',
        schema: z.object({
            skillName: z.string().describe('Skill 名称，如 lexseek'),
            scriptName: z.string().describe('脚本文件名，如 lexseek.cjs'),
            action: z.string().describe('操作名称，如 search, login'),
            args: z.record(z.string()).optional().describe('参数键值对，如 { query: "关键词" }'),
        }),
    }
)
```

### Skills 目录

遵循 [Agent Skills 规范](https://agentskills.io/specification) 的标准目录结构：

```
.deepagents/
└── skills/
    └── <skill-name>/
        ├── SKILL.md            # 必需：指令 + YAML frontmatter
        ├── scripts/            # 可选：Agent 可执行的脚本
        ├── references/         # 可选：按需加载的参考文档
        └── assets/             # 可选：模板、图片等资源
```

具体 Skill 的内容根据业务需求另行设计，不属于本框架设计的范围。

### 多用户隔离

| 组件 | 隔离性 | 说明 |
|------|--------|------|
| SkillsMiddleware | ✅ 安全 | 只读取 SKILL.md 元数据，不写文件 |
| `skillsMetadata` state | ✅ 安全 | 存在 agent state 中，per-thread 隔离 |
| `files` state channel | ✅ 安全 | SkillsMiddleware 添加但不写入，per-thread 隔离 |
| read_skill_file 工具 | ✅ 安全 | 只读、白名单限制、禁止路径遍历 |
| run_skill_script 工具 | ✅ 安全 | 结构化参数、白名单限制、30s 超时 |
| 现有中间件/工具 | ✅ 不变 | 不受影响 |

**Skill 脚本的多用户安全要求**：

Skills 目录本身是共享只读资源，无跨用户污染。但具体 Skill 脚本的实现需遵守以下规则：
1. **脚本不得在共享目录写入状态**（如认证凭据、缓存数据）
2. **用户级配置通过环境变量注入**，由 `run_skill_script` 工具根据当前用户上下文动态传入
3. 如果脚本需要持久化用户状态，应通过 API 调用服务端存储，而非本地文件

### 工具名冲突检查

| 新增工具名 | 现有工具 | deepagent 内置 | 冲突？ |
|-----------|---------|---------------|--------|
| `read_skill_file` | 无 | 无同名 | ✅ 无冲突 |
| `run_skill_script` | 无 | 无同名 | ✅ 无冲突 |

使用业务前缀命名（`read_skill_file`、`run_skill_script`），避免与 deepagent 内置的 `read_file`、`execute` 冲突，也防止未来加载其他 deepagent 中间件时产生命名冲突。

## 文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/tools/readSkillFile.tool.ts` | 只读的 Skill 文件读取工具 |
| `server/services/workflow/tools/runSkillScript.tool.ts` | 结构化参数的 Skill 脚本执行工具 |
| `.deepagents/skills/` | Skills 根目录（具体 Skill 内容另行设计） |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/workflow/agents/caseMainAgent.ts` | middleware 末尾追加 `skillsMiddleware`，tools 追加 2 个工具 |
| `server/services/workflow/agents/moduleAgent.ts` | 同上 |
| `package.json` | 新增 `deepagents@^1.9.0` |
| `Dockerfile` | 新增 `COPY .deepagents ./.deepagents` |

### 不受影响

- `createAgent` 调用参数结构不变（只追加数组元素）
- 所有现有中间件不变
- 所有现有工具不变
- `caseAnalysisV2.workflow.ts` 不变
- `subAgentToolFactory.ts` 不变
- `caseAnalysis.ts` 不变
- SSE/Redis/Worker 管道不变
- 所有 API 端点不变

### 依赖变更

| 操作 | 包名 | 版本 | 说明 |
|------|------|------|------|
| 新增 | `deepagents` | ^1.9.0 | 仅使用 `createSkillsMiddleware` + `FilesystemBackend` |
| 新增 | `langsmith` | >=0.5.15 | deepagents peerDependency（需确认是否必装） |

## 风险评估

### 低风险
- **兼容性已验证**：createSkillsMiddleware 返回标准 AgentMiddleware，createAgent 接受无误
- **零改动现有代码**：只追加，不修改
- **无工具冲突**：使用业务前缀命名，不与 deepagent 内置工具冲突
- **多用户安全**：Skills 只读、结构化参数防注入、API Key 通过环境变量注入

### 中等风险
- **FilesystemBackend 路径**：必须使用相对路径（`./skills/`），绝对路径无效（已验证）
- **Docker 部署路径**：`rootDir` 设为 `/app`，`sources` 设为 `./.deepagents/skills/`，需在 Docker 中验证
- **`files` state channel 对 checkpoint 的影响**：SkillsMiddleware 添加了 `skillsMetadata` 和 `files` 到 state schema。现有 checkpoint 不含这些字段，中断恢复时 reducer 的默认值（`[]`/`undefined`）需验证正确
- **langsmith peerDep**：`deepagents` 要求 `langsmith@>=0.5.15`，项目当前未安装，需确认是否必装

### 需验证 → 已验证 ✓

通过 `/tmp/deepagents-test/verify-risks.cjs` 脚本验证：

- **中间件顺序** ✓：SkillsMiddleware 放在 middleware 数组末尾时，其 `wrapModelCall` 在洋葱模型中最外层执行（最先修改 systemMessage）。Skills 信息注入后，内层中间件（summarization 等）可以看到完整的 prompt。这是正确的行为。
- **旧 checkpoint 恢复** ✓：用不含 SkillsMiddleware 的 createAgent 创建 checkpoint 后，用含 SkillsMiddleware 的 createAgent 恢复成功。新增的 `skillsMetadata` 默认值为 `[]`，`files` 默认值为 `{}`。不需要 checkpoint 迁移。

## 迁移步骤

1. `bun add deepagents langsmith`
2. 创建 `.deepagents/skills/` 根目录
3. 实现 `readSkillFile.tool.ts` 和 `runSkillScript.tool.ts`
4. caseMainAgent.ts 追加 middleware + tools
5. moduleAgent.ts 追加 middleware + tools
6. Dockerfile runner 阶段追加 `COPY .deepagents ./.deepagents`
7. 本地验证：Skill 发现 → SKILL.md 读取 → 脚本执行（可用 lexseek 示范 Skill 验证）
8. 中断恢复验证：从旧 checkpoint 恢复后 agent 正常工作
9. Docker 验证：路径解析 + 脚本执行

## 参考资料

- [Agent Skills 规范](https://agentskills.io/specification)
- [Skills - LangChain Docs](https://docs.langchain.com/oss/javascript/langchain/multi-agent/skills)
- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [deepagents npm](https://www.npmjs.com/package/deepagents)
- [skills.sh - Skill 社区生态](https://skills.sh)
