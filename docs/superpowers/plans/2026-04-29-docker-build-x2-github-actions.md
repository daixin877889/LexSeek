# Docker 构建迁移到 GitHub Actions（X2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 GitHub Actions 公共 runner 跑 docker buildx，把镜像推到阿里云 ACR，绕开云效 16G 实例的内存上限；云效流水线保持现状作 fallback。

**Architecture:** 新增一个 `.github/workflows/build-image.yml`，复用 test.yml 的 buildx 经验，`workflow_dispatch` 手动触发，不动 Dockerfile 与云效。

**Tech Stack:** GitHub Actions / docker/buildx / docker/login-action / docker/build-push-action / 阿里云容器镜像服务 ACR

**Reference Spec:** `docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md`

---

## 工作区前置约束

⚠️ 当前工作区仍有 23+ 个其他未提交修改文件。所有 commit **必须精确 `git add` 仅与本任务相关的文件**，禁止 `git add -A` / `git add .`。

本计划涉及的文件：

- `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md`（已修改：追加 §7 §8 验收与转向记录）
- `docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md`（新增）
- `docs/superpowers/plans/2026-04-29-docker-build-x2-github-actions.md`（本文件，新增）
- `.github/workflows/build-image.yml`（新增）

---

## File Structure

| 文件 | 责任 | 改动类型 |
|---|---|---|
| `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md` | 老 spec 加验收章节，标记 P0/P0.5 不足并转 X2 | 修改（追加 §7 §8） |
| `docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md` | X2 方案 spec | 新增 |
| `docs/superpowers/plans/2026-04-29-docker-build-x2-github-actions.md` | 本计划 | 新增 |
| `.github/workflows/build-image.yml` | GHA 构建 workflow | 新增 |

---

## Task 1: 提交文档

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md`（已追加 §7 §8）
- Create: `docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md`（已写完）
- Create: `docs/superpowers/plans/2026-04-29-docker-build-x2-github-actions.md`（本文件）

- [ ] **Step 1: 确认三份文档已就绪**

Run:
```bash
git status --short docs/superpowers/
ls docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md \
   docs/superpowers/plans/2026-04-29-docker-build-x2-github-actions.md
```

Expected:
- 老 spec 状态为 `M`（modified）
- 新 spec 与 plan 文件存在且为 `??`（untracked）

- [ ] **Step 2: 暂存文档**

Run:
```bash
git add docs/superpowers/specs/2026-04-29-docker-build-oom-fix-design.md \
        docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md \
        docs/superpowers/plans/2026-04-29-docker-build-x2-github-actions.md
git status --short | grep -E "^[AM] docs/superpowers"
```

Expected: 输出三行，分别对应 `M ` 老 spec、`A ` 新 spec、`A ` plan。

- [ ] **Step 3: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
docs(infra): 归档 P0/P0.5 验收 + 增加 X2 方案 spec/plan

- 老 spec 追加 §7 验收结果（P0 局部有效但 P0.5 因客户端临界态无法验证）
- 老 spec 追加 §8 后续方向（转 X2：迁 GitHub Actions 构建）
- 新增 X2 方案 spec：GitHub Actions 跑 docker build 推 ACR，云效保持现状
- 新增对应 plan
EOF
)"
```

Expected: commit 成功创建。

---

## Task 2: 配置 GitHub Secrets（用户手动操作）

> ⚠️ 本任务**必须由用户在 GitHub UI 完成**，AI 无法代劳。

- [ ] **Step 1: 打开仓库 Secrets 页面**

浏览器访问：`https://github.com/daixin877889/LexSeek/settings/secrets/actions`

- [ ] **Step 2: 添加 `ALI_ACR_USERNAME`**

点 `New repository secret`：

- Name: `ALI_ACR_USERNAME`
- Value: `daixin@1857010335484493`（与 `scripts/build.sh:15` 中 `USERNAME` 变量一致）

- [ ] **Step 3: 添加 `ALI_ACR_PASSWORD`**

点 `New repository secret`：

- Name: `ALI_ACR_PASSWORD`
- Value: 阿里云 ACR 个人版的访问密码（与现有云效用的同一对凭证）

