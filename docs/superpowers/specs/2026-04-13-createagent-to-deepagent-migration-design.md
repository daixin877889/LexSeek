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
2. 执行 Skill 中的脚本（Node.js/Python/Bash）
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

**Phase 1（本次）**：Skills 发现 + 文件读写 + 脚本执行 + 文件下载
- `createSkillsMiddleware` 中间件
- `read_skill_file` 工具（读取 Skills 目录和 workspace 目录）
- `write_skill_file` 工具（per-session 临时目录）
- `run_skill_script` 工具（支持 skills 目录和 workspace 目录）
- workspace 文件下载 API（OSS 上传 + 下载链接返回）

脚本执行是 Skills 的核心价值——没有脚本执行，Skills 就只是结构化提示词，项目已有的 Nodes + Prompts 系统完全可以替代。

**写入能力的必要性**：许多 Skills（如 pptx-generator）需要 Agent 动态生成脚本并执行。没有写入能力，Agent 无法创建脚本文件，导致这类 Skill 完全失效。

### per-session workspace 机制

每个会话拥有独立的临时工作目录 `/tmp/skills-workspace/{sessionId}/`，Agent 可在其中创建脚本和输出文件。

```
/tmp/skills-workspace/{sessionId}/
├── generate-ppt.cjs           # Agent 动态创建的脚本
├── output.pptx                # 脚本生成的输出文件
└── ...                        # 其他临时文件
```

**生命周期**：首次调用 `write_skill_file` 时自动创建，会话结束后由系统清理（依赖 OS `/tmp` 清理策略或 agentWorker 清理逻辑）。

**多用户隔离**：每个 sessionId 独立目录，无跨用户污染。工具创建时断言 sessionId 格式合法（不含 `..` 和 `/`）。

### workspace 文件下载链路

Skill 脚本生成的文件（如 .pptx）需要返回给 Web 端用户。**与案件材料一致，保存到用户的 OSS 文件夹中，计入用户云盘配额**。

```
Agent 调用 run_skill_script → 脚本输出文件到 WORKSPACE_DIR
     → Agent 调用 upload_workspace_file 工具
     → 复用现有文件上传服务（存到用户 OSS 目录、计入配额）
     → 返回下载链接 → Agent 在回复中嵌入链接 → 用户点击下载
```

**`upload_workspace_file` 工具**：

```typescript
import { tool } from '@langchain/core/tools'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const WORKSPACE_BASE = '/tmp/skills-workspace'

const schema = z.object({
    fileName: z.string().min(1).describe('workspace 中的文件名，如 output.pptx'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'upload_workspace_file',
    description: '将 workspace 中的文件上传到用户云盘，返回下载链接。文件计入用户云盘配额。',
    schema,
}

export function createTool(context: ToolContext) {
    if (!context.sessionId || context.sessionId.includes('..') || context.sessionId.includes('/')) {
        throw new Error(`Invalid sessionId: ${context.sessionId}`)
    }
    const workspaceDir = resolve(WORKSPACE_BASE, context.sessionId)

    return tool(
        async ({ fileName }) => {
            if (fileName.includes('..') || fileName.includes('/')) {
                return 'Error: 文件名中包含非法字符'
            }

            const filePath = resolve(workspaceDir, fileName)
            if (!filePath.startsWith(workspaceDir + '/') || !existsSync(filePath)) {
                return `Error: 文件不存在 ${fileName}`
            }

            try {
                // 复用现有文件上传服务：存到用户 OSS 目录、计入云盘配额
                // 具体调用方式参照 server/services/files/ 和 server/lib/oss/ 现有逻辑
                const result = await uploadUserFileService(context.userId, filePath, fileName)
                return `文件已上传到您的云盘，下载链接: ${result.downloadUrl}`
            } catch (err) {
                return `Error: 上传失败 ${err instanceof Error ? err.message : '未知错误'}`
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
```

