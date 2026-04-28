# 订单管理与支付记录管理后台模块 — 设计

- **作者**：戴鑫
- **日期**：2026-04-28
- **状态**：待评审
- **关联模块**：`server/services/payment/`、`server/api/v1/admin/`、`app/pages/admin/`

---

## 1. 背景与目标

LexSeek 已有完整的订单和支付服务（`server/services/payment/`）以及对应的用户端接口，运营和客服在日常工作中需要在管理后台查询订单状态、核对支付情况、给异常订单留言、取消误下单的待支付订单，并能导出表格用于财务对账。

本设计的目标是新增两个管理后台模块——**订单管理**和**支付记录**——满足上述查询、轻量管理、导出三类诉求。退款、补发权益等涉及真金白银的操作不在本期范围内。

### 用户故事

- 客服小李：用户来反馈"我已经付了钱但会员没生效"，小李按手机号搜出该用户的订单和支付记录，能在详情里看到支付回调原始数据，判断是支付通道问题还是业务回调问题，并写一条管理员备注以便交接。
- 运营小王：每月底需要对账，按时间区间筛选已支付订单，导出 CSV，在 Excel 里和财务流水核对。
- 客服小李：用户误下单了一个会员套餐还没付款，希望客服帮忙取消。小李定位到该订单，填取消原因，一键取消。
- 内部审计：怀疑某管理员误操作，能在审计日志里按操作人/时间筛选出所有"取消订单""修改备注"的记录。

---

## 2. 范围

### In Scope

- 订单列表（筛选 + 分页 + CSV 导出）
- 订单详情抽屉（订单基本信息 + 用户/商品 + 关联支付单 + 审计日志 + 管理员备注 + 取消订单）
- 支付记录列表（筛选 + 分页 + CSV 导出）
- 支付记录详情抽屉（支付基本信息 + 关联订单 + 回调原始数据 + 审计日志 + 管理员备注）
- 管理员备注（独立字段，仅后台可见）
- 手动取消待支付订单（必填取消原因 + 关闭关联待支付支付单 + 写审计日志）
- 审计日志接入（复用 `permission_audit_logs` 表）
- RBAC 权限点和菜单注册（独立"财务管理"分组）

### Out of Scope（明确不做）

- 退款（涉及微信/支付宝退款 API 对接，单独立项）
- 手动补发会员/积分（涉及业务侧 handlers 复用，单独立项）
- 已支付订单的状态修改（仅允许取消"待支付"状态的订单）
- 订单/支付的批量操作
- 财务对账自动化、流水自动核对

---

## 3. 数据模型变更

### 3.1 新增字段

修改 `prisma/models/order.prisma`，给 `orders` 和 `payment_transactions` 各加 3 个字段：

```prisma
// orders 模型新增
adminRemark          String?   @map("admin_remark") @db.Text
adminRemarkUpdatedBy Int?      @map("admin_remark_updated_by")
adminRemarkUpdatedAt DateTime? @map("admin_remark_updated_at") @db.Timestamptz(6)

// payment_transactions 模型新增（同样三个字段）
adminRemark          String?   @map("admin_remark") @db.Text
adminRemarkUpdatedBy Int?      @map("admin_remark_updated_by")
adminRemarkUpdatedAt DateTime? @map("admin_remark_updated_at") @db.Timestamptz(6)
```

**`adminRemarkUpdatedBy` 不加外键**：仅存 user_id 数字，不建立 Prisma 关系。理由：备注修改属高频写入，外键 join + on-delete cascade 不划算；查询展示时通过 `findOne(users)` 单独获取操作人信息即可（也可由审计日志的 operator 关系兜底）。

### 3.2 数据库迁移命令

```bash
bun run prisma:migrate --name add_admin_remark_to_orders_and_payments
```

预期生成的 SQL（仅供参考，以 Prisma 实际生成为准）：

```sql
ALTER TABLE "orders"
  ADD COLUMN "admin_remark" TEXT,
  ADD COLUMN "admin_remark_updated_by" INTEGER,
  ADD COLUMN "admin_remark_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "payment_transactions"
  ADD COLUMN "admin_remark" TEXT,
  ADD COLUMN "admin_remark_updated_by" INTEGER,
  ADD COLUMN "admin_remark_updated_at" TIMESTAMPTZ(6);
```

按项目数据库铁律：先用 `--create-only` 预览生成的 SQL，确认无破坏性改动后再 apply。

### 3.3 用户端隔离保障

`orders.remark` 和 `payment_transactions.remark` 是**业务关键字段**——`server/services/payment/handlers/upgradeHandler.ts` 用 `orders.remark` 存升级订单的 `fromMembershipId`（JSON 序列化）。所以管理员备注必须用独立字段。

