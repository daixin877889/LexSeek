# 接入 Agent Skills 生态实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 createAgent 架构上接入 Agent Skills 开放标准，通过 deepagents 的 createSkillsMiddleware + 两个自定义工具实现 Skill 发现、读取和脚本执行。

**Architecture:** 现有 createAgent 代码零改动。追加 createSkillsMiddleware 到 middleware 数组末尾（洋葱模型最外层），追加 read_skill_file 和 run_skill_script 两个工具到 tools 数组。Skills 文件存储在 `.deepagents/skills/` 目录。

**Tech Stack:** deepagents（createSkillsMiddleware, FilesystemBackend）、langchain（createAgent, createMiddleware, tool）、@langchain/core/tools、Node.js child_process

**Spec:** `docs/superpowers/specs/2026-04-13-createagent-to-deepagent-migration-design.md`

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `server/services/workflow/tools/readSkillFile.tool.ts` | Skill 文件读取工具（ToolModule 接口） |
| 新建 | `server/services/workflow/tools/runSkillScript.tool.ts` | Skill 脚本执行工具（ToolModule 接口） |
| 新建 | `.deepagents/skills/.gitkeep` | Skills 根目录占位 |
| 修改 | `server/services/workflow/tools/index.ts` | 注册 2 个新工具 |
| 修改 | `server/services/workflow/middleware/types.ts` | 添加 SKILLS_DISCOVERY 优先级 |
| 修改 | `server/services/workflow/agents/caseMainAgent.ts` | 追加 middleware + tools |
| 修改 | `server/services/workflow/agents/moduleAgent.ts` | 追加 middleware + tools |
| 修改 | `package.json` | 新增 deepagents 依赖 |
| 修改 | `Dockerfile` | 安装 python3 + 复制 .deepagents |

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 deepagents 和 langsmith**

```bash
bun add deepagents langsmith
```

- [ ] **Step 2: 验证安装成功**

```bash
node -e "require('deepagents'); console.log('OK')"
```
Expected: `OK`（无 MODULE_NOT_FOUND 错误）

- [ ] **Step 3: 验证现有测试不受影响**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -5
```
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add package.json bun.lock
git commit -m "chore(deps): 新增 deepagents 和 langsmith 依赖"
```

---

### Task 2: 创建 Skills 目录结构

**Files:**
- Create: `.deepagents/skills/.gitkeep`

- [ ] **Step 1: 创建目录和占位文件**

```bash
mkdir -p .deepagents/skills
touch .deepagents/skills/.gitkeep
```

- [ ] **Step 2: 提交**

```bash
git add .deepagents/
git commit -m "chore: 创建 .deepagents/skills 目录"
```

---

### Task 3: 实现 read_skill_file 工具

**Files:**
- Create: `server/services/workflow/tools/readSkillFile.tool.ts`
- Test: `tests/server/workflow/tools/readSkillFile.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// tests/server/workflow/tools/readSkillFile.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// 注意：工具内的 SKILLS_ROOT 在测试时需要通过环境变量或 mock 覆盖
// 这里测试 createTool 返回的 StructuredTool 的 invoke 行为

describe('readSkillFile 工具', () => {
    const testSkillsDir = resolve('/tmp/test-skills-read')
    const testContext = { userId: 1, caseId: 1, sessionId: 'test-session' }

    beforeAll(() => {
        mkdirSync(resolve(testSkillsDir, 'test-skill/references'), { recursive: true })
        writeFileSync(
            resolve(testSkillsDir, 'test-skill/SKILL.md'),
            '---\nname: test-skill\ndescription: 测试技能\n---\n\n# 测试',
        )
        writeFileSync(
            resolve(testSkillsDir, 'test-skill/references/api.md'),
            '# API 文档\n\n测试内容',
        )
    })

    afterAll(() => {
        rmSync(testSkillsDir, { recursive: true, force: true })
    })

    it('应能读取 SKILL.md 文件', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/readSkillFile.tool')
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'test-skill/SKILL.md' })
        expect(result).toContain('name: test-skill')
        expect(result).toContain('# 测试')
    })

    it('应能读取 references 文件', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/readSkillFile.tool')
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'test-skill/references/api.md' })
        expect(result).toContain('# API 文档')
    })

    it('应拒绝路径遍历', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/readSkillFile.tool')
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: '../../../etc/passwd' })
        expect(result).toContain('Error')
    })

    it('应拒绝绝对路径', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/readSkillFile.tool')
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: '/etc/passwd' })
        expect(result).toContain('Error')
    })

    it('应处理不存在的文件', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/readSkillFile.tool')
        const readTool = createTool(testContext, testSkillsDir)
        const result = await readTool.invoke({ path: 'nonexistent/SKILL.md' })
        expect(result).toContain('Error')
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/server/workflow/tools/readSkillFile.test.ts --reporter=verbose
```
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现工具**

