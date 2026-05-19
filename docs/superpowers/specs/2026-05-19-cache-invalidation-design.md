# 跨进程缓存失效（cache invalidation bus）设计

> 日期：2026-05-19
> 状态：设计待评审

## 1. 背景与问题

### 1.1 触发问题

管理员在后台「节点」页修改某节点的模型后，运行中的案件初始化分析仍使用旧模型。

根因：节点配置走 `server/services/agent-platform/nodeConfig/loader.ts` 的进程级内存缓存（`Map<nodeName, NodeConfig>`，无 TTL）。该缓存只能靠显式调用 `invalidateNodeConfigCache()` 清除。而修改节点的接口 `PUT /api/v1/admin/nodes/:id`（请求体含 `modelId`）以及 `DELETE /api/v1/admin/nodes/:id` **均未调用失效函数**——其它所有改节点/提示词/技能的接口都调了，唯独节点本身的 PUT/DELETE 被遗漏。

结果：DB 已更新，但内存缓存仍是旧 `NodeConfig`，到进程重启前一直用旧模型。

### 1.2 更深一层：多实例一致性

项目按多实例横向扩展设计（定时任务用 Redis 分布式锁防重复、agentWorker 用共享 Redis 队列）。进程级内存缓存在多实例下存在固有缺陷：

- `invalidateNodeConfigCache()` 只是本进程的 `Map.delete()`，只清执行该调用的那一个实例。
- 改配置的 PUT 请求经负载均衡只落到一台；analysis 任务从共享 Redis 队列被任意实例的 worker 抢取。
- 即使补上漏掉的失效调用，多实例下仍只清了处理 PUT 那一台，其它实例的 worker 抢到任务照样用旧配置。

### 1.3 内存缓存全量审计

对服务端进程级内存缓存做了一次全量审计，共 17 处，按「该不该动」分三类：

**类 A — 配置类缓存，多机隐患高、可序列化（本设计处理）**

| 缓存 | 位置 | 现状 |
|------|------|------|
| NodeConfig 缓存 | `agent-platform/nodeConfig/loader.ts` | 无 TTL；1.1 的 bug 在此 |
| RBAC 用户权限缓存 | `rbac/cache.service.ts` | 60s TTL；撤权/封禁场景 60s 偏长 |
| RBAC 公开 API 权限缓存 | `rbac/cache.service.ts` | 60s TTL；改动频率低 |

**类 B — 有多机隐患，但持有「活对象」不可序列化（本设计处理）**

| 缓存 | 位置 | 不可迁 Redis 的原因 |
|------|------|------|
| FilesystemBackend 缓存 | `agent-platform/skills/filesystemBackendCache.ts` | 持有文件系统句柄实例 |

**类 C — 本就应 per-process，不在范围内（不动）**

支付/存储适配器（含私钥 + SDK 活状态）、向量库实例（绑 DB 连接）、agentWorker 的 AbortController、SSE 连接表、材料摘要 inflight 去重 Map、正则编译缓存、验证码失败锁定记录、OSS STS 凭证缓存等共 12 处。这些要么持有活对象，要么是 per-instance 的瞬时状态，迁 Redis 反而是错的。

> `rbac/cache.service.ts:44` 的代码注释已写明「终态方案是切到 Redis + pub/sub 主动失效，留待 M1 后续迭代」——本设计即落地该终态。

## 2. 范围

### 2.1 范围内

为以下 4 个缓存建立**跨进程失效一致性**：

1. `nodeConfig` — `agent-platform/nodeConfig/loader.ts`
2. `filesystemBackend` — `agent-platform/skills/filesystemBackendCache.ts`
3. `rbacUserPermission` — `rbac/cache.service.ts` 的 `userPermissionCache`
4. `rbacPublicApi` — `rbac/cache.service.ts` 的 `publicApiPermissionCache`

并顺带修复 1.1 的原始 bug（补 `nodes/[id].put.ts`、`nodes/[id].delete.ts` 的失效调用）。

### 2.2 范围外

- **Agent Registry 热更新**（`agent-platform/registry/agentRegistry.ts`）：该 registry 由 `defineDomainAgent` 在 `agent.config.ts` 模块 import 时一次性填充，内容 100% 来自源代码，无任何运行时/DB 写入口。它只随源码变更而变，而源码变更通过部署生效、部署整体替换实例——不存在「运行时配置漂移」，因此不属于缓存失效问题。审计中对它的「高隐患」评级基于一个本项目不存在的「在线更新 agent 定义」工作流，评级偏高。
- **类 C 的 12 处缓存**：本就应 per-process，不动。
- **模型 API Key 在 DB 的加密存储**：独立安全任务，单独立项。本设计选择「缓存留在进程内存、不进 Redis」，密钥不出进程，与该任务解耦。