**用户端不可见的实现保障**：

- 用户端订单接口 `server/api/v1/payments/orders.get.ts` 已经是"显式 map 字段"模式（不是返回完整 prisma 实体），新增 `admin_remark` 字段不会自动泄漏给用户端
- 在该接口的 `list.map((order) => ({...}))` 处显式不包含 `admin_remark` / `admin_remark_updated_by` / `admin_remark_updated_at`
- 同样的 map 模式应用于：`server/api/v1/payments/orders/cancel/[id].post.ts`、`server/api/v1/payments/orders/pay/[id].post.ts`、`server/api/v1/payments/query.get.ts`
- 单元测试加一条断言：用户端订单接口返回的 JSON 不含 `admin_remark` 字段（防回归）

---

## 4. 审计日志（复用 `permission_audit_logs`）

### 4.1 复用决策

`permission_audit_logs` 表虽然名字带 "permission"，但实际已被 `auditLog.service.ts` 用于 `user_assign_role` / `role_create` 等多种非权限场景，字段（`action / targetType / targetId / operatorId / oldValue / newValue / ip`）通用。直接复用，避免重复造表。

### 4.2 扩展 `AuditLogAction` 枚举

`shared/types/rbac.ts` 新增 3 个值：

```typescript
ORDER_CANCEL = 'order_cancel'                       // 后台手动取消订单
ORDER_REMARK_UPDATE = 'order_remark_update'         // 订单管理员备注变更
PAYMENT_REMARK_UPDATE = 'payment_remark_update'     // 支付单管理员备注变更
```

### 4.3 审计 service 包装（追加到现有文件，不新建独立文件）

直接在现有 `server/services/rbac/auditLog.service.ts` 末尾追加 3 个函数（仿照 `logRoleCreate` / `logUserAssignRole` 等已有按业务分组的写法），订单/支付审计本质上只是新的 `targetType`，应该和角色、权限审计共享同一个文件，避免拆散：

```typescript
export const logOrderCancel = async (
    event: H3Event,
    operatorId: number,
    orderId: number,
    payload: { oldStatus: number; reason: string },
    tx?: Prisma.TransactionClient,
) => {
    return createAuditLogDao({
        action: AuditLogAction.ORDER_CANCEL,
        targetType: 'order',
        targetId: orderId,
        operatorId,
        oldValue: { status: payload.oldStatus },
        newValue: { status: OrderStatus.CANCELLED, reason: payload.reason },
        ip: getClientIp(event),
    }, tx)
}

export const logOrderRemarkUpdate = async (
    event: H3Event,
    operatorId: number,
    orderId: number,
    payload: { oldRemark: string | null; newRemark: string | null },
    tx?: Prisma.TransactionClient,
) => { /* 类似 */ }

export const logPaymentRemarkUpdate = async (
    event: H3Event,
    operatorId: number,
    paymentTransactionId: number,
    payload: { oldRemark: string | null; newRemark: string | null },
    tx?: Prisma.TransactionClient,
) => { /* 类似 */ }
```

### 4.4 审计日志查看入口

- 全局列表：复用现有 `GET /api/v1/admin/audit`（已支持 `action` / `targetType` / `operatorId` / 时间区间筛选）
- 详情页内联：订单详情抽屉里显示该订单的审计记录时间线，调用 `findAuditLogsByTargetDao('order', orderId)`；支付详情抽屉同理（`'payment_transaction'`）

---

## 5. 后端 API

### 5.1 管理端订单 API（`server/api/v1/admin/orders/`）

| 方法 | 路径 | 用途 | 入参 | 出参 |
|------|------|------|------|------|
| GET | `/api/v1/admin/orders` | 列表 + 筛选 + 分页 | `keyword` / `status` / `orderType` / `productId` / `startTime` / `endTime` / `page` / `pageSize` | `{ items, total, page, pageSize }` |
| GET | `/api/v1/admin/orders/export` | CSV 导出 | 同列表（不含分页），`limit` 上限 10000 | CSV 流（带 BOM） |
| GET | `/api/v1/admin/orders/[id]` | 详情 | `id` | 订单 + user + product + payment_transactions[] + audit_logs[] |
| PATCH | `/api/v1/admin/orders/remark/[id]` | 更新管理员备注 | `id`, `{ remark: string \| null }` | 更新后的订单 |
| POST | `/api/v1/admin/orders/cancel/[id]` | 手动取消 | `id`, `{ reason: string }`（必填，1-200 字） | 更新后的订单 |

