# 接入 Agent Skills 生态实施计划（更新版）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 createAgent 架构上接入 Agent Skills 开放标准，通过 createSkillsMiddleware + 4 个自定义工具实现 Skill 发现、读取、写入、脚本执行和文件下载全链路。

**Architecture:** 现有 createAgent 代码零改动。追加 createSkillsMiddleware 到 middleware 数组末尾，追加 4 个 skill 工具到 tools 数组。per-session workspace 提供文件读写隔离，输出文件通过 OSS 返回给用户。

**Tech Stack:** deepagents（createSkillsMiddleware, FilesystemBackend）、langchain createAgent、@langchain/core/tools、Node.js child_process/fs、阿里云 OSS

**Spec:** `docs/superpowers/specs/2026-04-13-createagent-to-deepagent-migration-design.md`

---

## 已完成工作

以下 Task 已在前序实施中完成：

- [x] 安装 deepagents + langsmith 依赖
- [x] 创建 `.deepagents/skills/` 目录
- [x] 实现 `readSkillFile.tool.ts`（基础版，需更新支持 _workspace）
- [x] 实现 `runSkillScript.tool.ts`（基础版，需更新支持 _workspace + NODE_PATH）
- [x] 注册 read_skill_file + run_skill_script 到 tools/index.ts
- [x] 添加 SKILLS_DISCOVERY 中间件优先级常量
- [x] caseMainAgent.ts 集成 skillsMiddleware + 2 个工具
- [x] moduleAgent.ts 集成 skillsMiddleware + 2 个工具
- [x] Dockerfile 安装 python3 + COPY .deepagents
- [x] .dockerignore 添加 !.deepagents/**/*.md

## 待完成 Task 清单

| Task | 内容 | 依赖 |
|------|------|------|
| 1 | 更新 readSkillFile：支持 _workspace/ 前缀 + sessionId 校验 + 扩展名白名单 | 无 |
| 2 | 更新 runSkillScript：支持 _workspace + NODE_PATH + sessionId 校验 | 无 |
| 3 | 新建 writeSkillFile 工具 | 无 |
| 4 | 新建 uploadWorkspaceFile 工具 | 无 |
| 5 | 注册 write_skill_file + upload_workspace_file 到工具注册表 | 3, 4 |
| 6 | 更新 caseMainAgent + moduleAgent 追加 2 个新工具 | 5 |
| 7 | 添加 workspace 清理定时任务 | 无 |
| 8 | 端到端验证 | 1-7 |

---

### Task 1: 更新 readSkillFile 支持 _workspace

**Files:**
- Modify: `server/services/workflow/tools/readSkillFile.tool.ts`
- Modify: `tests/server/workflow/tools/readSkillFile.test.ts`

- [ ] **Step 1: 写新增测试用例**

在 `readSkillFile.test.ts` 中增加 workspace 相关测试：

```typescript
describe('read_skill_file 工具 - workspace 读取', () => {
    const workspaceDir = resolve(tmpdir(), 'lexseek-test-workspace-' + Date.now())

    beforeAll(async () => {
        await mkdir(workspaceDir, { recursive: true })
        await writeFile(resolve(workspaceDir, 'output.log'), '脚本执行成功')
        await writeFile(resolve(workspaceDir, 'result.pptx'), 'binary-content')
    })

    afterAll(async () => {
        await rm(workspaceDir, { recursive: true, force: true })
    })

    it('应能通过 _workspace/ 前缀读取文本文件', async () => {
        // createTool 需要新增 workspaceBase 参数
        const readTool = createTool(
            { ...testContext, sessionId: 'test-session' },
            testSkillsDir,
            resolve(tmpdir()),  // workspaceBase，workspace = workspaceBase/sessionId
        )
        // 但 workspaceDir 需要是 workspaceBase/sessionId
        // 所以 workspaceBase = workspaceDir 的父目录，sessionId = 目录名
        // 简化：让测试用 sessionId 匹配临时目录名
    })

    it('应拒绝 _workspace/ 中的二进制文件', async () => {
        // _workspace/result.pptx 应被扩展名白名单拦截
    })
})
```