## 3. 方案选型

三个候选方案：

1. **统一 pub/sub 失效广播，4 个缓存全部留进程内存** —— 一套机制，读路径留进程内（RBAC 是每请求热路径），密钥不出进程，Redis 非硬依赖。
2. **可序列化缓存迁 Redis 当共享存储，filesystemBackend 单独走 pub/sub** —— 两套机制；RBAC 热路径每请求多一次 Redis 往返；密钥落 Redis。
3. **仅缩短 TTL，不建 pub/sub** —— 最简单，但达不到 RBAC「近乎实时」要求。

> Nitro 原生缓存（`cachedFunction` + storage 驱动）已评估并排除：它本质等同方案 2——memory 驱动无跨实例失效，Redis 驱动则要求缓存值进 Redis（filesystemBackend 持有文件句柄不可序列化、RBAC 热路径不容每请求一次往返、密钥不出进程），且 Nitro 缓存无任何 pub/sub 失效广播机制。项目当前亦未使用 Nitro 原生缓存。

**采纳方案 1。** 关键论据：filesystemBackend 不可序列化、RBAC 要求近乎实时——pub/sub 失效广播无论如何都必须建。方案 2 是在它之上再加一套 Redis 存储，复杂度翻倍而无实质收益。方案 1 顺带消除三件事：RBAC 热路径不增延迟、API 密钥不出进程内存、Redis 非硬依赖。代价（各实例各存一份副本、失效时各自回源 DB）对「小数据 + 低频失效」场景完全可接受。

需求确认要点：

- RBAC 权限变更（撤权/封禁/改角色）要求**近乎实时**（子秒级）在所有实例生效 → 需 pub/sub。
- Redis 不可用时**不得**导致写库 API 失败或节点配置取不到 → 失效总线必须是「尽力而为」的优化层，TTL 是正确性底线。

## 4. 架构

新增一个**跨进程缓存失效总线**：一个 Redis pub/sub 频道 `cache:invalidate`。所有缓存仍留在各实例进程内存，缓存数据本身不进 Redis；Redis 只承载「失效通知」这一种小消息。

4 个缓存全部接入同一总线，并各自保留一个**兜底 TTL**（广播万一丢失也能在 TTL 内自愈）。

```
管理员改配置（改节点模型 / 撤权 / resync skill ...）
   → 写库
   → invalidateXxx() ──┬─► 本地立即清（本实例）
                       └─► bus.publishInvalidation(cacheName, keys?)
                              └─► Redis PUBLISH cache:invalidate {cacheName,keys?}
                                          │
            ┌───────────────────────────┼───────────────────────────┐
            ▼                            ▼                            ▼
       实例 A 订阅者                 实例 B 订阅者                 实例 C 订阅者
            └─ dispatch handler(cacheName, keys) ──► 各自本地 clear
                                                  ──► 下次读未命中 → 回源 DB 重填
```

子秒级全网生效；Redis 挂掉时广播不发，退化为「纯 TTL」（即今天的行为），Redis 不是硬依赖。

## 5. 组件

| 文件 | 动作 | 职责 |
|------|------|------|
| `server/utils/cacheInvalidationBus.ts` | 新增 | 总线核心：`publishInvalidation(name, keys?)`、`registerInvalidationHandler(name, handler)`、订阅消息并分发到 handler；导出 `CACHE_NAMES` 常量避免字符串拼错。放 `server/utils/` 对标同为「Redis 跨进程协调原语」的 `server/utils/cron.ts`（`CronScheduler`） |
| `server/lib/redis.ts` | 改 | 新增 `getCacheBusSubscriber()` —— 总线专用订阅连接单例（与现有 `redisSubscriber` 同模式），并纳入 `closeRedisConnections()` 统一关闭。**不复用 `getRedisSubscriber()`**（详见 §5.3） |
| `server/plugins/cache-invalidation.ts` | 新增 | Nitro 插件：启动时用 `getCacheBusSubscriber()` 订阅 `cache:invalidate`，并挂 `on('ready')` 幂等重订阅（详见 §7）。订阅连接的关闭由 `closeRedisConnections()` 统一负责，插件本身不管 Redis 生命周期（与 `agent-worker.ts` 一致） |
| `agent-platform/nodeConfig/loader.ts` | 改 | import 时注册失效 handler；为缓存项加 10min 兜底 TTL；`invalidateNodeConfigCache` 改为「清本地 + `publishInvalidation`」 |
| `agent-platform/skills/filesystemBackendCache.ts` | 改 | 同上；加 10min 兜底 TTL；`invalidateBackendCache` 改为「清本地 + `publishInvalidation`」 |
| `rbac/cache.service.ts` | 改 | import 时注册 handler；`clearUserPermissionCache` / `clearAllUserPermissionCache` / `clearUserPermissionCacheBatch` / `clearPublicApiPermissionCache` 改为「清本地 + `publishInvalidation`」；TTL 保持 60s |
| `server/api/v1/admin/nodes/[id].put.ts` | 改 | 更新成功后补 `invalidateNodeConfigCache(node.name)` —— 修复 1.1 原始 bug |
| `server/api/v1/admin/nodes/[id].delete.ts` | 改 | 删除成功后补 `invalidateNodeConfigCache(node.name)`。注意：该 handler 仅有节点 `id`，需在删除前（或事务内）取出 `name`，照搬 `prompts/[id].delete.ts` 已有写法 |