> **路径规范说明**：项目铁律要求路由动态参数 `[id]` 必须放在路径末尾，不能放中间。所以 "更新备注" 和 "取消订单" 这类带子操作的接口，子操作名（remark / cancel）放在 `[id]` 之前。

### 5.2 管理端支付 API（`server/api/v1/admin/payments/`）

| 方法 | 路径 | 用途 | 入参 | 出参 |
|------|------|------|------|------|
| GET | `/api/v1/admin/payments` | 列表 + 筛选 + 分页 | `keyword` / `status` / `paymentChannel` / `paymentMethod` / `startTime` / `endTime` / `page` / `pageSize` | `{ items, total, page, pageSize }` |
| GET | `/api/v1/admin/payments/export` | CSV 导出 | 同列表（不含分页），`limit` 上限 10000 | CSV 流（带 BOM） |
| GET | `/api/v1/admin/payments/[id]` | 详情 | `id` | 支付单 + order + user + callbackData + audit_logs[] |
| PATCH | `/api/v1/admin/payments/remark/[id]` | 更新管理员备注 | `id`, `{ remark: string \| null }` | 更新后的支付单 |

### 5.3 关键字搜索的实现

订单列表 `keyword` 同时匹配：`orders.orderNo` / `users.phone` / `users.name`（`OR` 联合查询，前后加 `%` 模糊匹配）。

支付列表 `keyword` 同时匹配：`paymentTransactions.transactionNo` / `paymentTransactions.outTradeNo` / `orders.orderNo` / `users.phone` / `users.name`。

订单列表 `productId` 筛选：按商品 ID **精确匹配**（前端是商品下拉选择，传 productId 数字）。

### 5.4 取消订单的事务边界

`POST /api/v1/admin/orders/cancel/[id]` 的 handler 必须在一个 Prisma 事务里完成：

1. 查询订单当前状态，校验为 `PENDING`，否则返回 400 "仅待支付订单可取消"
2. 更新订单：`status` → `CANCELLED`，写 `admin_remark`（含 `[后台取消] {原因}` 前缀）、`admin_remark_updated_by`、`admin_remark_updated_at`
3. 关闭该订单下所有 `status = PENDING` 的支付单：状态 → `EXPIRED`（4），避免遗留可支付的支付单
4. 写审计日志：`logOrderCancel(event, operatorId, orderId, { oldStatus, reason }, tx)`

四步在同一事务内，任意一步失败整体回滚。

> **关于第 3 步与现有 cron 的关系**：项目已有 `handleExpiredPaymentTransactionsService`（每 10 分钟自动清理过期待支付支付单）。本 spec 仍在事务里同步关闭支付单，**不依赖 cron 兜底**——理由：用户取消订单是显式业务行为，应立刻把相关状态推到终态，不能让用户等 10 分钟看到不一致状态；同时避免支付通道侧异常拉起的边界条件。cron 仅作为兜底防漏的最后防线。

### 5.5 鉴权

管理端鉴权由 `server/middleware/03.permission.ts` 自动按 `api_permissions` 表判定。每个新增 API 路径 + method 在 `api_permissions` 表里登记一条权限点（详见 §9）。super_admin 自动放行；其它管理类角色由角色管理后台手动授权 admin/orders 和 admin/payments 相关权限点。

### 5.6 响应格式

沿用项目铁律：HTTP 永远 200，错误通过 `resError(event, code, msg)` 返回。`code` 字段：
- `200` 成功
- `400` 参数错误 / 状态校验失败
- `401` 未登录
- `403` 无权限（中间件兜底）
- `404` 资源不存在
- `500` 服务器错误

---

## 6. 服务/DAO 分层

### 6.1 文件结构

```
server/services/payment/
├── order.service.ts                  # 已有，用户端，不改
├── order.dao.ts                      # 已有，用户端，不改
├── paymentTransaction.dao.ts         # 已有，不改
├── payment.service.ts                # 已有，不改
├── handlers/                         # 已有，不改
│
├── order.admin.service.ts            # 新增：管理端订单业务
├── order.admin.dao.ts                # 新增：管理端订单数据访问
├── paymentTransaction.admin.service.ts  # 新增
└── paymentTransaction.admin.dao.ts   # 新增

server/services/rbac/
└── auditLog.service.ts               # 已有，在末尾追加 logOrderCancel/logOrderRemarkUpdate/logPaymentRemarkUpdate
```

**命名约定**：`<module>.admin.service.ts` / `<module>.admin.dao.ts` 沿用 `redemption/redemptionCode.admin.service.ts` 已建立的惯例。

### 6.2 关键函数签名

