# Docker 构建 OOM 止血（P0）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `nuxt.config.ts` 的 `vite.build` 中关闭 `reportCompressedSize`，消除云效流水线 `RUN bun nuxt build` 阶段在 `computing gzip size...` 步骤被 SIGKILL 的问题。

**Architecture:** 单点最小改动 — 一行 vite 构建配置。其余诊断到的次要问题（logger 客户端污染、客户端依赖懒加载等）按 spec 第 4 节升级路径处理，本期不动。

**Tech Stack:** Nuxt 4 + Vite + Bun + Docker buildx + 阿里云云效流水线

**Reference Spec:** `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md`

---

## 工作区前置约束

⚠️ **当前工作区已有 23 个未提交修改文件**（属于其他在进行的工作）。这会带来两个隐患，必须照顾：

### 隐患 1：commit 范围污染

本计划所有 commit **必须精确 `git add` 仅与本任务相关的文件**，禁止使用 `git add -A` / `git add .`。每次 commit 前用 `git status --short` 确认 staged 列表只含预期文件。

### 隐患 2：构建验证被无关修改干扰

`bun nuxt build` 与 `docker build` 都会受 23 个未提交修改文件影响（前者直接读工作区源码，后者通过 `COPY . .` 全量拷贝）。如果其中某个未提交文件本身有语法/类型错误，会导致构建失败但**与本期 P0 无关**。

**应对策略**（按推荐度从高到低）：

| 选项 | 做法 | 适用场景 |
|---|---|---|
| **A（推荐）** | 在 Task 2/3 验证前先 `git stash push -u --keep-index -m "p0-isolate"`（保留已 staged 的 nuxt.config.ts，把其他工作存档），验证完后 `git stash pop` 恢复 | 干净验证 P0 改动是否独立有效 |
| **B** | 把这 23 个修改先在另一分支自洽 commit 掉，再回到 P0 分支 | 其他工作已接近收尾 |
| **C** | 跳过本地验证，直接推流水线（依赖云效兜底） | 本地 docker build 跑不动 / 时间紧 |

> ⚠️ 在 stash 操作前请用 `git stash list` 确认现有 stash 数量，避免误 pop 错栈。

### 本计划涉及的文件

- `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md`（已存在，untracked）
- `docs/superpowers/plans/2026-04-29-docker-build-oom-fix.md`（本文件，untracked）
- `nuxt.config.ts`（待修改）

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md` | 决策与诊断记录 | 新增（已写完） |
| `docs/superpowers/plans/2026-04-29-docker-build-oom-fix.md` | 实施步骤记录 | 新增（本文件） |
| `nuxt.config.ts` | Nuxt 全局构建配置 | 修改 1 处：在 `vite` 块新增 `build.reportCompressedSize: false` |

---

## Task 1: 提交 spec 与 plan 文档

**Files:**
- Create (already exist): `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md`
- Create (already exist): `docs/superpowers/plans/2026-04-29-docker-build-oom-fix.md`

- [ ] **Step 1: 确认两个文档文件均已存在且内容完整**

Run:
```bash
ls -la docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md \
       docs/superpowers/plans/2026-04-29-docker-build-oom-fix.md
wc -l docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md \
      docs/superpowers/plans/2026-04-29-docker-build-oom-fix.md
```

Expected: 两个文件都存在，且行数 > 50。

- [ ] **Step 2: 仅暂存这两个文档文件**

Run:
```bash
git add docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md \
        docs/superpowers/plans/2026-04-29-docker-build-oom-fix.md
git status --short
```

Expected: 输出里 `A` 标记**只有**这两个 .md 文件，其他 `M` 文件保持 unstaged。

- [ ] **Step 3: Commit 文档**

Run:
```bash
git commit -m "docs(infra): 增加 docker 构建 OOM 止血方案 spec 与 plan

记录云效流水线 RUN bun nuxt build 阶段被 SIGKILL（exit code 137）的诊断与
最小改动止血方案。范围限定为关闭 vite reportCompressedSize，其余优化按升级
路径推进。"
```

Expected: commit 成功创建，pre-commit hook 通过。如果 hook 失败，按提示修复后**新建 commit**（不要用 --amend）。

---

## Task 2: 修改 `nuxt.config.ts` 增加 `reportCompressedSize: false`

**Files:**
- Modify: `nuxt.config.ts:67-88` (现有 `vite` 块)

### 当前 `vite` 块的实际内容（不要改其他字段）

```ts
vite: {
  resolve: {
    alias: {
      '@repo/shadcn-vue/lib': resolve(__dirname, 'app/lib'),
      '@repo/shadcn-vue/components/ui': resolve(__dirname, 'app/components/ui'),
    },
  },
  plugins: [
    tailwindcss() as any,
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['age-encryption'],
  },
  server: {
    allowedHosts: true
  }
},
```

### 改完后的目标内容

```ts
vite: {
  resolve: {
    alias: {
      '@repo/shadcn-vue/lib': resolve(__dirname, 'app/lib'),
      '@repo/shadcn-vue/components/ui': resolve(__dirname, 'app/components/ui'),
    },
  },
  plugins: [
    tailwindcss() as any,
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['age-encryption'],
  },
  server: {
    allowedHosts: true
  },
  build: {
    // 关闭 chunk gzip size 计算 — 在 9968 modules 规模下是 vite 构建末尾的内存峰值，
    // 云效流水线 16G 实例都会被 cgroup OOM Killer 杀掉（exit code 137）
    reportCompressedSize: false,
  },
},
```

> 注意 `server: { allowedHosts: true }` 后**新增逗号**，再加 `build` 字段。

- [ ] **Step 1: 用 Edit 工具完成修改**

精确用以下 old_string / new_string 替换：

old_string:
```
    server: {
      allowedHosts: true
    }
  },