### 5.1 现有失效调用点几乎不动

RBAC 的十余个 admin 接口、`permission.service.ts`、`skillSync.service.ts`、节点提示词/技能接口，仍调用原来的 `clearXxx()` / `invalidateXxx()`。这些函数内部从「只清本地」升级为「清本地 + 广播」，调用方无感。**唯一的新增调用**是 nodeConfig 的 PUT/DELETE 两处（本就遗漏）。

### 5.2 handler 懒注册

缓存模块在被 import 时调用 `registerInvalidationHandler` 注册 handler。若某实例从未 import 过某缓存模块（即从未用过该缓存），收到对应失效消息时分发表查不到 handler → no-op；此时该实例本来也没有该缓存数据，无害。

各 cache 模块（`loader.ts` / `filesystemBackendCache.ts` / `cache.service.ts`）按项目惯例**显式 `import` 总线**，不依赖自动导入。

### 5.3 总线放置位置与 Redis 连接

**放置位置**：`cacheInvalidationBus.ts` 放在 `server/utils/`。它是跨域基础设施（同时服务于 agent-platform 与 rbac），不归属任何业务域，也不是 `*.service.ts`；项目里最贴切的先例是 `server/utils/cron.ts` 的 `CronScheduler`——同为「基于 Redis 的跨进程协调原语 + 被 Nitro 插件消费」，结构完全同构。

**Redis 连接**：

- 发布用 `getRedisClient()`（共享单例，PUBLISH 不独占连接，与 `agentEventBridge` 一致）。
- 订阅**必须用专用连接**，在 `server/lib/redis.ts` 新增 `getCacheBusSubscriber()` 单例。**不复用 `getRedisSubscriber()`**：该单例已被 `agentWorker` 占用（`subscribe('agent_tasks')` + `psubscribe('run_cancel:*')`），且 agentWorker 的 `on('message')` 回调不判断 channel——若总线在同一连接上订阅，每次缓存失效广播都会触发各实例一次多余的 `processNextTask()`，总线 handler 也会反收到 `agent_tasks` 消息。专用连接彻底避免串台，handler 也无需按 channel 过滤。
- 该专用连接纳入 `closeRedisConnections()`（由 `cron-scheduler.ts` 的 close hook 统一调用），与现有两个 Redis 单例的关闭路径一致。

## 6. 数据流与消息格式

### 6.1 消息格式

频道：`cache:invalidate`。消息体为 JSON：

```ts
interface CacheInvalidationMessage {
  cacheName: string   // CACHE_NAMES 之一
  keys?: string[]     // 有 = 清这些 key（单条或批量）；无/空 = 全清
}
```

`keys` 设计为数组，统一覆盖单条、批量（如 `clearUserPermissionCacheBatch` 一次清多个 userId）、全清三种情形。handler 签名 `(keys?: string[]) => void`：`keys` 为 undefined/空 → 全清，为数组 → 逐个删除。

各缓存的 keys 语义：

| cacheName | 有 keys | 无 keys |
|-----------|---------|---------|
| `nodeConfig` | 清这些 nodeName | 全清（如 skillSync） |
| `filesystemBackend` | （不使用，handler 忽略 keys）| 一向全清 |
| `rbacUserPermission` | 清这些 userId | 全清（批量改 API 权限时） |
| `rbacPublicApi` | （不使用，单例，handler 忽略 keys）| 全清 |

### 6.2 读路径