**注意**：`createTool` 签名需要扩展为 `createTool(context, skillsRoot?, workspaceBase?)`，以便测试可以覆盖 workspace 路径。

- [ ] **Step 2: 运行测试确认新用例失败**

```bash
npx vitest run tests/server/workflow/tools/readSkillFile.test.ts --reporter=verbose
```

- [ ] **Step 3: 更新实现**

修改 `readSkillFile.tool.ts`，参照 spec 文档第 369-442 行：
- 导入 `SESSION_ID_PATTERN`（或内联定义 `/^[a-zA-Z0-9_-]{1,128}$/`）
- `createTool` 增加 `workspaceBase?: string` 参数
- 添加 sessionId 校验
- 添加 `_workspace/` 前缀分支：从 workspace 目录读取
- 两个分支共用扩展名白名单（`ALLOWED_EXTENSIONS`）
- 二进制文件提示"请使用 upload_workspace_file 处理"

- [ ] **Step 4: 运行测试确认全部通过**

```bash
npx vitest run tests/server/workflow/tools/readSkillFile.test.ts --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/readSkillFile.tool.ts tests/server/workflow/tools/readSkillFile.test.ts
git commit -m "feat(tools): readSkillFile 支持 _workspace/ 前缀读取 workspace 文件"
```

---

### Task 2: 更新 runSkillScript 支持 _workspace + NODE_PATH

**Files:**
- Modify: `server/services/workflow/tools/runSkillScript.tool.ts`
- Modify: `tests/server/workflow/tools/runSkillScript.test.ts`

- [ ] **Step 1: 写新增测试用例**

```typescript
describe('run_skill_script 工具 - workspace 执行', () => {
    it('应能执行 workspace 中的脚本（skillName="_workspace"）', async () => {
        // beforeAll 中在 workspace 临时目录写入一个测试脚本
        // 调用 runTool.invoke({ skillName: '_workspace', scriptName: 'test.cjs', action: 'run' })
    })

    it('workspace 中不存在的脚本应报错', async () => {
        // skillName="_workspace", scriptName="nonexistent.cjs"
    })
})
```

- [ ] **Step 2: 运行测试确认新用例失败**

- [ ] **Step 3: 更新实现**

修改 `runSkillScript.tool.ts`，参照 spec 文档第 548-622 行：
- 添加 `SESSION_ID_PATTERN` 校验
- 添加 `_workspace` 分支：从 workspace 目录执行脚本
- `env.NODE_PATH` 改为 `resolve(process.cwd(), 'node_modules')`（非空串）
- `env` 添加 `WORKSPACE_DIR` 环境变量
- `createTool` 签名不变（`skillsRoot?` 已有），workspace 路径由 sessionId 推导

- [ ] **Step 4: 运行测试确认全部通过**

```bash
npx vitest run tests/server/workflow/tools/runSkillScript.test.ts --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/runSkillScript.tool.ts tests/server/workflow/tools/runSkillScript.test.ts
git commit -m "feat(tools): runSkillScript 支持 _workspace 执行和 NODE_PATH"
```

---

### Task 3: 新建 writeSkillFile 工具

**Files:**
- Create: `server/services/workflow/tools/writeSkillFile.tool.ts`
- Create: `tests/server/workflow/tools/writeSkillFile.test.ts`

- [ ] **Step 1: 写测试**

测试用例：
1. 应能写入文件到 workspace
2. 应能写入子目录文件（自动创建目录）
3. 应覆盖已存在的文件
4. 应拒绝路径遍历（`..`）
5. 应拒绝绝对路径（`/`）
6. 应拒绝包含 NULL 字节的路径
7. 应拒绝超大内容（> 10MB 由 zod 限制，但可测试边界）
8. 工具名和描述正确

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