**关键设计**：
- 复用现有的 `uploadUserFileService` / `server/services/files/` + `server/lib/oss/` 上传逻辑
- 通过 `context.userId` 关联到用户 OSS 目录
- 文件大小计入用户云盘配额（与案件材料一致）
- 具体的 service 函数调用需根据现有代码的实际 API 适配

### 改动点

```
新增:
├── 1. createSkillsMiddleware 追加到现有 middleware 数组
├── 2. read_skill_file 工具（读取 SKILL.md 和 references）
├── 3. write_skill_file 工具（写入 per-session workspace 临时目录）
└── 4. run_skill_script 工具（执行 skills 目录或 workspace 目录的脚本）

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
import { createTool as createWriteSkillFileTool } from '../tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '../tools/runSkillScript.tool'
import { createTool as createUploadWorkspaceFileTool } from '../tools/uploadWorkspaceFile.tool'

// === Skills 中间件（模块级单例） ===
const skillsMiddleware = createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: '/app' }),
    sources: ['.deepagents/skills/'],
})

// === 现有代码不动，只在 middleware 和 tools 末尾追加 ===
const agent: ReactAgent = createAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: [
        ...allTools,                              // 现有工具不动
        createReadSkillFileTool(toolContext),      // 新增：读取 Skill/workspace 文件
        createWriteSkillFileTool(toolContext),     // 新增：写入 workspace 文件
        createRunSkillScriptTool(toolContext),     // 新增：执行 Skill 脚本
        createUploadWorkspaceFileTool(toolContext), // 新增：上传 workspace 文件到 OSS
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

遵循项目 `ToolModule` 接口（`toolDefinition` + `createTool`），注册到工具注册表。

**支持两个读取源**：
1. **Skills 目录**（`.deepagents/skills/`）— SKILL.md、references、assets 等
2. **Workspace 目录**（`/tmp/skills-workspace/{sessionId}/`）— Agent 创建的脚本和脚本输出文件（路径前缀 `_workspace/`）

> 以下为简化版代码示例，完整实现见 `server/services/workflow/tools/readSkillFile.tool.ts`（含扩展名白名单、`.deepagents/skills/` 前缀正则处理等）。

```typescript
import { tool } from '@langchain/core/tools'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')
const WORKSPACE_BASE = '/tmp/skills-workspace'