创建 `server/services/workflow/tools/readSkillFile.tool.ts`，内容参照 spec 文档第 132-173 行。注意 `createTool` 接受可选的第二个参数 `skillsRoot` 以便测试时覆盖路径：

```typescript
import { tool } from '@langchain/core/tools'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')

const schema = z.object({
    path: z.string().describe('文件路径，如 lexseek/SKILL.md'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'read_skill_file',
    description: '读取 skill 文件内容（SKILL.md、references 等）',
    schema,
}

export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT

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
        },
    )
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run tests/server/workflow/tools/readSkillFile.test.ts --reporter=verbose
```
Expected: 5 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/readSkillFile.tool.ts tests/server/workflow/tools/readSkillFile.test.ts
git commit -m "feat(tools): 实现 read_skill_file 工具"
```

---

### Task 4: 实现 run_skill_script 工具

**Files:**
- Create: `server/services/workflow/tools/runSkillScript.tool.ts`
- Test: `tests/server/workflow/tools/runSkillScript.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
// tests/server/workflow/tools/runSkillScript.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'

describe('runSkillScript 工具', () => {
    const testSkillsDir = resolve('/tmp/test-skills-run')
    const testContext = { userId: 1, caseId: 1, sessionId: 'test-session' }

    beforeAll(() => {
        mkdirSync(resolve(testSkillsDir, 'demo/scripts'), { recursive: true })
        // Node.js 脚本
        writeFileSync(
            resolve(testSkillsDir, 'demo/scripts/hello.cjs'),
            'const action = process.argv[2]; console.log(JSON.stringify({ action, ok: true }))',
        )
        // Bash 脚本
        writeFileSync(
            resolve(testSkillsDir, 'demo/scripts/greet.sh'),
            '#!/bin/bash\necho "hello $1"',
        )
        chmodSync(resolve(testSkillsDir, 'demo/scripts/greet.sh'), '755')
    })

    afterAll(() => {
        rmSync(testSkillsDir, { recursive: true, force: true })
    })

    it('应能执行 Node.js 脚本', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/runSkillScript.tool')
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'hello.cjs',
            action: 'test',
        })
        const parsed = JSON.parse(result)
        expect(parsed.action).toBe('test')
        expect(parsed.ok).toBe(true)
    })

    it('应能执行 Bash 脚本', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/runSkillScript.tool')
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'greet.sh',
            action: 'world',
        })
        expect(result.trim()).toBe('hello world')
    })

    it('应拒绝路径遍历', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/runSkillScript.tool')
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: '..',
            scriptName: 'hello.cjs',
            action: 'test',
        })
        expect(result).toContain('Error')
    })

    it('应拒绝不支持的脚本类型', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/runSkillScript.tool')
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'hello.rb',
            action: 'test',
        })
        expect(result).toContain('Error')
        expect(result).toContain('不支持')
    })

    it('应拒绝不存在的脚本', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/runSkillScript.tool')
        const runTool = createTool(testContext, testSkillsDir)
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'nonexistent.cjs',
            action: 'test',
        })
        expect(result).toContain('Error')
    })

    it('应正确传递 args 参数', async () => {
        const { createTool } = await import('~/server/services/workflow/tools/runSkillScript.tool')
        const runTool = createTool(testContext, testSkillsDir)
        // hello.cjs 不解析 args，但不应报错
        const result = await runTool.invoke({
            skillName: 'demo',
            scriptName: 'hello.cjs',
            action: 'search',
            args: { query: '劳动合同' },
        })
        expect(result).toContain('"action":"search"')
    })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run tests/server/workflow/tools/runSkillScript.test.ts --reporter=verbose
```
Expected: FAIL

- [ ] **Step 3: 实现工具**

创建 `server/services/workflow/tools/runSkillScript.tool.ts`，内容参照 spec 文档第 180-254 行。`createTool` 同样接受可选 `skillsRoot`：

```typescript
import { tool } from '@langchain/core/tools'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'

const DEFAULT_SKILLS_ROOT = resolve(process.cwd(), '.deepagents/skills')

const ALLOWED_RUNTIMES: Record<string, string> = {
    node: 'node',
    python: 'python3',
    bash: 'bash',
}