```typescript
import type { PaginationParams } from '#shared/types/rbac'  // 复用已有分页类型
import type { Prisma } from '#shared/types/prisma'

// order.admin.service.ts
export const findOrdersForAdminService = (query: AdminOrderQuery, pagination: PaginationParams) => Promise<{...}>
export const findOrderForAdminService = (id: number) => Promise<AdminOrderDetail | null>
export const updateOrderAdminRemarkService = (event: H3Event, operatorId: number, id: number, remark: string | null) => Promise<orders>
export const cancelOrderByAdminService = (event: H3Event, operatorId: number, id: number, reason: string) => Promise<orders>
export const exportOrdersService = (query: AdminOrderQuery, limit: number) => Promise<string>  // 返回 CSV 字符串

// order.admin.dao.ts
export const findOrdersForAdminDao = (query: AdminOrderQuery, pagination: PaginationParams, tx?: Prisma.TransactionClient) => ...
export const findOrderForAdminDao = (id: number, tx?: Prisma.TransactionClient) => ...  // include user/product/paymentTransactions
export const updateOrderAdminRemarkDao = (id: number, remark: string | null, operatorId: number, tx?: Prisma.TransactionClient) => ...
export const updateOrderForAdminCancelDao = (id: number, reason: string, operatorId: number, tx?: Prisma.TransactionClient) => ...
```

支付侧函数签名结构对称，不重复列出。

### 6.3 严禁混用

按项目铁律，**禁止**在 `order.service.ts` 里通过 `isAdmin` 参数为管理员开旁路。用户端继续走 `order.service.ts`（owner-only），管理端独立走 `order.admin.service.ts`（不做 owner 过滤）。

---

## 7. 前端页面与组件

### 7.1 列表页结构（仿照 `app/pages/admin/products/index.vue`）

**`app/pages/admin/orders/index.vue`** 结构：

```
┌─────────────────────────────────────────────────────────┐
│ 订单管理                                  [导出] [刷新]   │
│ 查询和管理用户订单                                       │
├─────────────────────────────────────────────────────────┤
│ [搜索框: 订单号/手机号/昵称] [状态]    [类型] [商品]     │
│ [起止日期]                          [筛选]   [重置]     │
├─────────────────────────────────────────────────────────┤
│ 订单号  | 用户   | 商品   | 金额 | 类型 | 状态 | 时间   │
│ ───────────────────────────────────────────────────────│
│ ORD123 | 138... | VIP月卡 | ¥99 | 新购 | 已支付 | ...  │  → 行点击打开详情抽屉
│ ORD124 | 139... | VIP年卡 | ¥888 | 续费 | 待支付 | ... │
│ ...                                                     │
├─────────────────────────────────────────────────────────┤
│                              < 1 2 3 ... > 共 234 条   │
└─────────────────────────────────────────────────────────┘
```

桌面端 Table，移动端 Mobile 卡片，沿用项目惯例。`<GeneralPagination>` 分页。

### 7.2 详情抽屉结构

订单详情抽屉（从右侧滑出，宽度 `max-w-[640px]` 或 `w-[60vw]`）：

```
┌──────────────────────────────────────┐
│ 订单详情                          [×] │
├──────────────────────────────────────┤
│ 订单号 ORD20260428001          [已支付]│
│ 订单金额 ¥99.00                       │
│ 创建时间 2026-04-28 10:23            │
│ 支付时间 2026-04-28 10:25            │
├──────────────────────────────────────┤
│ 用户信息                              │
│ 138****1234  张三                    │
├──────────────────────────────────────┤
│ 商品信息                              │
│ VIP 月卡  ¥99.00  时长 1 个月  类型 新购│
├──────────────────────────────────────┤
│ 业务备注（只读）                      │
│ {"fromMembershipId":12}              │
├──────────────────────────────────────┤
│ 管理员备注                    [编辑]   │
│ 用户反馈支付后会员未生效，已联系技术  │
│ 排查 — 张三 2026-04-28 11:00         │
├──────────────────────────────────────┤
│ 关联支付单（2 条）                    │
│ TXN001  微信  ¥99  支付成功  10:25 → │
│ TXN002  微信  ¥99  已过期    10:24 → │
├──────────────────────────────────────┤
│ 操作记录                              │
│ • 2026-04-28 11:00 张三 修改了备注    │
│ • 2026-04-28 10:25 系统 标记为已支付  │
├──────────────────────────────────────┤
│ [取消订单（仅待支付可见）]            │
└──────────────────────────────────────┘
```

> mockup 中"商品信息"块是订单的主商品（订单与商品是 1:1 关系，每张订单只关联一个 productId）。