- [ ] **Step 4: 验证两个 secret 都出现在列表里**

刷新 secrets 页面，应该能看到 `ALI_ACR_USERNAME` 与 `ALI_ACR_PASSWORD` 两条记录（GitHub 不会显示值，只显示名称与添加时间）。

> 用户在 chat 里回复 "Secrets 配好了" 之后，AI 继续 Task 3。

---

## Task 3: 新增 `.github/workflows/build-image.yml`

**Files:**
- Create: `.github/workflows/build-image.yml`

- [ ] **Step 1: 写 workflow 文件**

完整内容（**字面照抄**）：

```yaml
name: Build Image

# 触发条件：仅手动触发（GitHub Actions 页面按 Run workflow 按钮）
# 与现有 test.yml 风格一致，避免误触发
on:
  workflow_dispatch:

env:
  REGISTRY: crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com
  IMAGE_REPO: lexseek/lexseek

jobs:
  build:
    name: Build & push docker image to Aliyun ACR
    runs-on: ubuntu-latest
    # 单次构建预计 8-15 分钟，给 30 分钟兜底
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          # 默认 fetch-depth=1，但 git rev-parse --short HEAD 在 shallow 上是 OK 的
          # 这里显式 1 让构建上下文最小
          fetch-depth: 1

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Aliyun ACR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.ALI_ACR_USERNAME }}
          password: ${{ secrets.ALI_ACR_PASSWORD }}

      - name: Compute git short hash tag
        id: tag
        run: |
          GIT_HASH=$(git rev-parse --short HEAD)
          echo "git_hash=${GIT_HASH}" >> "$GITHUB_OUTPUT"
          echo "Tag: ${GIT_HASH}"

      - name: Build & push image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64
          push: true
          provenance: false
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_REPO }}:${{ steps.tag.outputs.git_hash }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_REPO }}:latest

      - name: Print pushed image
        run: |
          echo "Pushed: ${{ env.REGISTRY }}/${{ env.IMAGE_REPO }}:${{ steps.tag.outputs.git_hash }}"
          echo "Pushed: ${{ env.REGISTRY }}/${{ env.IMAGE_REPO }}:latest"
```

- [ ] **Step 2: 校验 yml 语法**

Run:
```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/build-image.yml'))" && echo "yaml OK"
```

Expected: 输出 `yaml OK`。如果系统没装 PyYAML，跳过此步骤（GitHub Actions 启动时会报语法错）。

- [ ] **Step 3: 暂存与 commit**

Run:
```bash
git add .github/workflows/build-image.yml
git status --short | grep build-image
```

Expected: 仅 `A  .github/workflows/build-image.yml` 一行。

```bash
git commit -m "$(cat <<'EOF'
ci(infra): 增加 GitHub Actions docker 构建 workflow（X2）

云效流水线 16G 实例下 RUN bun nuxt build 处于内存临界状态，反复 SIGKILL。
改用 GitHub Actions ubuntu-latest（同 16GB 但 cgroup 配置不同，且可平滑升至
larger runner）跑 docker buildx，推阿里云 ACR。云效流水线保持现状作 fallback。

详见 docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md
EOF
)"
```

Expected: commit 成功。

---

## Task 4: 推送并触发 GitHub Actions 构建

- [ ] **Step 1: 推送到远端**

Run:
```bash
git log --oneline -3
git push
```

Expected:
- `git log` 顶部依次是本计划 Task 3 的 commit、Task 1 的 commit
- `git push` 成功

- [ ] **Step 2: 用户在 GitHub UI 手动触发 workflow**

> ⚠️ 本步骤由用户在 GitHub Actions UI 完成。

浏览器访问：`https://github.com/daixin877889/LexSeek/actions/workflows/build-image.yml`

点 `Run workflow` → 选 `Branch: dev` → 点绿色 `Run workflow` 按钮。

等待 workflow 跑完（预估 8-15 分钟）。

- [ ] **Step 3: 用户观察 workflow 日志，记录关键判据**

打开正在跑的 workflow run，在 `Build & push image` 步骤的日志里观察：

