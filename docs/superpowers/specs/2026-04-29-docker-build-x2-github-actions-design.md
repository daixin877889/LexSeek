# Docker 构建迁移到 GitHub Actions 方案（X2）

- 创建日期: 2026-04-29
- 范围: 把 docker 镜像构建从云效流水线搬到 GitHub Actions 公共 runner，推到阿里云 ACR；云效流水线**暂不动**作为 fallback
- 上游 spec: [`2026-04-29-docker-build-oom-fix-design.md`](./2026-04-29-docker-build-oom-fix-design.md)（§4.2 / §8 升级到 X2）

## 1. 背景

云效流水线 16G 实例下 `RUN bun nuxt build` 处于内存临界状态（详见上游 spec §7）。改 nuxt 配置已无法稳定通过。本方案用 GitHub Actions 作为新的构建环境绕开云效内存限制。

### 1.1 当前 GitHub 仓库状态

- Repo: `daixin877889/LexSeek`
- 已存在一个 workflow：`.github/workflows/test.yml`（仅 `workflow_dispatch` 触发，跑 vitest）
- buildx 已经在 test workflow 中用过（构建 PG 测试镜像），证明 GitHub Actions runner 上 docker buildx 工作链路通

### 1.2 关键决策（已经与用户确认）

| 决策 | 选择 | 备注 |
|---|---|---|
| Runner 规格 | **A3：先 ubuntu-latest（4-core/16GB），不够再升 larger runner** | GHA 的 cgroup 配置可能比云效宽松，先省钱试一次 |
| 与云效衔接 | **B2：云效流水线保持现状，GHA 单独跑** | 等 GHA 验证镜像可用再切云效（或不切） |
| 触发机制 | **C2：仅 `workflow_dispatch` 手动触发** | 与现有 test.yml 风格一致，避免误触发 |
| Cache 策略 | **E3：先不用 cache** | 跑通了再加 GHA cache 优化时间 |
| ACR 凭证 | 用户已同意添加 GitHub Secrets | 见 §3 |

## 2. 架构

```
开发者
  │
  ├── git push origin dev   ─────────────────────► GitHub repo
  │                                                     │
  │                                                     │ 手动 Run workflow
  │                                                     ▼
  │                                          ┌─ GitHub Actions ─┐
  │                                          │  ubuntu-latest    │
  │                                          │  (4-core / 16GB)  │
  │                                          │                   │
  │                                          │  docker buildx    │
  │                                          │  build --push     │
  │                                          └────────┬──────────┘
  │                                                   │
  │                                                   │ docker push
  │                                                   ▼
  │                                       crpi-r7d4r9dxxbzsk4ir.cn-
  │                                       hangzhou.personal.cr.
  │                                       aliyuncs.com/lexseek/
  │                                       lexseek:<git-hash>
  │                                                   │
  │                                                   │ pull (deploy)
  │                                                   ▼
  └─────────────► 云效流水线 ─────────────► 部署到 Serverless / ECS
                  （继续保留作 fallback）
```

- GitHub Actions 完全负责构建与推送
- 云效流水线**暂不动**：原有"build + deploy"流程仍可用，作为兜底；后续验证 GHA 镜像可用时可单独把云效改为"deploy-only"（不在本期范围）

## 3. 凭证（GitHub Secrets）

需要在 GitHub repo `Settings → Secrets and variables → Actions` 添加：

| Secret 名 | 值 | 来源 |
|---|---|---|
| `ALI_ACR_USERNAME` | `daixin@1857010335484493` | 来自 `scripts/build.sh:15` |
| `ALI_ACR_PASSWORD` | （阿里云 ACR 个人版访问密码） | 与云效用同一个 |

> 这两个 secret 与云效里使用的是**同一对**凭证，不需要单独申请。

## 4. 改动清单

### 4.1 新增文件

`.github/workflows/build-image.yml` — 新增 workflow，结构上与 test.yml 类似（同样 `workflow_dispatch`、同样 ubuntu-latest），步骤：

1. Checkout（`actions/checkout@v4`，含 git history 用于 git rev-parse）
2. Set up Docker Buildx（`docker/setup-buildx-action@v3`）
3. 登录阿里云 ACR（`docker/login-action@v3`，凭证从 secrets 读）
4. 计算 tag：`GIT_HASH=$(git rev-parse --short HEAD)`
5. Build & Push（`docker/build-push-action@v6`）
   - `platforms: linux/amd64`（与 build.sh 当前一致，本期不做多架构）
   - `tags: <REGISTRY>/lexseek/lexseek:${GIT_HASH}` + `:latest`
   - `provenance: false`（避免 ACR 个人版兼容问题，与 build.sh 一致）
   - **不配 `cache-from` / `cache-to`** （E3 决策）

