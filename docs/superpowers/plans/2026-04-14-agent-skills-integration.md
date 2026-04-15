# 接入 Agent Skills 生态实施计划（更新版）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 createAgent 架构上接入 Agent Skills 开放标准，通过 createSkillsMiddleware + 4 个自定义工具实现 Skill 发现、读取、写入、脚本执行和文件上传全链路。

**Architecture:** 现有 createAgent 代码零改动。追加 createSkillsMiddleware 到 middleware 数组末尾，追加 4 个 skill 工具到 tools 数组。per-session workspace 提供文件读写隔离。

**Tech Stack:** deepagents（createSkillsMiddleware, FilesystemBackend）、langchain createAgent、@langchain/core/tools、Node.js child_process/fs、阿里云 OSS

**Spec:** `docs/superpowers/specs/2026-04-13-createagent-to-deepagent-migration-design.md`

---

## 已完成工作

- [x] 安装 deepagents + langsmith 依赖
- [x] 创建 `.deepagents/skills/` 目录
- [x] 实现 `readSkillFile.tool.ts`（基础版）
- [x] 实现 `runSkillScript.tool.ts`（基础版）
- [x] 注册 read_skill_file + run_skill_script 到 tools/index.ts
- [x] 添加 SKILLS_DISCOVERY 中间件优先级常量
- [x] caseMainAgent.ts 集成 skillsMiddleware + 2 个工具
- [x] moduleAgent.ts 集成 skillsMiddleware + 2 个工具
- [x] Dockerfile 安装 python3 + COPY .deepagents
- [x] .dockerignore 添加 !.deepagents/**/*.md

## 设计决策（基于 review 反馈）

1. **workspace 路径从 sessionId 内部推导**：不给 `createTool` 增加第三个参数，而是在工具内部用 `WORKSPACE_BASE + context.sessionId` 推导。测试时通过覆盖 `WORKSPACE_BASE` 常量或使用特定 sessionId 对齐临时目录。
2. **配额兜底逻辑延后到二期**：第一版 `upload_workspace_file` 直接调用现有 OSS 服务上传，上传失败返回错误。临时文件区域、`save-temp` API、前端 `temporary` 卡片解析等配额兜底机制在二期实现。
3. **沿用已实现代码的模式**：`existsSync` 预检查不采用（已实现版本通过 execFile 错误码判断更准确），扩展名检查统一用 `extname()`，`ALLOWED_EXTENSIONS` 保持模块级常量。
4. **workspace 清理定时任务延后**：Docker 容器重启时 `/tmp` 自动清理，第一版不会有积累。正式上线后再添加。

## 待完成 Task 清单

| Task | 内容 | 依赖 |
|------|------|------|
| 1 | 更新 readSkillFile：支持 _workspace/ 前缀 + sessionId 校验 | 无 |
| 2 | 更新 runSkillScript：支持 _workspace + NODE_PATH | 无 |
| 3 | 新建 writeSkillFile 工具 | 无 |
| 4 | 新建 uploadWorkspaceFile 工具（简化版，无配额兜底） | 无 |
| 5 | 注册新工具 + 更新 Agent 集成 + 更新测试断言 | 3, 4 |
| 6 | 端到端验证 | 1-5 |

---

### Task 1: 更新 readSkillFile 支持 _workspace

**Files:**
- Modify: `server/services/workflow/tools/readSkillFile.tool.ts`
- Modify: `tests/server/workflow/tools/readSkillFile.test.ts`

- [ ] **Step 1: 写新增测试用例**

在现有测试文件中增加 workspace 相关 describe：

```typescript
describe('read_skill_file 工具 - workspace 读取', () => {
    // 创建临时 workspace 目录，sessionId 对应目录名
    // 测试 _workspace/output.log 路径能正确读取
    // 测试 _workspace/result.pptx 被扩展名白名单拦截
    // 测试 _workspace 目录不存在时返回文件不存在
})
```

关键：`createTool` 签名**不变**（`context, skillsRoot?`），workspace 路径从 `context.sessionId` 推导。测试时设置 `context.sessionId` 为临时目录名，确保 `WORKSPACE_BASE/sessionId` 指向测试目录。