支付详情抽屉结构对称，关键差异：
- 取代"关联支付单"是"**关联订单**"——显示订单号 + 状态 + 金额，**点击该行即切换到订单详情抽屉**（卸载当前支付抽屉，打开订单抽屉，提供清晰的关联导航）
- 多一块"回调原始数据"（callbackData JSON），用 HTML5 `<details>` + `<pre>` + Tailwind 折叠展示，不需独立组件

### 7.2.1 取消订单的内嵌表单实现

**不弹另一个 Dialog**，避免 AlertDialog 套 Sheet 的 z-index / Overlay 冲突。改为在订单详情抽屉内的同一位置展开 inline 表单：

```
[取消订单] 按钮（仅待支付订单可见）
        │
        ▼ 点击后，按钮区切换为：
        
┌────────────────────────────────────┐
│ 取消订单                            │
│ ┌────────────────────────────────┐ │
│ │ 请填写取消原因（1-200 字）...  │ │
│ │                                │ │
│ └────────────────────────────────┘ │
│ [确认取消（红）] [返回]             │
└────────────────────────────────────┘
```

实现要点：
- OrderDetailSheet 内的"取消订单"区块用一个本地 `ref<'idle' | 'editing'>('idle')` 状态切换
- "确认取消"按钮调用 `POST /api/v1/admin/orders/cancel/:id`，成功后刷新当前抽屉详情
- reason 走前端 zod 校验（1-200 字非空）
- **禁用** 浏览器原生 `confirm()` / `prompt()` 和单独的 Modal/Dialog 组件

### 7.3 z-index 注意（按项目记忆）

Sheet 抽屉默认 `z-[70]`。如果在抽屉里弹"取消订单确认对话框"或"管理员备注编辑器"，要把这些浮层提到 `z-[200]+`，避免被抽屉遮罩盖住。

### 7.4 组件清单（精简版）

```
app/components/admin/orders/
├── OrderTable.vue                    # 桌面端表格
├── OrderMobile.vue                   # 移动端卡片列表
├── OrderFilters.vue                  # 筛选条（状态单选 + 'all'）
├── OrderDetailSheet.vue              # 详情抽屉（含所有详情区块 + 取消订单 inline 表单 + 审计列表 + callback JSON）
└── OrderAdminRemarkEditor.vue        # 管理员备注编辑器

app/components/admin/payments/
├── PaymentTable.vue
├── PaymentMobile.vue
├── PaymentFilters.vue
├── PaymentDetailSheet.vue            # 含 <details><pre> 折叠展示 callbackData
└── PaymentAdminRemarkEditor.vue

app/components/admin/shared/
└── StatusBadge.vue                   # 通用状态徽章（接受 status 数字 + variant 映射表 props）
```

**精简点说明**：
- 不再为订单/支付分别建 `*StatusBadge.vue`，统一为 `shared/StatusBadge.vue`，通过传入"状态值 → variant + text"的映射表渲染。**所有状态映射（OrderStatusText / PaymentStatusText / OrderStatusVariant / PaymentStatusVariant）统一定义在 `shared/types/payment.ts`，组件 import 用，禁止本地重复定义**
- 不新建 `PaymentCallbackViewer.vue` 独立组件——回调 JSON 折叠用 HTML5 `<details>` + `<pre>` + Tailwind `font-mono` 即可
- 不新建 `AdminAuditLogTimeline.vue` 独立组件——抽屉里直接 `<ul>` + `Separator` 渲染审计列表，逻辑无复用价值不抽组件
- 不新建 `OrderCancelDialog.vue` 独立组件——取消订单走 OrderDetailSheet 内嵌 inline 表单（见 §7.2.1）

### 7.5 状态徽章颜色（沿用 shadcn-vue 语义）

| 订单状态 | 颜色 |
|----------|------|
| 待支付 | `secondary` (灰) |
| 已支付 | `default` (绿) |
| 已取消 | `outline` (浅) |
| 已退款 | `destructive` (红) |

| 支付状态 | 颜色 |
|----------|------|
| 待支付 | `secondary` |
| 支付成功 | `default` (绿) |
| 支付失败 | `destructive` |
| 已过期 | `outline` |
| 已退款 | `destructive` |

### 7.6 图标（lucide-vue-next，严禁 emoji）

**前端 Vue 组件 import 名（不带 Icon 后缀）**：

```ts
import { ShoppingCart, CreditCard, Download, Ban, Pencil, History, Eye } from 'lucide-vue-next'
```