```

new_string:
```
    server: {
      allowedHosts: true
    },
    build: {
      // 关闭 chunk gzip size 计算 — 在 9968 modules 规模下是 vite 构建末尾的内存峰值，
      // 云效流水线 16G 实例都会被 cgroup OOM Killer 杀掉（exit code 137）
      reportCompressedSize: false,
    },
  },
```

- [ ] **Step 2: 验证类型检查通过**

Run:
```bash
bun run typecheck 2>&1 | tail -30
```

Expected: 没有与 `nuxt.config.ts` 相关的报错。如果有，回到 Step 1 检查语法（特别是新增逗号）。

> 注意 typecheck 可能因仓库其他在进行的修改产生与本任务无关的类型错误，**只关注 `nuxt.config.ts` 这一文件名相关的报错**。

- [ ] **Step 3: 验证配置确实生效（非破坏性 dry run）**

Run:
```bash
NODE_OPTIONS=--max-old-space-size=8192 bun nuxt build 2>&1 | tee /tmp/lexseek-build.log | tail -40
```

Expected:
- 构建走完，最后一行输出类似 `✔ You can preview this build using ...` 或退到 shell 提示符
- `tail -40 /tmp/lexseek-build.log` 中**不应再出现** `computing gzip size...` 这一行
- `grep "computing gzip" /tmp/lexseek-build.log` 应返回空

如果本地构建通过 → P0 已经在最危险的那一步上消除了内存峰值，可以进入 Task 3 进一步用 docker 内存约束模拟。
如果本地构建仍 OOM → 立刻停止，按 spec 第 4.1 节转 P1。

- [ ] **Step 4: 暂存并 Commit**

Run:
```bash
git add nuxt.config.ts
git status --short
```

Expected: 输出里 `M` 标记的 staged 文件**只有** `nuxt.config.ts`。

```bash
git commit -m "fix(infra): 关闭 vite reportCompressedSize 缓解云效构建 OOM

云效流水线 RUN bun nuxt build 在 'computing gzip size...' 阶段被 cgroup OOM
Killer 杀掉（exit code 137），9968 modules 规模下 16G 实例同样不够。关闭该
报告项即可消除该阶段的内存峰值。

详见 docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md"
```

Expected: commit 成功。

---

## Task 3: 本地 Docker 8G 内存约束模拟验证

**Files:** 无需新增/修改文件，仅运行命令。

**Goal:** 在本机用与云效相同的内存约束跑完整 Docker 构建，确保 P0 改动在受限内存下也能走完 `bun nuxt build`。

- [ ] **Step 1: 检查 Docker 桌面是否分配了至少 9G（含 1G 缓冲）**

Run:
```bash
docker info --format '{{.MemTotal}}' | awk '{printf "Docker MemTotal: %.2f GB\n", $1/1024/1024/1024}'
```

Expected: 输出 ≥ 9.00 GB。如果不足，请到 Docker Desktop → Settings → Resources 调高后再继续。

- [ ] **Step 2: 用 8G 内存上限触发完整 docker build**

Run:
```bash
docker build \
  --memory=8g \
  --memory-swap=8g \
  --progress=plain \
  -t lexseek-oom-test:p0 \
  . 2>&1 | tee /tmp/lexseek-docker-build.log
```

Expected: 构建跑到最后输出 `Successfully tagged lexseek-oom-test:p0` 或 buildkit 风格的 `DONE` 行，**不出现** `Killed` / `exit code: 137` / `did not complete successfully`。

> 此步骤耗时较长（视机器约 5-15 分钟）。Bash tool 默认 2 分钟 timeout，运行时**显式设置 timeout 至 900000 ms（15 分钟）**。

- [ ] **Step 3: 校验 build 日志里关键阶段都通过**

Run:
```bash
grep -E "modules transformed|rendering chunks|computing gzip|Killed|exit code" /tmp/lexseek-docker-build.log
```

Expected:
- ✅ 出现 `modules transformed`
- ✅ 出现 `rendering chunks...`
- ❌ **不出现** `computing gzip size`
- ❌ **不出现** `Killed`
- ❌ **不出现** `exit code: 137`

如果仍出现 `Killed` → 立刻停止，按 spec 第 4.1 节升级到 P1。

- [ ] **Step 4: 启动镜像并验证 /api/health**

Run（启动容器）：
```bash
docker run -d --rm --name lexseek-oom-test \
  -p 13000:3000 \
  -e DATABASE_URL="postgresql://localhost/dummy" \
  lexseek-oom-test:p0