参照 spec 文档第 459-508 行实现，要点：
- `SESSION_ID_PATTERN` 校验
- `SAFE_PATH_SEGMENT` 正则 `/^[\w.\-\u4e00-\u9fff]+$/` 校验每段路径
- `content` schema `.max(10 * 1024 * 1024)`
- NULL 字节检查 `filePath.includes('\0')`
- `mkdir({ recursive: true })` + `writeFile` 覆盖语义
- 返回完整路径供 Agent 确认

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/writeSkillFile.tool.ts tests/server/workflow/tools/writeSkillFile.test.ts
git commit -m "feat(tools): 实现 write_skill_file 工具（per-session workspace 写入）"
```

---

### Task 4: 新建 uploadWorkspaceFile 工具

**Files:**
- Create: `server/services/workflow/tools/uploadWorkspaceFile.tool.ts`
- Create: `tests/server/workflow/tools/uploadWorkspaceFile.test.ts`

- [ ] **Step 1: 写测试**

测试用例：
1. 应能上传文件并返回 [file-card] 格式
2. 应拒绝不存在的文件
3. 应拒绝文件名含路径遍历字符
4. 应拒绝超大文件（> 50MB）
5. 配额不足时应返回 temporary: true 的临时卡片
6. 工具名和描述正确

**注意**：上传和配额检查涉及 OSS 和数据库，测试中需要 mock `uploadUserFileService` 和 `uploadTempFileService`。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

参照 spec 文档第 113-183 行和第 223-290 行实现，要点：
- `SESSION_ID_PATTERN` 校验
- `stat.size > 50MB` 检查
- NULL 字节检查
- 正常流程：`uploadUserFileService` → 返回永久 file-card
- 配额不足：`isQuotaExceededError` → `uploadTempFileService` → 返回临时 file-card（`temporary: true`, `expiresAt`）
- `[file-card]...[/file-card]` 格式输出

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/tools/uploadWorkspaceFile.tool.ts tests/server/workflow/tools/uploadWorkspaceFile.test.ts
git commit -m "feat(tools): 实现 upload_workspace_file 工具（OSS 上传 + 配额兜底）"
```

---

### Task 5: 注册新工具到工具注册表

**Files:**
- Modify: `server/services/workflow/tools/index.ts`

- [ ] **Step 1: 添加 import 和注册**

```typescript
import * as writeSkillFileTool from './writeSkillFile.tool'
import * as uploadWorkspaceFileTool from './uploadWorkspaceFile.tool'

// 在 toolModules 中添加：
    write_skill_file: writeSkillFileTool,
    upload_workspace_file: uploadWorkspaceFileTool,
```

- [ ] **Step 2: 运行工具注册表测试**

```bash
npx vitest run tests/server/workflow/tools/index.test.ts --reporter=verbose
```

- [ ] **Step 3: 提交**

```bash
git add server/services/workflow/tools/index.ts
git commit -m "feat(tools): 注册 write_skill_file 和 upload_workspace_file"
```

---

### Task 6: 更新 Agent 集成（追加 2 个新工具）

**Files:**
- Modify: `server/services/workflow/agents/caseMainAgent.ts`
- Modify: `server/services/workflow/agents/moduleAgent.ts`

- [ ] **Step 1: caseMainAgent 追加新工具 import 和实例化**

```typescript
// 新增 import
import { createTool as createWriteSkillFileTool } from '../tools/writeSkillFile.tool'
import { createTool as createUploadWorkspaceFileTool } from '../tools/uploadWorkspaceFile.tool'

// skillTools 数组从 2 个扩展为 4 个
const skillTools = [
    createReadSkillFileTool(toolContext),
    createWriteSkillFileTool(toolContext),
    createRunSkillScriptTool(toolContext),
    createUploadWorkspaceFileTool(toolContext),
]
```

- [ ] **Step 2: moduleAgent 同样追加**