const schema = z.object({
    path: z.string().min(1).describe('文件路径。Skills 文件如 lexseek/SKILL.md；workspace 文件如 _workspace/output.pptx'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'read_skill_file',
    description: '读取 skill 文件或 workspace 文件。路径以 _workspace/ 开头时读取会话工作区文件。',
    schema,
}

export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT
    if (!context.sessionId || context.sessionId.includes('..') || context.sessionId.includes('/')) {
        throw new Error(`Invalid sessionId: ${context.sessionId}`)
    }
    const workspaceDir = resolve(WORKSPACE_BASE, context.sessionId)

    return tool(
        async ({ path: filePath }) => {
            if (filePath.includes('..') || filePath.startsWith('/')) {
                return 'Error: 非法路径'
            }

            let fullPath: string
            let safeBase: string
            if (filePath.startsWith('_workspace/')) {
                // 从 workspace 读取
                const relativePath = filePath.replace(/^_workspace\//, '')
                fullPath = resolve(workspaceDir, relativePath)
                safeBase = workspaceDir
            } else {
                // 从 skills 目录读取
                const normalizedPath = filePath.replace(/^(?:\.?\/?)?(?:\.?deepagents\/)?skills\//, '')
                fullPath = resolve(SKILLS_ROOT, normalizedPath)
                safeBase = SKILLS_ROOT
            }

            if (!fullPath.startsWith(safeBase + '/')) {
                return 'Error: 路径超出允许范围'
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
        },
    )
}
```

### write_skill_file 工具

Agent 动态创建脚本和输出文件的能力。写入到 per-session 临时目录 `/tmp/skills-workspace-{sessionId}/`，遵循 ToolModule 接口：

```typescript
import { tool } from '@langchain/core/tools'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const WORKSPACE_BASE = '/tmp/skills-workspace'

const schema = z.object({
    path: z.string().min(1).describe('文件路径（相对于 workspace），如 generate-ppt.cjs 或 output/report.md'),
    content: z.string().describe('文件内容'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'write_skill_file',
    description: '在会话工作区写入文件（用于创建脚本、保存输出等）。文件存储在隔离的临时目录中。',
    schema,
}

export function createTool(context: ToolContext, workspaceBase?: string) {
    const base = workspaceBase ?? WORKSPACE_BASE
    // 防御性校验：sessionId 不得包含路径遍历字符
    if (!context.sessionId || context.sessionId.includes('..') || context.sessionId.includes('/')) {
        throw new Error(`Invalid sessionId: ${context.sessionId}`)
    }
    const workspaceDir = resolve(base, context.sessionId)

    return tool(
        async ({ path: filePath, content }) => {
            if (filePath.includes('..') || filePath.startsWith('/')) {
                return 'Error: 非法路径'
            }

            const fullPath = resolve(workspaceDir, filePath)
            if (!fullPath.startsWith(workspaceDir + '/')) {
                return 'Error: 只允许写入 workspace 目录内的文件'
            }

            try {
                await mkdir(dirname(fullPath), { recursive: true })
                await writeFile(fullPath, content, 'utf-8')
                return `文件已写入: ${fullPath}`
            } catch (err) {
                return `Error: 写入失败 ${err instanceof Error ? err.message : '未知错误'}`
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
```

**关键设计**：
- `workspaceDir` 使用 `context.sessionId` 隔离，每个会话独立目录
- 路径校验与 `read_skill_file` 一致（禁止 `..` 和绝对路径，`startsWith` 二次校验）
- `mkdir({ recursive: true })` 自动创建子目录

### run_skill_script 工具

使用**结构化参数**防止命令注入，遵循 ToolModule 接口。支持 Node.js、Python、Bash 三种运行时。

**支持两个执行源**：
1. **Skills 目录**（`.deepagents/skills/{skillName}/scripts/`）— 预装的 Skill 脚本
2. **Workspace 目录**（`/tmp/skills-workspace/{sessionId}/`）— Agent 动态创建的脚本

```typescript
import { tool } from '@langchain/core/tools'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')
const WORKSPACE_BASE = '/tmp/skills-workspace'

const ALLOWED_RUNTIMES: Record<string, string> = {
    node: 'node',
    python: 'python3',
    bash: 'bash',
}

const schema = z.object({
    skillName: z.string().describe('Skill 名称，如 lexseek。使用 "_workspace" 执行 workspace 中的脚本'),
    scriptName: z.string().describe('脚本文件名，如 lexseek.cjs、extract.py、setup.sh'),
    action: z.string().describe('操作名称，如 search, login（作为第一个参数传入脚本）'),
    args: z.record(z.string()).optional().describe('参数键值对，如 { query: "关键词" }'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'run_skill_script',
    description: '执行 skill 脚本或 workspace 中的脚本。skillName="_workspace" 表示执行 workspace 中 Agent 创建的脚本',
    schema,
}

export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT
    if (!context.sessionId || context.sessionId.includes('..') || context.sessionId.includes('/')) {
        throw new Error(`Invalid sessionId: ${context.sessionId}`)
    }
    const workspaceDir = resolve(WORKSPACE_BASE, context.sessionId)

    return tool(
        async ({ skillName, scriptName, action, args }) => {
            // 通用安全校验：所有用户输入参数禁止路径遍历
            if ([skillName, scriptName, action].some(s => s.includes('..') || s.includes('/'))) {
                return 'Error: 参数中包含非法字符'
            }

            // 确定脚本路径和工作目录
            let scriptPath: string
            let cwd: string
            if (skillName === '_workspace') {
                scriptPath = resolve(workspaceDir, scriptName)
                cwd = workspaceDir
                if (!scriptPath.startsWith(workspaceDir + '/') || !existsSync(scriptPath)) {
                    return `Error: workspace 中脚本不存在 ${scriptName}`
                }
            } else {
                const scriptsDir = resolve(SKILLS_ROOT, skillName, 'scripts')
                scriptPath = resolve(scriptsDir, scriptName)
                cwd = scriptsDir
                if (!scriptPath.startsWith(SKILLS_ROOT + '/') || !existsSync(scriptPath)) {
                    return `Error: 脚本不存在 ${skillName}/scripts/${scriptName}`
                }
            }

            // 推断运行时
            const ext = scriptName.split('.').pop()?.toLowerCase()
            let runtime: string
            if (ext === 'js' || ext === 'cjs' || ext === 'mjs') runtime = 'node'
            else if (ext === 'py') runtime = 'python'
            else if (ext === 'sh') runtime = 'bash'
            else return `Error: 不支持的脚本类型 .${ext}，仅支持 .js/.cjs/.mjs/.py/.sh`

            const runtimeBin = ALLOWED_RUNTIMES[runtime]
            const execArgs = [scriptPath, action]
            for (const [key, value] of Object.entries(args ?? {})) {
                execArgs.push(`--${key}`, value)
            }

            return new Promise<string>((done) => {
                execFile(runtimeBin, execArgs, {
                    timeout: 30_000,
                    cwd,
                    env: {
                        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                        HOME: process.env.HOME || '/tmp',
                        LANG: process.env.LANG || 'en_US.UTF-8',
                        NODE_ENV: 'production',
                        NODE_PATH: process.env.NODE_PATH || '',
                        // workspace 目录作为环境变量，脚本可用于输出文件
                        WORKSPACE_DIR: workspaceDir,
                    },
                }, (err, stdout, stderr) => {
                    if (err) {
                        done(`Error (exit ${err.code}): ${stderr || err.message}`)
                    } else {
                        done(stderr ? `${stdout}\n[stderr]: ${stderr}` : stdout)
                    }
                })
            })
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema,
        },
    )
}
```

**典型工作流（pptx-generator 示例）**：
1. Agent 调用 `read_skill_file` 读取 `pptx-generator/SKILL.md` 和 `references/pptxgenjs.md`
2. Agent 调用 `write_skill_file` 创建 `generate-ppt.cjs`（根据用户需求动态生成）
3. Agent 调用 `run_skill_script`（`skillName="_workspace"`, `scriptName="generate-ppt.cjs"`）执行脚本
4. 脚本将 .pptx 文件输出到 `WORKSPACE_DIR` 环境变量指向的目录
5. Agent 调用 `read_skill_file`（`path="_workspace/output.pptx"`）确认文件生成（或读取文本格式的输出日志）
6. Agent 调用 `upload_workspace_file`（`fileName="output.pptx"`）上传到 OSS
7. Agent 在回复中嵌入下载链接 → 用户点击下载

### Skills 目录

遵循 [Agent Skills 规范](https://agentskills.io/specification) 的标准目录结构：

```
.deepagents/
└── skills/
    └── <skill-name>/
        ├── SKILL.md            # 必需：指令 + YAML frontmatter
        ├── scripts/            # 可选：Agent 可执行的脚本（Node.js/Python/Bash）
        ├── references/         # 可选：按需加载的参考文档
        └── assets/             # 可选：模板、图片等资源
```

### 多用户隔离

| 组件 | 隔离性 | 说明 |
|------|--------|------|
| SkillsMiddleware | ✅ 安全 | 只读取 SKILL.md 元数据，不写文件 |
| `skillsMetadata` state | ✅ 安全 | 存在 agent state 中，per-thread 隔离 |
| `files` state channel | ✅ 安全 | SkillsMiddleware 添加但不写入，per-thread 隔离 |
| read_skill_file 工具 | ✅ 安全 | 只读、白名单限制、禁止路径遍历；workspace 读取限定在 session 目录内 |
| write_skill_file 工具 | ✅ 安全 | 写入 per-session 临时目录（`/tmp/skills-workspace/{sessionId}/`），sessionId 格式校验 |
| run_skill_script 工具 | ✅ 安全 | 结构化参数、白名单限制、30s 超时；workspace 脚本限定在 session 目录内 |
| upload_workspace_file 工具 | ✅ 安全 | 只上传 workspace 内文件到 OSS，文件名禁止路径遍历 |
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
| `write_skill_file` | 无 | 无同名 | ✅ 无冲突 |
| `run_skill_script` | 无 | 无同名 | ✅ 无冲突 |
| `upload_workspace_file` | 无 | 无同名 | ✅ 无冲突 |

## 文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/tools/readSkillFile.tool.ts` | Skill/workspace 文件读取工具 |
| `server/services/workflow/tools/writeSkillFile.tool.ts` | Workspace 文件写入工具（per-session 隔离） |
| `server/services/workflow/tools/runSkillScript.tool.ts` | Skill 脚本执行工具（skills + workspace） |
| `server/services/workflow/tools/uploadWorkspaceFile.tool.ts` | Workspace 文件上传 OSS 工具 |
| `.deepagents/skills/` | Skills 根目录 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/workflow/tools/index.ts` | 注册 4 个 skill 工具到 toolModules |
| `server/services/workflow/agents/caseMainAgent.ts` | middleware 末尾追加 `skillsMiddleware`，tools 追加 4 个工具 |
| `server/services/workflow/agents/moduleAgent.ts` | 同上（middleware + 4 个工具） |
| `server/services/workflow/middleware/types.ts` | 添加 `SKILLS_DISCOVERY` 到 `MIDDLEWARE_PRIORITY` |
| `package.json` | 新增 `deepagents@^1.9.0` |
| `Dockerfile` | runner 阶段安装 `python3` + `COPY --from=builder /app/.deepagents ./.deepagents` |
| `.dockerignore` | 添加 `!.deepagents/**/*.md` 排除规则（`*.md` 会误删 SKILL.md） |

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

1. `bun add deepagents langsmith`
2. 创建 `.deepagents/skills/` 根目录
3. 实现 `readSkillFile.tool.ts`（支持 skills + workspace 读取）
4. 实现 `writeSkillFile.tool.ts`（per-session workspace 写入）
5. 实现 `runSkillScript.tool.ts`（支持 skills + workspace 执行）
6. 实现 `uploadWorkspaceFile.tool.ts`（workspace 文件上传 OSS）
7. 注册 4 个工具到 `tools/index.ts`
8. `middleware/types.ts` 添加 `SKILLS_DISCOVERY` 优先级常量
9. caseMainAgent.ts 追加 middleware + 4 个工具
10. moduleAgent.ts 追加 middleware + 4 个工具
11. Dockerfile runner 阶段：安装 `python3` + `COPY --from=builder /app/.deepagents ./.deepagents`
12. 本地验证：Skill 发现 → 读取 → 写入脚本到 workspace → 执行 → 上传输出文件
13. 中断恢复验证：从旧 checkpoint 恢复后 agent 正常工作
14. Docker 验证：路径解析 + 脚本执行 + workspace 隔离 + OSS 上传

## 参考资料

- [Agent Skills 规范](https://agentskills.io/specification)
- [Skills - LangChain Docs](https://docs.langchain.com/oss/javascript/langchain/multi-agent/skills)
- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [deepagents npm](https://www.npmjs.com/package/deepagents)
- [skills.sh - Skill 社区生态](https://skills.sh)