- [ ] **Step 2: 运行测试确认新用例失败**

```bash
npx vitest run tests/server/workflow/tools/readSkillFile.test.ts --reporter=verbose
```

- [ ] **Step 3: 更新实现**

在 `readSkillFile.tool.ts` 中：
- 添加 `SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/` 校验
- 添加 `WORKSPACE_BASE = '/tmp/skills-workspace'`
- `createTool` 内部推导 `workspaceDir = resolve(WORKSPACE_BASE, context.sessionId)`
- 添加 `_workspace/` 前缀分支：从 workspace 目录读取
- 两个分支共用 `ALLOWED_EXTENSIONS`（已有模块级常量，增加 `.log`）
- 拒绝 workspace 中的二进制文件时提示"请使用 upload_workspace_file"
- `schema.path` 加 `.min(1)`

- [ ] **Step 4: 运行测试确认全部通过**

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(tools): readSkillFile 支持 _workspace/ 前缀读取"
```

---

### Task 2: 更新 runSkillScript 支持 _workspace + NODE_PATH

**Files:**
- Modify: `server/services/workflow/tools/runSkillScript.tool.ts`
- Modify: `tests/server/workflow/tools/runSkillScript.test.ts`

- [ ] **Step 1: 写新增测试用例**

```typescript
describe('run_skill_script 工具 - workspace 执行', () => {
    // beforeAll 在临时 workspace 目录创建测试脚本
    // 测试 skillName="_workspace" 能执行 workspace 中的脚本
    // 测试 workspace 不存在的脚本报错
    // 测试 WORKSPACE_DIR 环境变量被正确传入
})
```

- [ ] **Step 2: 运行测试确认新用例失败**

- [ ] **Step 3: 更新实现**

在 `runSkillScript.tool.ts` 中：
- 添加 `SESSION_ID_PATTERN` 校验
- 添加 `WORKSPACE_BASE` 和 `workspaceDir` 推导
- 添加 `_workspace` 分支：从 workspace 目录执行
- `env.NODE_PATH` 改为 `resolve(process.cwd(), 'node_modules')`
- `env` 添加 `WORKSPACE_DIR` 变量
- 沿用已实现的 execFile 错误捕获模式（不用 existsSync），_workspace 分支也一样

- [ ] **Step 4: 运行测试确认全部通过**

- [ ] **Step 5: 提交**

```bash
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
6. 应拒绝 NULL 字节路径
7. 应拒绝路径段含非法字符
8. 工具名和描述正确

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现**

参照 spec 文档：
- `SESSION_ID_PATTERN` 校验
- `SAFE_PATH_SEGMENT = /^[\w.\-\u4e00-\u9fff]+$/` 校验每段路径
- `content` schema `.max(10 * 1024 * 1024)`
- `path` schema `.min(1)`
- NULL 字节和 `\0` 检查
- `mkdir({ recursive: true })` + `writeFile` 覆盖语义
- 返回 `文件已写入: ${fullPath}`

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(tools): 实现 write_skill_file 工具"
```

---

### Task 4: 新建 uploadWorkspaceFile 工具（简化版）

**Files:**
- Create: `server/services/workflow/tools/uploadWorkspaceFile.tool.ts`
- Create: `tests/server/workflow/tools/uploadWorkspaceFile.test.ts`

**第一版简化**：直接调用现有 OSS 服务上传，上传失败返回错误。不实现配额兜底（二期）。

- [ ] **Step 1: 调研现有上传服务**

读取以下文件确认可复用的上传 API：
- `server/services/storage/storage.service.ts`
- `server/lib/oss/upload.ts`
- `server/services/files/` 目录（如有）

确定：如何上传本地文件到用户 OSS 目录、如何创建 files 表记录、如何获取 mimeType。

- [ ] **Step 2: 写测试**

测试用例（mock OSS 上传）：
1. 应返回 [file-card] 格式
2. 应拒绝不存在的文件
3. 应拒绝文件名含非法字符
4. 应拒绝超大文件（> 50MB）
5. 上传失败时返回错误信息
6. 工具名和描述正确

- [ ] **Step 3: 运行测试确认失败**

- [ ] **Step 4: 实现**

要点：
- `SESSION_ID_PATTERN` 校验
- `stat.size > 50 * 1024 * 1024` 检查
- 基于现有 storage/oss 服务封装上传逻辑
- 推断 mimeType（基于扩展名，使用 `mime-types` 包或简单映射表）
- 输出 `[file-card]...[/file-card]` 格式
- 上传失败直接返回错误（无配额兜底，第一版）

- [ ] **Step 5: 运行测试确认通过**

- [ ] **Step 6: 提交**

```bash
git commit -m "feat(tools): 实现 upload_workspace_file 工具（简化版）"
```

---

### Task 5: 注册新工具 + 更新 Agent 集成

**Files:**
- Modify: `server/services/workflow/tools/index.ts`
- Modify: `server/services/workflow/agents/caseMainAgent.ts`
- Modify: `server/services/workflow/agents/moduleAgent.ts`
- Modify: `tests/server/workflow/agents/caseMainAgent.test.ts`

- [ ] **Step 1: 注册到 tools/index.ts**

```typescript
import * as writeSkillFileTool from './writeSkillFile.tool'
import * as uploadWorkspaceFileTool from './uploadWorkspaceFile.tool'