| 用途 | 组件名 |
|------|--------|
| 订单菜单 | `ShoppingCart` |
| 支付菜单 | `CreditCard` |
| 导出按钮 | `Download` |
| 取消订单 | `Ban` |
| 编辑备注 | `Pencil` |
| 审计日志 | `History` |
| 查看支付 | `Eye` |

**数据库 routers.icon 字段值（带 Icon 后缀）**：见 §9.2，写 `'ShoppingCartIcon'` / `'CreditCardIcon'`。这是项目惯例：lucide 的 `lucide-vue-next` 包同时 export 两种命名（带与不带 Icon 后缀），前端模板用不带后缀的名字 import 组件，而 routers 表里的字符串字段沿用带 Icon 后缀的写法以与已有 25+ 条记录保持一致。前端运行时通过字典映射查找具体组件。

---

## 8. 数据导出

### 8.1 实现仿照

仿照 `server/api/v1/admin/redemption-codes/export.get.ts` + `server/services/redemption/redemptionCode.admin.service.ts:exportRedemptionCodesService`：

- 返回 CSV 字符串
- 加 BOM (`'﻿'`) 解决 Excel 中文乱码
- 字段值用双引号包裹，包含逗号或引号时需转义
- HTTP 响应：`Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="orders-{timestamp}.csv"`

### 8.2 字段定义

**订单导出 CSV 字段**（10 列）：
1. 订单号
2. 用户手机号
3. 用户昵称
4. 商品名
5. 订单类型（中文：新购/升级/续费）
6. 金额（元）
7. 状态（中文：待支付/已支付/已取消/已退款）
8. 创建时间（`YYYY-MM-DD HH:mm:ss`，Asia/Shanghai）
9. 支付时间（同上，未支付为空）
10. 管理员备注

> 删除原 spec 第 8 列"时长 + 单位"——财务对账核心是金额、时间、状态，时长属于产品维度，对账价值低；时长信息在订单详情和列表里仍可见。

**支付导出 CSV 字段**（11 列）：
1. 支付单号
2. 关联订单号
3. 用户手机号
4. 支付渠道（中文：微信/支付宝）
5. 支付方式（中文：小程序/扫码/H5/APP/PC）
6. 金额（元）
7. 状态（中文）
8. 第三方交易号
9. 创建时间
10. 支付时间
11. 管理员备注

### 8.3 范围与上限

- 导出当前筛选条件下的全部记录（无分页限制）
- `limit` 默认 10000，最大 10000
- 超过 10000 条时，返回 400 "导出条数超过上限 10000，请缩小筛选范围"
- 后续如有更大量需求，再考虑异步生成 + 邮件/下载链接

---

## 9. RBAC 与菜单注册（走 scan + import 机制，不改 seedData.sql）

### 9.1 注册机制

项目已有完整的 **scan + import 自动注册基建**，新增 admin 模块**不需要改 `prisma/seeds/seedData.sql`**（该文件只保留最干净的基础数据快照，不用作 migrate 增量记录）：

| 接口 | 用途 |
|------|------|
| `POST /api/v1/admin/routers/scan` + `POST /api/v1/admin/routers/import` | 扫描磁盘 `app/pages/admin/**/index.vue` 自动入 `routers` 表 |
| `POST /api/v1/admin/api-permissions/scan` + `POST /api/v1/admin/api-permissions/batch-import` | 扫描 `server/api/` 文件自动入 `api_permissions` 表 |
| `GET /api/v1/admin/menu-routers`（**超管兜底**）| 即使 routers 表没记录，磁盘有 `app/pages/admin/xxx/index.vue` 也会作为临时菜单返回给超管，开发期间可直接看到菜单 |

### 9.2 开发期间（Task 14/15 完成后）

- 超管登录：菜单兜底机制让"订单管理"和"支付记录"立即出现在左侧导航
- API 调用：RBAC 中间件对超管直接放行
- **本任务的开发流程不需要任何 seed 操作**，写完 API handler 和 page 文件就能跑

### 9.3 上线 / 多角色场景的入库流程（一次性）

部署上线前或需要给非超管角色授权时，登录超管账号执行：

1. 进入 `/admin/routers` 页面 → 点【扫描】→ 选中 `admin-orders` 和 `admin-payments` → 【导入】
   - 导入后在路由编辑里把 `menu_group` 设为 "**财务管理**"、`menu_group_sort` 设为 4、`icon` 设为 `ShoppingCartIcon` / `CreditCardIcon`
2. 进入 `/admin/api-permissions` 页面 → 点【扫描】→ 选中本次新增的 9 条权限 → 【批量导入】
3. 进入 `/admin/roles` 页面 → 选中需要赋权的角色（如运营、客服）→ 把 9 条权限点关联给该角色