`getNodeConfigCached` 等读取函数的 read-through 模式不变（读本地内存 → 未命中则回源 DB → 回填本地）；新增一处 TTL 过期检查：命中后若 `Date.now() > expiredAt` 视为未命中并回源。为承载 TTL，nodeConfig / filesystemBackend 的缓存项结构需从「直接存值」改为 `{ value, expiredAt }`（RBAC 的 `cache.service.ts` 已是该结构）。TTL 仅作兜底，主失效路径是 pub/sub 广播。

### 6.3 发布者自收

发布者自身也订阅该频道，会收到自己发的消息并再清一次本地缓存——幂等 no-op，无害。不做 origin 过滤，保持实现简单。

> 一致性窗口：实例 A 写库后到实例 B 收到广播之间存在毫秒级窗口，期间 B 可能仍返回旧值。这是 pub/sub 失效的固有特性，属「近乎实时」而非「事务级即时」，对 nodeConfig 与 RBAC 均可接受。

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 发布时 Redis 不可用 | `publishInvalidation` 对 `redisClient.publish(...)` 做 fire-and-forget + `.catch(log)`——调用方（写库 API）不 `await` 它，本地缓存已同步清除，绝不因 Redis 挂掉或 `maxRetriesPerRequest` 重试而阻塞或失败；其它实例靠 TTL 自愈 |
| 启动时订阅连不上 | 插件启动时**先显式调用一次 `sub.subscribe('cache:invalidate')`**——既点火 `lazyConnect` 惰性连接、又完成首次订阅（该次调用在 Redis 不可用时会因 `maxRetriesPerRequest:3` 被 reject，用 `.catch(log)` 兜住）。**另给连接挂 `on('ready', () => sub.subscribe('cache:invalidate'))`** 负责其后每次（重）连接的（重）订阅——不能只依赖 ioredis 的 `autoResubscribe`，它只重订「曾成功订阅过」的频道，覆盖不到冷启动初次订阅就失败的场景。SUBSCRIBE 幂等，重复订阅无害；冷启动失败与后续断线重连都能自愈。断连期间该实例靠 TTL |
| 收到畸形消息 | catch JSON 解析错误，log，忽略该消息 |
| handler 执行抛错 | catch 包裹，不影响订阅连接与其它 handler |

核心原则：**失效总线是「尽力而为」的优化层，TTL 是正确性底线。** 总线完全不可用 = 退回今天的纯 TTL 行为，不会更糟。

## 8. 测试策略

- **总线单测**：`publishInvalidation` 生成的消息格式正确（单条/批量/全清）；收到消息分发到对应 handler 并正确传入 keys；未知 cacheName 为 no-op；畸形消息被忽略；handler 抛错被包住不影响后续。
- **各缓存单测**：`invalidate` → 本地清除 + 触发总线发布；TTL 过期生效；nodeConfig 的「缓存 null 哨兵」（节点不存在时缓存 null 仍快速返回）。
- **pub/sub 链路集成测试**：通过真实（测试）Redis 验证 `publishInvalidation` 发出的消息能被订阅端收到并触发对应 handler——单进程内「自发自收」即可验证整条链路，无需真起多进程。
  - ⚠️ **测试隔离**：vitest 多 worker 并行且共用同一 Redis 库（`.env.testing` 的 `NUXT_REDIS_URL` 指向单库），而 `cache:invalidate` 是单一全局频道，并行 worker 的订阅者会互收消息导致 flaky。`agentEventBridge` 测试靠 per-run 唯一 channel 天然隔离，本设计单频道无此保护——实现计划须显式解决：测试时给频道加 worker/test 唯一后缀，或在消息体带测试 nonce 由 handler 过滤。
- **原始 bug 回归**：`PUT /admin/nodes/:id` 与 `DELETE /admin/nodes/:id` → 验证 `nodeConfig` 缓存被失效。
- **覆盖率**：`agent-platform/**` 分目录阈值为 lines/statements/functions ≥90%、branches ≥75%，nodeConfig / filesystemBackend 改动一并补齐。新增的 `server/utils/cacheInvalidationBus.ts` 不在该 glob 内（仅受全局阈值约束），仍按项目规范自律补测到 ~90%。

## 9. 不做的事（YAGNI）

- 不引入通用缓存框架/抽象层，只做满足这 4 个缓存的最小总线。
- 不做 origin 过滤、不做消息去重、不做投递确认——TTL 兜底已覆盖丢失场景。
- 不为类 C 缓存做任何改动。
- 不在本设计内处理 Agent Registry 与 API Key DB 加密（见 2.2）。
- **不改动 RBAC 的 60s TTL。** 该值是用户出于安全考量从 5min 缩短而来；本设计引入主动失效后理论上 TTL 可放宽，但放宽属安全相关参数调整，须单独评审，不在本设计范围内顺带变更。