const schema = z.object({
    skillName: z.string().describe('Skill 名称，如 lexseek'),
    scriptName: z.string().describe('脚本文件名，如 lexseek.cjs、extract.py、setup.sh'),
    action: z.string().describe('操作名称，如 search, login（作为第一个参数传入脚本）'),
    args: z.record(z.string()).optional().describe('参数键值对，如 { query: "关键词" }'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'run_skill_script',
    description: '执行 skill 脚本。示例：skillName=lexseek, scriptName=lexseek.cjs, action=search, args={query: "劳动合同 解除"}',
    schema,
}

export function createTool(context: ToolContext, skillsRoot?: string) {
    const SKILLS_ROOT = skillsRoot ?? DEFAULT_SKILLS_ROOT

    return tool(
        async ({ skillName, scriptName, action, args }) => {
            if ([skillName, scriptName, action].some(s => s.includes('..') || s.includes('/'))) {
                return 'Error: 参数中包含非法字符'
            }

            const scriptPath = resolve(SKILLS_ROOT, skillName, 'scripts', scriptName)
            if (!scriptPath.startsWith(SKILLS_ROOT) || !existsSync(scriptPath)) {
                return `Error: 脚本不存在 ${skillName}/scripts/${scriptName}`
            }

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
                    cwd: resolve(SKILLS_ROOT, skillName, 'scripts'),
                    env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
                }, (err, stdout, stderr) => {
                    if (err) done(`Error (exit ${err.code}): ${stderr || err.message}`)
                    else done(stdout)
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

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run tests/server/workflow/tools/runSkillScript.test.ts --reporter=verbose
```
Expected: 6 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/runSkillScript.tool.ts tests/server/workflow/tools/runSkillScript.test.ts
git commit -m "feat(tools): 实现 run_skill_script 工具"
```

---

### Task 5: 注册工具到工具注册表

**Files:**
- Modify: `server/services/workflow/tools/index.ts:12-28`

- [ ] **Step 1: 添加 import 和注册**

在 `server/services/workflow/tools/index.ts` 中：

```typescript
// 在现有 import 之后（第 18 行后）添加：
import * as readSkillFileTool from './readSkillFile.tool'
import * as runSkillScriptTool from './runSkillScript.tool'
```

在 `toolModules` 映射中（第 27 行 `rollback_points` 之后）添加：

```typescript
    read_skill_file: readSkillFileTool,
    run_skill_script: runSkillScriptTool,
```

- [ ] **Step 2: 验证注册成功**

```bash
npx vitest run tests/server/workflow/tools/ --reporter=verbose
```
Expected: 所有工具测试 PASS

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/tools/index.ts
git commit -m "feat(tools): 注册 read_skill_file 和 run_skill_script 到工具注册表"
```

---

### Task 6: 添加中间件优先级常量

**Files:**
- Modify: `server/services/workflow/middleware/types.ts:29-46,48-58`

- [ ] **Step 1: 在 MIDDLEWARE_PRIORITY 中添加**

在 `server/services/workflow/middleware/types.ts` 第 42 行 `SAFETY_TRIM: 50` 之后添加：

```typescript
    /** Skills 发现和加载（wrapModelCall 注入 prompt，优先级低 = 洋葱模型最外层） */
    SKILLS_DISCOVERY: 60,
```

- [ ] **Step 2: 在 MIDDLEWARE_NAMES 中添加**

在第 57 行 `RESULT_PERSISTENCE` 之后添加：

```typescript
    SKILLS_DISCOVERY: 'skillsDiscovery',
```

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/middleware/types.ts
git commit -m "feat(middleware): 添加 SKILLS_DISCOVERY 中间件优先级常量"
```

---

### Task 7: 集成 Skills 到 caseMainAgent

**Files:**
- Modify: `server/services/workflow/agents/caseMainAgent.ts:8,96,114-132`

- [ ] **Step 1: 添加 import**

在 `server/services/workflow/agents/caseMainAgent.ts` 顶部 import 区域添加：

```typescript
import { createSkillsMiddleware, FilesystemBackend } from 'deepagents'
import { createTool as createReadSkillFileTool } from '../tools/readSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '../tools/runSkillScript.tool'
```

- [ ] **Step 2: 创建 skillsMiddleware 模块级单例**

在 `CASE_MAIN_NODE_NAME` 常量之前添加：

```typescript
/** Skills 中间件（模块级单例） */
const skillsMiddleware = createSkillsMiddleware({
    backend: new FilesystemBackend({ rootDir: process.cwd() }),
    sources: ['./.deepagents/skills/'],
})
```

- [ ] **Step 3: 追加工具到 allTools**

在第 96 行 `const allTools = [...mainTools, ...subAgentToolList]` 之后添加：

```typescript
    // 追加 Skills 工具
    const skillTools = [
        createReadSkillFileTool(toolContext),
        createRunSkillScriptTool(toolContext),
    ]
    const allToolsWithSkills = [...allTools, ...skillTools]
```

将第 119 行 `tools: allTools` 改为 `tools: allToolsWithSkills`。

- [ ] **Step 4: 追加 skillsMiddleware 到 middleware 数组**

在第 131 行 `safetyTrimMiddleware({...})` 之后、`]` 之前添加：

```typescript
            skillsMiddleware,
```

- [ ] **Step 5: 验证编译**

```bash
npx nuxi typecheck 2>&1 | tail -10
```
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/agents/caseMainAgent.ts
git commit -m "feat(agents): 集成 Skills 到案件主 Agent"
```

---

### Task 8: 集成 Skills 到 moduleAgent

**Files:**
- Modify: `server/services/workflow/agents/moduleAgent.ts:14,92,106-124`

- [ ] **Step 1: 添加 import**

与 Task 7 Step 1 相同的 3 行 import。

- [ ] **Step 2: 创建 skillsMiddleware 模块级单例**

与 Task 7 Step 2 相同。

- [ ] **Step 3: 追加工具到 allTools**

在第 92 行 `const allTools = [...nodeTools, saveResultTool]` 之后添加：

```typescript
    const skillTools = [
        createReadSkillFileTool(toolContext),
        createRunSkillScriptTool(toolContext),
    ]
    const allToolsWithSkills = [...allTools, ...skillTools]
```

将第 111 行 `tools: allTools` 改为 `tools: allToolsWithSkills`。

- [ ] **Step 4: 追加 skillsMiddleware 到 middleware 数组**

在第 122 行 `safetyTrimMiddleware({...})` 之后、`]` 之前添加 `skillsMiddleware`。

- [ ] **Step 5: 验证编译**

```bash
npx nuxi typecheck 2>&1 | tail -10
```
Expected: 无类型错误

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/agents/moduleAgent.ts
git commit -m "feat(agents): 集成 Skills 到模块对话 Agent"
```

---

### Task 9: 更新 Dockerfile

**Files:**
- Modify: `Dockerfile:29-39`

- [ ] **Step 1: 在 runner 阶段安装 python3 并复制 .deepagents**

在 `Dockerfile` 第 29 行 `FROM oven/bun:1-slim AS runner` 之后、`WORKDIR /app` 之后添加：

```dockerfile
# 安装 Python 运行时（支持 Python Skills 脚本）
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 && \
    rm -rf /var/lib/apt/lists/*
```

在第 39 行 `COPY --from=builder /app/.output ./.output` 之后添加：

```dockerfile
# 复制 Skills 目录（含脚本和参考文档）
COPY --from=builder /app/.deepagents ./.deepagents
```

- [ ] **Step 2: 提交**

```bash
git add Dockerfile
git commit -m "chore(docker): 安装 python3 并复制 .deepagents 目录"
```

---

### Task 10: 本地端到端验证

- [ ] **Step 1: 创建测试 Skill**

```bash
mkdir -p .deepagents/skills/hello-world/scripts
cat > .deepagents/skills/hello-world/SKILL.md << 'EOF'
---
name: hello-world
description: 验证 Skills 集成的测试技能。当用户说"测试 skills"时使用。
---

# Hello World Skill

运行脚本验证：`node scripts/hello.cjs test`
EOF

cat > .deepagents/skills/hello-world/scripts/hello.cjs << 'EOF'
const action = process.argv[2] || 'default'
console.log(JSON.stringify({ skill: 'hello-world', action, success: true }))
EOF
```

- [ ] **Step 2: 启动开发服务器验证**

```bash
bun dev
```

通过小索对话发送"测试 skills"，观察：
1. Agent 是否在 system prompt 中看到 hello-world skill
2. Agent 是否调用 read_skill_file 读取 SKILL.md
3. Agent 是否调用 run_skill_script 执行 hello.cjs
4. SSE 流式输出是否正常

- [ ] **Step 3: 验证中断恢复**

在已有会话中触发积分不足 interrupt → 充值 → resume，确认 Skills 中间件不影响恢复流程。

- [ ] **Step 4: 清理测试 Skill（可选保留作为示范）**

```bash
rm -rf .deepagents/skills/hello-world
```

- [ ] **Step 5: 运行全量测试**

```bash
npx vitest run --reporter=verbose
```
Expected: 全部 PASS

- [ ] **Step 6: 提交验证结果**

```bash
git add -A
git commit -m "test: 验证 Skills 集成端到端功能"
```