// toolModules 中添加：
    write_skill_file: writeSkillFileTool,
    upload_workspace_file: uploadWorkspaceFileTool,
```

- [ ] **Step 2: caseMainAgent + moduleAgent 追加 2 个新工具**

```typescript
import { createTool as createWriteSkillFileTool } from '../tools/writeSkillFile.tool'
import { createTool as createUploadWorkspaceFileTool } from '../tools/uploadWorkspaceFile.tool'

const skillTools = [
    createReadSkillFileTool(toolContext),
    createWriteSkillFileTool(toolContext),
    createRunSkillScriptTool(toolContext),
    createUploadWorkspaceFileTool(toolContext),
]
```

- [ ] **Step 3: 更新 caseMainAgent.test.ts 工具数量**

```typescript
// 主代理工具 2 个 + 子代理工具 2 个 + Skills 工具 4 个 = 8 个
expect(createAgentCall.tools).toHaveLength(8)
```

注：moduleAgent 目前无对应测试文件，工具数量断言暂不补充（标记 TODO）。

- [ ] **Step 4: 类型检查 + 测试**

```bash
npx nuxi typecheck 2>&1 | tail -5
npx vitest run tests/server/workflow/ --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(agents): 集成 write_skill_file 和 upload_workspace_file"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 创建测试 Skill**

```bash
mkdir -p .deepagents/skills/hello-world/scripts
# 创建 SKILL.md 和 hello.cjs（输出文件到 WORKSPACE_DIR）
```

- [ ] **Step 2: 运行全量工具 + Agent 测试**

```bash
npx vitest run tests/server/workflow/ --reporter=verbose
```

- [ ] **Step 3: 手动验证全链路（bun dev）**

1. Skill 发现 → Agent 识别 hello-world
2. read_skill_file → 读取 SKILL.md
3. write_skill_file → 创建 workspace 脚本
4. run_skill_script(_workspace) → 执行脚本
5. read_skill_file(_workspace) → 确认输出
6. upload_workspace_file → 上传到用户云盘
7. 文件卡片在对话中正确渲染

- [ ] **Step 4: 清理 + 提交**

```bash
rm -rf .deepagents/skills/hello-world
git commit -m "test: 验证 Skills 全链路"
```

---

## 二期待办（本次不实施）

- [ ] 配额兜底：临时文件区域 + uploadTempFileService + save-temp API + 前端 temporary 卡片
- [ ] workspace 清理定时任务（cron-scheduler.ts）
- [ ] OSS Lifecycle Rule 配置（skills-temp/ 前缀 1 天过期）
- [ ] 每用户每天临时存储上限
- [ ] moduleAgent 补充独立测试文件