sleep 8
```

Run（健康检查）：
```bash
curl -fsS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:13000/api/health || true
docker logs lexseek-oom-test 2>&1 | tail -20
```

Expected:
- HTTP 状态码为 200（**或** 5xx 但日志中显示是因为伪造的 DATABASE_URL 连不上 — 这种情况下接受为通过，只要进程没 crash、HTTP 服务器在响应）
- 容器仍在运行（`docker ps | grep lexseek-oom-test`）

Run（清理）：
```bash
docker stop lexseek-oom-test
```

- [ ] **Step 5: 清理本地测试镜像**

Run:
```bash
docker rmi lexseek-oom-test:p0
```

Expected: 镜像被移除，无报错。

> 本任务**无 commit**。仅用于本地验证；如果失败，回滚是简单的 `git revert HEAD`（仅 Task 2 的 commit）。

---

## Task 4: 推送触发云效流水线验证

**Files:** 无文件修改，仅 git push 与远端日志观察。

**Goal:** 在云效流水线（同样 16G 实例，且很可能仍是 buildkit cgroup 限制环境）触发一次构建，确认 P0 在真实环境通过。

- [ ] **Step 1: 推送当前 commit 到远端触发流水线**

Run:
```bash
git log --oneline -2
git push
```

Expected:
- `git log` 显示最上面是本计划 Task 2 的 commit `fix(infra): 关闭 vite reportCompressedSize ...`
- `git push` 成功

> ⚠️ 推送会触发云效流水线（前提是流水线 trigger 配置已恢复为 push 触发；当前 git log 显示 `2879bce1 chore(ci): trigger 改为 workflow_dispatch 暂停自动跑`，可能需要在云效控制台手动点"运行"）。

- [ ] **Step 2: 在云效流水线 UI 观察构建日志**

打开云效流水线（与日常一致的入口），等待对应 commit 的构建任务跑到 `[builder X/10] RUN bun nuxt build` 阶段。

记录以下关键事实，**全部满足才算通过**：

- [ ] 日志里**不再出现** `computing gzip size...` 这一行
- [ ] 日志里**不出现** `error: Failed to run "nuxt" due to signal SIGKILL`
- [ ] 日志里**不出现** `exit code: 137`
- [ ] `RUN bun nuxt build` 阶段成功结束，进入下一步 `RUN cd /app/.output/server/node_modules/ipx && bun add ofetch defu pathe ufo`
- [ ] 整个流水线最终 `success`，镜像被 push 到阿里云 ACR

如果上述任一不满足 → 立即停止，记录失败日志关键片段到 spec 文件第 7 节（下一步追加），按 spec 第 4.1 节转 P1。

- [ ] **Step 3: 在生产/预发拉取镜像并健康检查**

Run（在能访问 ACR 的环境）：
```bash
GIT_HASH=$(git rev-parse --short HEAD)
docker pull crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com/lexseek/lexseek:${GIT_HASH}
docker run -d --rm --name lexseek-prod-test \
  -p 13001:3000 \
  --env-file <真实 .env 路径> \
  crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com/lexseek/lexseek:${GIT_HASH}
sleep 10
curl -fsS http://localhost:13001/api/health
docker logs lexseek-prod-test --tail 30
docker stop lexseek-prod-test
```

Expected: `/api/health` 返回 200，`docker logs` 不含 unhandled error / startup crash。

> 此步骤需要真实环境变量与 ACR 拉取权限。如果当前环境不具备，**记录"待生产环境验证"** 并在跟进时补做。

- [ ] **Step 4: 在 spec 文件追加验收记录**

Edit `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md`，在文件末尾追加：

```markdown
## 7. 验收结果

- 验收日期: 2026-04-29（按实际填写）
- 云效流水线构建: ✅ 通过 / ❌ 失败（按实际填写，失败时附日志关键片段）
- 镜像启动 /api/health: ✅ 通过 / ⏸ 待生产验证（按实际填写）
- 本地 docker --memory=8g 模拟: ✅ 通过（Task 3）
- 后续：若全部通过，本期 P0 工作结束；若云效仍失败，转入 P1（spec 第 4.1 节）。
```

- [ ] **Step 5: Commit 验收结果**

Run:
```bash
git add docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md
git status --short
```

Expected: staged 文件**只有** spec 这一个 .md 文件。

```bash
git commit -m "docs(infra): 记录 docker 构建 OOM 止血 P0 验收结果"
git push
```

Expected: commit 成功并推送。

---

## 完成判据

全部 4 个 Task 走完，**满足以下三条**视为本计划完成：

1. `nuxt.config.ts` 已合入 `reportCompressedSize: false`
2. 云效流水线在该 commit 上构建成功，镜像 push 到 ACR
3. spec 文件第 7 节验收结果已记录并 commit

**任一失败** → 按 spec 第 4 节升级路径处理，本计划归档为"P0 不足"，另起 plan 推进 P1。