> 这套流程对应项目里已有 admin 模块的标准上线步骤，不为本次任务额外发明流程。

### 9.4 9 条新增 API 权限点清单（供上线时核对）

订单 5 条 + 支付 4 条：

```
GET    /api/v1/admin/orders
GET    /api/v1/admin/orders/export
GET    /api/v1/admin/orders/:id
PATCH  /api/v1/admin/orders/remark/:id
POST   /api/v1/admin/orders/cancel/:id

GET    /api/v1/admin/payments
GET    /api/v1/admin/payments/export
GET    /api/v1/admin/payments/:id
PATCH  /api/v1/admin/payments/remark/:id
```

> **关于路径风格**：`api_permissions` 表 path 字段用 `:id`（与已注册的多数 admin 接口一致，如 `/api/v1/admin/products/:id`、`/api/v1/admin/case-types/status/:id`）；Nuxt 文件路由层用 `[id].post.ts`（见 §5 路径表）。
>
> **铁律仍然适用**：`:id` / `[id]` 必须在路径末尾，不能放中间。本表中 "更新备注" 和 "取消订单" 接口已经把子操作（remark / cancel）放在 `:id` 之前。

### 9.5 默认角色绑定

- super_admin 自动放行（中间件层）
- 其它管理类角色（如 admin、operator）默认**不**自动绑定，由超管在角色管理后台按需手动授权——避免绕开"按需授权"原则

---

## 10. 安全与隔离保障

### 10.1 用户端零泄漏 admin_remark

- 用户端订单/支付接口的字段 map 显式排除 admin_remark 三件套
- 加单元测试断言：用户端接口返回 JSON 的 keys 集合不含 `admin_remark`
- 代码评审 checklist：未来修改用户端接口字段时，禁止把 admin_remark 加进序列化白名单

### 10.2 管理端鉴权

- 用户端：`server/api/v1/payments/*` 已有 owner-only 校验，本期不动
- 管理端：`server/api/v1/admin/orders/*` 和 `server/api/v1/admin/payments/*` 全部由 RBAC 中间件细粒度授权
- 不在 admin handler 内部做归属过滤（已有 RBAC 兜底）

### 10.3 取消订单的状态保护

只允许取消 `PENDING` 状态的订单。已支付、已取消、已退款一律拒绝，保护资金安全。

### 10.4 审计日志不可篡改

- `permission_audit_logs` 表的 RBAC 权限点不开放 `UPDATE` / `DELETE` 给任何角色（已有现状）
- 取消订单的事务里 `logOrderCancel` 必须放在 `tx.commit` 之前，且失败要回滚整个事务

### 10.5 关键字搜索的 SQL 注入防护

所有 keyword 走 Prisma `contains` 操作符（参数化查询），不拼字符串 SQL。

---

## 11. 测试策略

按 TDD 顺序：先写测试，再写实现。

### 11.1 DAO 层（`tests/server/payment/order.admin.dao.test.ts` 等）

- `findOrdersForAdminDao`：keyword 搜索准确性（订单号/手机号/昵称）、状态多选、类型筛选、时间区间、分页
- `findOrderForAdminDao`：返回完整关联（user/product/paymentTransactions）
- `updateOrderAdminRemarkDao`：写入 admin_remark + updated_by + updated_at 一致
- `updateOrderForAdminCancelDao`：状态变更、备注前缀正确

### 11.2 Service 层（集成测试）

- `cancelOrderByAdminService` 的事务原子性：四步任意一步失败整体回滚
- `cancelOrderByAdminService` 关闭关联待支付支付单的逻辑
- `updateOrderAdminRemarkService` 写审计日志的 oldValue/newValue 准确
- `exportOrdersService` 的 CSV 生成：BOM、转义、字段顺序、limit 上限

### 11.3 API 层

- 参数校验（zod schema）
- 取消已支付订单返回 400
- 取消不存在订单返回 404
- **关键回归测试**：用户端 `GET /api/v1/payments/orders` 返回 JSON 不含 `admin_remark`

### 11.4 前端

- 列表页筛选交互：选择 + 触发请求 + 清空
- 详情抽屉打开/关闭、字段渲染
- 取消订单弹窗：原因必填校验、提交后列表刷新
- 状态徽章颜色映射

### 11.5 测试库

走 `ls_new_testing`，按项目记忆里的 prisma push 流程同步 schema：
```bash
DATABASE_URL='...ls_new_testing...' bun run prisma:push --accept-data-loss
```

---

## 12. 实施顺序

按"自底向上 + TDD"原则：