### 4.2 不动的文件

- `Dockerfile` — 完全保留，包括 `ENV NODE_OPTIONS=--max-old-space-size=8192` 和当前 P0/P0.5 已合入的 `nuxt.config.ts` 改动
- `scripts/build.sh` — 保留作为本地构建脚本
- `.github/workflows/test.yml` — 不动
- 云效流水线配置 — 不动

## 5. 验证方案

### 5.1 GHA 构建通过判据

在 GitHub Actions UI 触发 `Build Image` workflow，观察日志：

- ✅ 整个 workflow 跑完，Job status 为 `success`
- ✅ 日志中能看到 `Successfully built` / `pushing manifest` 等推送成功标志
- ❌ 不出现 `Killed` / `exit code: 137` / `did not complete successfully`
- ❌ 不出现 `unauthorized` / `denied: requested access to the resource is denied`（凭证问题）

### 5.2 镜像可用性判据

在能访问 ACR 的环境（例如本机或云效）拉取镜像：

```bash
GIT_HASH=$(git rev-parse --short HEAD)
docker pull crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com/lexseek/lexseek:${GIT_HASH}
docker run -d --rm --name lexseek-x2-test \
  -p 13002:3000 \
  --env-file <真实 .env 路径> \
  crpi-r7d4r9dxxbzsk4ir.cn-hangzhou.personal.cr.aliyuncs.com/lexseek/lexseek:${GIT_HASH}
sleep 10
curl -fsS http://localhost:13002/api/health
docker stop lexseek-x2-test
```

通过条件：`/api/health` 返回 200 或可解读的 5xx（如 DB 连接失败但服务起来了）。

### 5.3 fallback 验证

云效流水线**仍能跑通构建并部署**（保持原有能力，本期不动云效配置）。

## 6. 失败兜底

### 6.1 GHA `ubuntu-latest` 仍 OOM（A3 升级到 A2）

如果 ubuntu-latest 16GB 跑出与云效相同的 SIGKILL：

- 把 workflow 的 `runs-on` 改为 `ubuntu-latest-l`（larger runner，private 仓库需付费）或 `ubuntu-24.04-large`
- 如果仓库是 private 但不愿付费，转方案 X1（本地或开发机构建 + 推 ACR）或 X3（自有 ECS）

### 6.2 ACR 推送 401 / 403

- 检查 GitHub Secrets 名字是否拼写正确
- 检查 ACR 凭证是否过期
- 检查 ACR 个人版是否有"允许从外网推送"的限制

### 6.3 镜像启动失败

- 走 `docker logs` 拉日志比对与云效构建出来的镜像有何差异
- 极少数情况是 GHA runner 的 buildx 版本与云效不同导致 multi-arch metadata 差异 → 加 `--provenance=false`（已在方案里配）

## 7. 风险与回滚

| 项 | 评估 |
|---|---|
| **改动面** | 仅新增 1 个 yml 文件 + GitHub Secrets 2 个 |
| **运行时风险** | 0 — 不影响任何运行中的服务 |
| **可回滚性** | 删 yml 即恢复（云效仍可工作） |
| **构建产物变化** | 与云效构建的镜像应字节级一致（相同 Dockerfile + 相同源码 commit） |
| **成本风险** | 仓库 public → 0 元；private → 每次构建消耗 GitHub Actions minutes（普通 runner ~$0.008/min，ubuntu-latest 跑一次构建预估 8-15 分钟） |

## 8. 验收标准

- [ ] GitHub Actions Secrets 已配置 `ALI_ACR_USERNAME` + `ALI_ACR_PASSWORD`
- [ ] `.github/workflows/build-image.yml` 已合入 `dev` 分支
- [ ] GitHub Actions 上手动触发该 workflow 一次，构建成功（`success`）并把镜像推到 ACR
- [ ] 拉取该镜像本地启动，`/api/health` 验证通过

任一失败 → 转 §6 兜底路径。

## 9. 不在本期范围

- 把云效流水线改成 deploy-only（解耦构建与部署）
- 客户端 bundle 瘦身（spec §4.1 / P1）
- 多架构构建（linux/arm64）
- GitHub Actions 缓存优化（E3 之外的 GHA cache）
- 自动触发 / tag 触发
- 跨 GHA 与云效流水线的状态同步（如 GHA 完成自动通知云效部署）