- [ ] **Step 3: 更新 caseMainAgent.test.ts 工具数量断言**

```typescript
// 主代理工具 2 个 + 子代理工具 2 个 + Skills 工具 4 个 = 8 个
expect(createAgentCall.tools).toHaveLength(8)
```

- [ ] **Step 4: 类型检查**

```bash
npx nuxi typecheck 2>&1 | tail -5
```

- [ ] **Step 5: 运行相关测试**

```bash
npx vitest run tests/server/workflow/agents/ tests/server/workflow/tools/ --reporter=verbose
```

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/agents/ tests/server/workflow/agents/
git commit -m "feat(agents): 集成 write_skill_file 和 upload_workspace_file 到小索和模块对话"
```

---

### Task 7: workspace 清理定时任务

**Files:**
- Modify: `server/plugins/cron-scheduler.ts`（或新建清理模块）

- [ ] **Step 1: 实现清理逻辑**

在定时任务中增加：扫描 `/tmp/skills-workspace/` 子目录，删除 `mtime > 24h` 的目录。

```typescript
import { readdir, stat, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const WORKSPACE_BASE = '/tmp/skills-workspace'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 小时

async function cleanExpiredWorkspaces() {
    try {
        const entries = await readdir(WORKSPACE_BASE, { withFileTypes: true })
        const now = Date.now()
        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const dirPath = resolve(WORKSPACE_BASE, entry.name)
            const dirStat = await stat(dirPath)
            if (now - dirStat.mtimeMs > MAX_AGE_MS) {
                await rm(dirPath, { recursive: true, force: true })
                logger.info('清理过期 workspace', { dir: entry.name })
            }
        }
    } catch (err) {
        // WORKSPACE_BASE 不存在时跳过（正常情况）
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger.warn('workspace 清理失败', { error: err })
        }
    }
}
```

定时周期：每小时执行一次。

- [ ] **Step 2: 提交**

```bash
git add server/plugins/cron-scheduler.ts
git commit -m "chore: 添加 workspace 清理定时任务（24h 过期）"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 创建测试 Skill（含脚本）**

```bash
mkdir -p .deepagents/skills/hello-world/scripts
cat > .deepagents/skills/hello-world/SKILL.md << 'EOF'
---
name: hello-world
description: 验证 Skills 全链路的测试技能。
---

# Hello World

运行 `scripts/hello.cjs generate` 生成测试文件。
EOF

cat > .deepagents/skills/hello-world/scripts/hello.cjs << 'EOF'
const fs = require('fs')
const path = require('path')
const action = process.argv[2]
const ws = process.env.WORKSPACE_DIR || '.'
if (action === 'generate') {
    const outPath = path.join(ws, 'hello-output.txt')
    fs.writeFileSync(outPath, 'Hello from Skills!')
    console.log(JSON.stringify({ success: true, output: outPath }))
} else {
    console.log(JSON.stringify({ action, ok: true }))
}
EOF
```

- [ ] **Step 2: 运行全量工具测试**

```bash
npx vitest run tests/server/workflow/tools/ --reporter=verbose
```

- [ ] **Step 3: 运行全量 Agent 测试**

```bash
npx vitest run tests/server/workflow/agents/ --reporter=verbose
```

- [ ] **Step 4: 启动开发服务器手动验证全链路**

```bash
bun dev
```

通过小索对话测试：
1. Skill 发现 → Agent 识别 hello-world skill
2. read_skill_file → 读取 SKILL.md
3. write_skill_file → 创建 workspace 脚本（可选）
4. run_skill_script → 执行 hello.cjs generate
5. read_skill_file `_workspace/hello-output.txt` → 确认输出
6. upload_workspace_file → 上传到用户云盘（如有 OSS 配置）

- [ ] **Step 5: 清理测试 Skill + 提交**

```bash
rm -rf .deepagents/skills/hello-world
git add -A
git commit -m "test: 验证 Skills 全链路（4 工具 + workspace + 文件下载）"
```