- [ ] 是否出现 `RUN bun nuxt build` 阶段被 `Killed` / `exit code: 137`？
  - ❌ 不应出现 → 通过
  - ✅ 出现 → 转 §6.1 兜底（升 larger runner）
- [ ] 是否出现 ACR 登录失败（`unauthorized` / `denied`）？
  - ❌ 不应出现 → 通过
  - ✅ 出现 → 检查 secrets 配置
- [ ] 是否最终到 `pushing manifest ... done`？
  - ✅ 出现 → 镜像 push 成功
- [ ] Workflow 最终 status 是否为 `Success`？
  - ✅ 是 → 通过

将 `RUN bun nuxt build` 阶段的关键日志（最后 30-50 行）反馈给 AI。

---

## Task 5: 拉镜像本地启动验证

> ⚠️ 此步骤需要本机或部署环境能访问阿里云 ACR。

- [ ] **Step 1: 拉镜像**

Run:
```bash
GIT_HASH=$(git rev-parse --short HEAD)
docker pull crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com/lexseek/lexseek:${GIT_HASH}
```

Expected: 拉取成功，输出 `Status: Downloaded ...` 或 `Image is up to date`。

- [ ] **Step 2: 启动容器并健康检查**

Run（启动）：
```bash
GIT_HASH=$(git rev-parse --short HEAD)
docker run -d --rm --name lexseek-x2-test \
  -p 13002:3000 \
  --env-file <真实 .env 路径> \
  crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com/lexseek/lexseek:${GIT_HASH}
sleep 10
```

Run（验证）：
```bash
curl -fsS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:13002/api/health || true
docker logs lexseek-x2-test --tail 30
```

Expected:
- HTTP 200，**或** 5xx 但 logs 显示是因为 .env 配置（如 DB 连接失败）— 这种情况下 HTTP 服务器在响应即接受为通过
- 容器仍在 running

Run（清理）：
```bash
docker stop lexseek-x2-test
```

> 如果当前环境没有真实 .env 与 ACR 拉取权限，此 task **记录"待生产环境验证"** 即可，不阻塞 X2 方案的"构建通过"结论。

---

## Task 6: 追加验收记录到 X2 spec

- [ ] **Step 1: 在 X2 spec 末尾追加 §10**

Edit `docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md`，在文件末尾追加：

```markdown
## 10. 验收结果

- 验收日期: 2026-04-29（按实际填写）
- GitHub Secrets 配置: ✅ 已添加 ALI_ACR_USERNAME / ALI_ACR_PASSWORD
- GHA workflow 触发: ✅ 通过 / ❌ 失败（按实际填写，失败时附日志关键片段）
- ACR 镜像 push: ✅ 通过 / ❌ 失败
- 本地拉镜像启动 /api/health: ✅ 通过 / ⏸ 待生产验证
- 后续：若 GHA 通过，X2 阶段达成；下一步排期 P1 客户端瘦身（长期治本）。
```

- [ ] **Step 2: Commit 验收结果**

Run:
```bash
git add docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md
git status --short | grep x2-github-actions
```

Expected: 仅 `M  docs/superpowers/specs/2026-04-29-docker-build-x2-github-actions-design.md`

```bash
git commit -m "docs(infra): 记录 X2 GitHub Actions docker 构建验收结果"
git push
```

Expected: commit 成功并推送。

---

## 完成判据

全部 6 个 Task 走完，**满足以下三条**视为本计划完成：

1. `.github/workflows/build-image.yml` 已合入 `dev` 分支
2. GitHub Actions 上手动触发该 workflow 一次，构建成功并把镜像推到 ACR
3. X2 spec 第 10 节验收结果已记录并 commit

**任一失败** → 按 X2 spec §6 兜底路径处理：
- 构建仍 OOM → 升 larger runner（A2）或转 X1（本地构建）/ X3（自有 ECS）
- ACR 推送失败 → 检查 secrets 与 ACR 权限
- 镜像启动失败 → 走 docker logs 比对差异

X2 落地后，长期治本仍需另起 plan 推进 P1（客户端瘦身），不在本计划范围内。