1. **数据层**
   - 修改 `prisma/models/order.prisma`
   - 跑 `bun run prisma:migrate --name add_admin_remark_to_orders_and_payments --create-only`
   - 评审生成的 SQL
   - apply
2. **类型层**
   - `shared/types/payment.ts` 扩展 `AdminOrderQuery` / `AdminOrderListItem` / `AdminOrderDetail` / 支付侧类似类型
   - `shared/types/rbac.ts` 扩展 `AuditLogAction` 三个新值
3. **DAO 层**
   - 写测试 → 实现 `order.admin.dao.ts` / `paymentTransaction.admin.dao.ts`
4. **审计 service**
   - 在现有 `server/services/rbac/auditLog.service.ts` 末尾追加 `logOrderCancel` / `logOrderRemarkUpdate` / `logPaymentRemarkUpdate` 三个函数（不新建独立文件）
5. **业务 service**
   - 写测试 → 实现 `order.admin.service.ts` / `paymentTransaction.admin.service.ts`
   - 重点测试 `cancelOrderByAdminService` 事务
6. **API 层**
   - 写 zod schema + handler，复用 service
   - 用户端 `payments/orders.get.ts` 等接口的字段 map 显式排除 admin_remark + 加回归测试
7. **前端组件**
   - 共享组件 `shared/StatusBadge.vue`（订单/支付通用）
   - 订单组件（Table / Mobile / Filters / DetailSheet / CancelDialog / RemarkEditor）
   - 支付组件（Table / Mobile / Filters / DetailSheet / RemarkEditor，回调 JSON 用 details/pre 内联）
8. **前端页面**
   - `app/pages/admin/orders/index.vue` + `app/pages/admin/payments/index.vue`
9. **RBAC 注册**
   - `prisma/seeds/seedData.sql` 加 routers 和 api_permissions 记录
   - 本地导入 seed 验证菜单和接口可访问
10. **联调与修复**
    - 单模块单测全部通过后，跑全量测试
    - 阶段收尾后 kill dev server（按项目记忆）

预计总实施时长：3-5 个工作日。

---

## 13. 风险与权衡

| 风险 | 缓解措施 |
|------|----------|
| `permission_audit_logs` 表名语义不够泛化，未来可能误以为只能记权限相关日志 | 在 `auditLog.service.ts` 顶部加注释说明该表已用于多种业务场景；后续如真有重命名需求再单独立项 |
| 用户端不小心把 admin_remark 暴露 | 显式 map 字段 + 单元测试断言 + 代码评审 checklist 三道防线 |
| 取消订单时关联支付单状态变更可能漏处理 | 事务包裹 + 集成测试覆盖"待支付支付单关闭"用例 |
| CSV 导出大数据量（接近 10000 条）内存压力 | 上限严格 10000；DAO 查询用 `findMany` 一次性拉取（10000 条订单/支付单的内存占用可控，约 5-10 MB） |
| 业务 `orders.remark` 含 JSON 序列化数据，前端误展示给管理员看会困惑 | 详情抽屉的"业务备注"区块明确标注"系统记录，仅供参考"，并尝试 JSON 美化展示；非 JSON 时按原文展示 |
| 财务管理菜单分组对已有部署可能需要 RBAC 角色重新授权才看得到新菜单 | 在部署文档明确：seed 后需要登录超管手动给 admin 角色绑定新权限点 |

---

## 附录 A：枚举与状态映射

### 订单状态（`OrderStatus`，已存在）

| 值 | 含义 | 中文 |
|----|------|------|
| 0 | PENDING | 待支付 |
| 1 | PAID | 已支付 |
| 2 | CANCELLED | 已取消 |
| 3 | REFUNDED | 已退款 |

### 支付单状态（`PaymentStatus`，已存在）

| 值 | 含义 | 中文 |
|----|------|------|
| 0 | PENDING | 待支付 |
| 1 | SUCCESS | 支付成功 |
| 2 | FAILED | 支付失败 |
| 3 | EXPIRED | 已过期 |
| 4 | REFUNDED | 已退款 |

### 订单类型（`OrderType`，已存在）

| 值 | 含义 | 中文 |
|----|------|------|
| `purchase` | 新购 | 新购 |
| `upgrade` | 升级 | 升级 |
| `renew` | 续费 | 续费 |

### 支付渠道（已存在）

| 值 | 中文 |
|----|------|
| `wechat` | 微信 |
| `alipay` | 支付宝 |

### 支付方式（已存在）

| 值 | 中文 |
|----|------|
| `mini_program` | 小程序 |
| `scan_code` | 扫码 |
| `wap` | H5 |
| `app` | APP |
| `pc` | PC |
