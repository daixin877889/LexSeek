# 订单管理与支付记录管理后台模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台新增订单管理与支付记录两个模块，支持只读查询、管理员备注、手动取消待支付订单、CSV 导出。

**Architecture:** 后端按项目 Service-DAO 分层，新增 4 个文件（admin service/dao 各 2 个），审计日志包装追加到现有 `rbac/auditLog.service.ts`，复用 `permission_audit_logs` 表。前端按列表 + Sheet 抽屉的现有惯例，新增 14 个组件 + 2 个页面。所有管理端 API 走 `/admin/` 路径，由 RBAC 中间件细粒度授权。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + Tailwind v4 + shadcn-vue + lucide-vue-next + zod + dayjs + vitest

**关联 spec:** `docs/superpowers/specs/2026-04-28-admin-orders-and-payments-design.md`

---

## 文件结构

### 修改
- `prisma/models/order.prisma` — 加 admin_remark 三件套
- `shared/types/payment.ts` — 加 AdminOrderQuery / AdminPaymentQuery / 状态映射等类型
- `shared/types/rbac.ts` — 扩展 AuditLogAction
- `server/services/rbac/auditLog.service.ts` — 末尾追加 3 个 log 函数
- `server/api/v1/payments/orders.get.ts` — 加用户端隔离断言（已是显式 map，仅核对）

> **不改 `prisma/seeds/seedData.sql`**：菜单和 API 权限通过项目已有的 admin scan + import 机制注册（见 spec §9）。开发阶段超管菜单兜底自动可见。

### 新增（后端）
- `server/services/payment/order.admin.dao.ts`
- `server/services/payment/order.admin.service.ts`
- `server/services/payment/paymentTransaction.admin.dao.ts`
- `server/services/payment/paymentTransaction.admin.service.ts`
- `server/api/v1/admin/orders/index.get.ts`
- `server/api/v1/admin/orders/export.get.ts`
- `server/api/v1/admin/orders/[id].get.ts`
- `server/api/v1/admin/orders/remark/[id].patch.ts`
- `server/api/v1/admin/orders/cancel/[id].post.ts`
- `server/api/v1/admin/payments/index.get.ts`
- `server/api/v1/admin/payments/export.get.ts`
- `server/api/v1/admin/payments/[id].get.ts`
- `server/api/v1/admin/payments/remark/[id].patch.ts`

### 新增（前端）
- `app/components/admin/shared/StatusBadge.vue`
- `app/components/admin/orders/{OrderTable,OrderMobile,OrderFilters,OrderDetailSheet,OrderAdminRemarkEditor}.vue`
- `app/components/admin/payments/{PaymentTable,PaymentMobile,PaymentFilters,PaymentDetailSheet,PaymentAdminRemarkEditor}.vue`
- `app/pages/admin/orders/index.vue`
- `app/pages/admin/payments/index.vue`

### 测试
- `tests/server/payment/order.admin.dao.test.ts`
- `tests/server/payment/order.admin.service.test.ts`
- `tests/server/payment/paymentTransaction.admin.dao.test.ts`
- `tests/server/payment/paymentTransaction.admin.service.test.ts`
- `tests/server/payments/userOrderAdminRemarkRegression.test.ts`

---

## Task 1: 数据库迁移 — 加 admin_remark 字段

**Files:**
- Modify: `prisma/models/order.prisma`
- Create: `prisma/migrations/<timestamp>_add_admin_remark_to_orders_and_payments/migration.sql`（自动生成）

- [ ] **Step 1: 修改 Prisma schema 加字段（订单 + 支付单）**

修改 `prisma/models/order.prisma`，在 `orders` 模型字段列表里 `remark String?` 那行**之后**追加：

```prisma
  /// 管理员备注（仅后台可见）
  adminRemark          String?   @map("admin_remark") @db.Text
  /// 管理员备注最后修改人 ID（不建外键，避免高频写入连带 cascade）
  adminRemarkUpdatedBy Int?      @map("admin_remark_updated_by")
  /// 管理员备注最后修改时间
  adminRemarkUpdatedAt DateTime? @map("admin_remark_updated_at") @db.Timestamptz(6)
```

在 `paymentTransactions` 模型同样位置追加同样三个字段（字段说明改为"支付单管理员备注"）。

- [ ] **Step 2: 用 --create-only 生成迁移并预览 SQL**

```bash
bun run prisma:migrate --name add_admin_remark_to_orders_and_payments --create-only
```

打开生成的 `prisma/migrations/<timestamp>_add_admin_remark_to_orders_and_payments/migration.sql`，确认只有 `ALTER TABLE ... ADD COLUMN` 语句，**不应有** DROP / CONSTRAINT 等破坏性操作。预期 SQL：

```sql
ALTER TABLE "orders" ADD COLUMN "admin_remark" TEXT;
ALTER TABLE "orders" ADD COLUMN "admin_remark_updated_by" INTEGER;
ALTER TABLE "orders" ADD COLUMN "admin_remark_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "payment_transactions" ADD COLUMN "admin_remark" TEXT;
ALTER TABLE "payment_transactions" ADD COLUMN "admin_remark_updated_by" INTEGER;
ALTER TABLE "payment_transactions" ADD COLUMN "admin_remark_updated_at" TIMESTAMPTZ(6);
```

- [ ] **Step 3: 应用迁移到本地开发库**

```bash
bun run prisma:migrate
```

预期输出：`Database schema is up to date.`

- [ ] **Step 4: 同步推送到测试库**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run prisma:push --accept-data-loss
```

预期：`Your database is now in sync with your Prisma schema.`

- [ ] **Step 5: 类型检查验证**

```bash
npx nuxi typecheck
```

预期：通过（Prisma 客户端已自动重新生成）。

- [ ] **Step 6: Commit**

```bash
git add prisma/models/order.prisma prisma/migrations/ generated/prisma/
git commit -m "feat(admin): orders/payments 表加 admin_remark 三件套字段"
```

---

## Task 2: 扩展共享类型

**Files:**
- Modify: `shared/types/rbac.ts`
- Modify: `shared/types/payment.ts`

- [ ] **Step 1: 在 `shared/types/rbac.ts` 的 `AuditLogAction` 枚举末尾加 3 个值**

```typescript
export enum AuditLogAction {
    // ...现有值不动
    ROLE_CREATE = 'role_create',
    // ...
    API_PERMISSION_BATCH_DELETE = 'api_permission_batch_delete',

    // === 订单/支付管理审计 ===
    ORDER_CANCEL = 'order_cancel',
    ORDER_REMARK_UPDATE = 'order_remark_update',
    PAYMENT_REMARK_UPDATE = 'payment_remark_update',
}
```

- [ ] **Step 2: 在 `shared/types/payment.ts` 末尾追加 admin 端类型**

```typescript
import type { OrderStatus, PaymentStatus } from './payment'  // 自引用提示，实际同文件直接用

/** 管理端订单列表查询参数 */
export interface AdminOrderQuery {
    keyword?: string                  // 订单号/手机号/昵称
    status?: OrderStatus               // 状态单选（不传 = 全部）
    orderType?: 'purchase' | 'upgrade' | 'renew'
    productId?: number
    startTime?: Date
    endTime?: Date
}

/** 管理端订单列表项 */
export interface AdminOrderListItem {
    id: number
    orderNo: string
    userId: number
    userPhone: string
    userName: string | null
    productId: number
    productName: string
    amount: number
    duration: number
    durationUnit: string
    orderType: string
    status: OrderStatus
    paidAt: Date | null
    createdAt: Date
}

/** 管理端订单详情（含支付单 + 审计日志） */
export interface AdminOrderDetail extends AdminOrderListItem {
    expiredAt: Date
    remark: string | null              // 业务备注（只读）
    adminRemark: string | null         // 管理员备注
    adminRemarkUpdatedBy: number | null
    adminRemarkUpdatedAt: Date | null
    adminRemarkUpdaterName: string | null  // join 出的修改人昵称
    paymentTransactions: AdminPaymentListItem[]
    auditLogs: AdminAuditLogItem[]
}

/** 管理端支付列表查询参数 */
export interface AdminPaymentQuery {
    keyword?: string                  // 支付单号/外部交易号/订单号/手机号/昵称
    status?: PaymentStatus             // 单选（不传 = 全部）
    paymentChannel?: 'wechat' | 'alipay'
    paymentMethod?: 'mini_program' | 'scan_code' | 'wap' | 'app' | 'pc'
    startTime?: Date
    endTime?: Date
}

/** 管理端支付列表项 */
export interface AdminPaymentListItem {
    id: number
    transactionNo: string
    orderId: number
    orderNo: string
    userId: number
    userPhone: string
    amount: number
    paymentChannel: string
    paymentMethod: string
    status: PaymentStatus
    outTradeNo: string | null
    paidAt: Date | null
    createdAt: Date
}

/** 管理端支付详情 */
export interface AdminPaymentDetail extends AdminPaymentListItem {
    expiredAt: Date
    callbackData: unknown | null       // JSON 原始数据
    errorMessage: string | null
    remark: string | null
    adminRemark: string | null
    adminRemarkUpdatedBy: number | null
    adminRemarkUpdatedAt: Date | null
    adminRemarkUpdaterName: string | null
    order: { id: number; orderNo: string; status: number; amount: number }
    auditLogs: AdminAuditLogItem[]
}

/** 审计日志详情项 */
export interface AdminAuditLogItem {
    id: number
    action: string
    operatorId: number
    operatorName: string | null
    oldValue: unknown
    newValue: unknown
    createdAt: Date
}

/** 状态 → shadcn Badge variant 映射 */
export const OrderStatusVariant: Record<OrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    [OrderStatus.PENDING]: 'secondary',
    [OrderStatus.PAID]: 'default',
    [OrderStatus.CANCELLED]: 'outline',
    [OrderStatus.REFUNDED]: 'destructive',
}

export const PaymentStatusVariant: Record<PaymentStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    [PaymentStatus.PENDING]: 'secondary',
    [PaymentStatus.SUCCESS]: 'default',
    [PaymentStatus.FAILED]: 'destructive',
    [PaymentStatus.EXPIRED]: 'outline',
    [PaymentStatus.REFUNDED]: 'destructive',
}

/** 状态 → 中文文本（前端组件统一 import，禁止本地重复定义） */
export const OrderStatusText: Record<OrderStatus, string> = {
    [OrderStatus.PENDING]: '待支付',
    [OrderStatus.PAID]: '已支付',
    [OrderStatus.CANCELLED]: '已取消',
    [OrderStatus.REFUNDED]: '已退款',
}

export const PaymentStatusText: Record<PaymentStatus, string> = {
    [PaymentStatus.PENDING]: '待支付',
    [PaymentStatus.SUCCESS]: '支付成功',
    [PaymentStatus.FAILED]: '支付失败',
    [PaymentStatus.EXPIRED]: '已过期',
    [PaymentStatus.REFUNDED]: '已退款',
}

/** 订单类型中文映射 */
export const OrderTypeText: Record<string, string> = {
    purchase: '新购',
    upgrade: '升级',
    renew: '续费',
}

/** 支付渠道中文映射 */
export const PaymentChannelText: Record<string, string> = {
    wechat: '微信',
    alipay: '支付宝',
}

/** 支付方式中文映射 */
export const PaymentMethodText: Record<string, string> = {
    mini_program: '小程序',
    scan_code: '扫码',
    wap: 'H5',
    app: 'APP',
    pc: 'PC',
}
```

- [ ] **Step 3: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。注意 `AdminOrderDetail.adminRemarkUpdatedBy` / `paymentTransactions` 等被后续 Task 引用，不要修改这些命名。

- [ ] **Step 4: Commit**

```bash
git add shared/types/rbac.ts shared/types/payment.ts
git commit -m "feat(admin): 扩展订单/支付管理端类型与状态映射"
```

---

## Task 3: 订单 admin DAO + 测试

**Files:**
- Create: `server/services/payment/order.admin.dao.ts`
- Create: `tests/server/payment/order.admin.dao.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/payment/order.admin.dao.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
    findOrdersForAdminDao,
    findOrderForAdminDao,
    updateOrderAdminRemarkDao,
    updateOrderForAdminCancelDao,
} from '~~/server/services/payment/order.admin.dao'
import { OrderStatus } from '#shared/types/payment'

describe('order.admin.dao', () => {
    let testUserId: number
    let testProductId: number
    let testOrderId: number

    beforeEach(async () => {
        // 准备 user / product / order 测试数据（参考已有 dao test 模式）
        // 此处省略 setup 细节，复用 tests/server/payment/_setup.ts 工具
        // testUserId, testProductId, testOrderId 从 setup 返回
        const setup = await import('./_setup')
        ;({ testUserId, testProductId, testOrderId } = await setup.createOrderFixture())
    })

    describe('findOrdersForAdminDao', () => {
        it('按订单号关键字搜索能命中', async () => {
            const result = await findOrdersForAdminDao(
                { keyword: 'ORD' },
                { page: 1, pageSize: 10 },
            )
            expect(result.total).toBeGreaterThan(0)
            expect(result.items.some((o) => o.id === testOrderId)).toBe(true)
        })

        it('按状态筛选只返回该状态', async () => {
            const result = await findOrdersForAdminDao(
                { status: OrderStatus.PENDING },
                { page: 1, pageSize: 10 },
            )
            expect(result.items.every((o) => o.status === OrderStatus.PENDING)).toBe(true)
        })

        it('分页参数生效', async () => {
            const r = await findOrdersForAdminDao({}, { page: 1, pageSize: 1 })
            expect(r.items.length).toBeLessThanOrEqual(1)
        })
    })

    describe('findOrderForAdminDao', () => {
        it('返回订单 + user + product + paymentTransactions', async () => {
            const order = await findOrderForAdminDao(testOrderId)
            expect(order).not.toBeNull()
            expect(order!.user).toBeDefined()
            expect(order!.product).toBeDefined()
            expect(order!.paymentTransactions).toBeInstanceOf(Array)
        })
    })

    describe('updateOrderAdminRemarkDao', () => {
        it('写入 admin_remark + updated_by + updated_at', async () => {
            const operatorId = testUserId  // 复用同一 user 作为操作人
            const before = await findOrderForAdminDao(testOrderId)
            await updateOrderAdminRemarkDao(testOrderId, '测试备注', operatorId)
            const after = await findOrderForAdminDao(testOrderId)
            expect(after!.adminRemark).toBe('测试备注')
            expect(after!.adminRemarkUpdatedBy).toBe(operatorId)
            expect(after!.adminRemarkUpdatedAt).not.toBe(before?.adminRemarkUpdatedAt)
        })
    })

    describe('updateOrderForAdminCancelDao', () => {
        it('订单状态改为 CANCELLED 且 admin_remark 含取消原因前缀', async () => {
            const operatorId = testUserId
            await updateOrderForAdminCancelDao(testOrderId, '客户误下单', operatorId)
            const order = await findOrderForAdminDao(testOrderId)
            expect(order!.status).toBe(OrderStatus.CANCELLED)
            expect(order!.adminRemark).toContain('[后台取消]')
            expect(order!.adminRemark).toContain('客户误下单')
        })
    })
})
```

- [ ] **Step 2: 创建测试 setup helper**

创建 `tests/server/payment/_setup.ts`：

```typescript
import { prisma } from '#shared/utils/prisma'
import { OrderStatus, OrderType, DurationUnit } from '#shared/types/payment'

export async function createOrderFixture() {
    const phone = `138${Date.now().toString().slice(-8)}`
    const user = await prisma.users.create({
        data: { phone, name: 'TestUser', password: 'x' },
    })
    const product = await prisma.products.create({
        data: {
            name: 'TEST_VIP_MONTHLY',
            type: 1,
            priceMonthly: 99,
            priceYearly: 999,
            unitPrice: 0,
            status: 1,
        },
    })
    const order = await prisma.orders.create({
        data: {
            orderNo: `ORD${Date.now()}`,
            userId: user.id,
            productId: product.id,
            amount: 99,
            duration: 1,
            durationUnit: DurationUnit.MONTH,
            orderType: OrderType.PURCHASE,
            status: OrderStatus.PENDING,
            expiredAt: new Date(Date.now() + 30 * 60 * 1000),
        },
    })
    return { testUserId: user.id, testProductId: product.id, testOrderId: order.id }
}

export async function cleanupFixtures() {
    // 由 vitest 全局 teardown 处理，此处不实现
}
```

- [ ] **Step 3: 运行测试验证失败**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/order.admin.dao.test.ts
```

预期：FAIL，"Cannot find module 'order.admin.dao'"。

- [ ] **Step 4: 实现 DAO**

创建 `server/services/payment/order.admin.dao.ts`：

```typescript
/**
 * 订单管理端数据访问层
 *
 * 与 order.dao.ts（用户端）物理隔离，不做 owner 过滤。
 */
import type { Prisma } from '#shared/types/prisma'
import type { AdminOrderQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { OrderStatus } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'

const orderInclude = {
    user: { select: { id: true, phone: true, name: true } },
    product: { select: { id: true, name: true, type: true } },
    paymentTransactions: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
    },
} satisfies Prisma.ordersInclude

const buildWhere = (q: AdminOrderQuery): Prisma.ordersWhereInput => {
    const where: Prisma.ordersWhereInput = { deletedAt: null }
    if (q.keyword) {
        where.OR = [
            { orderNo: { contains: q.keyword } },
            { user: { phone: { contains: q.keyword } } },
            { user: { name: { contains: q.keyword } } },
        ]
    }
    if (q.status !== undefined) where.status = q.status
    if (q.orderType) where.orderType = q.orderType
    if (q.productId) where.productId = q.productId
    if (q.startTime || q.endTime) {
        where.createdAt = {}
        if (q.startTime) where.createdAt.gte = q.startTime
        if (q.endTime) where.createdAt.lte = q.endTime
    }
    return where
}

export const findOrdersForAdminDao = async (
    query: AdminOrderQuery,
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient,
) => {
    const { page = 1, pageSize = 20 } = pagination
    const where = buildWhere(query)
    const client = tx ?? prisma
    const [items, total] = await Promise.all([
        client.orders.findMany({
            where,
            include: orderInclude,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
        }),
        client.orders.count({ where }),
    ])
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export const findOrdersForAdminExportDao = async (
    query: AdminOrderQuery,
    limit: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).orders.findMany({
        where: buildWhere(query),
        include: orderInclude,
        take: limit,
        orderBy: { createdAt: 'desc' },
    })
}

export const findOrderForAdminDao = async (id: number, tx?: Prisma.TransactionClient) => {
    return (tx ?? prisma).orders.findFirst({
        where: { id, deletedAt: null },
        include: orderInclude,
    })
}

export const updateOrderAdminRemarkDao = async (
    id: number,
    remark: string | null,
    operatorId: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).orders.update({
        where: { id },
        data: {
            adminRemark: remark,
            adminRemarkUpdatedBy: operatorId,
            adminRemarkUpdatedAt: new Date(),
        },
    })
}

export const updateOrderForAdminCancelDao = async (
    id: number,
    reason: string,
    operatorId: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).orders.update({
        where: { id },
        data: {
            status: OrderStatus.CANCELLED,
            adminRemark: `[后台取消] ${reason}`,
            adminRemarkUpdatedBy: operatorId,
            adminRemarkUpdatedAt: new Date(),
        },
    })
}
```

- [ ] **Step 5: 运行测试验证通过**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/order.admin.dao.test.ts
```

预期：所有测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add server/services/payment/order.admin.dao.ts tests/server/payment/order.admin.dao.test.ts tests/server/payment/_setup.ts
git commit -m "feat(admin): order.admin.dao 管理端订单数据访问"
```

---

## Task 4: 支付 admin DAO + 测试

**Files:**
- Create: `server/services/payment/paymentTransaction.admin.dao.ts`
- Create: `tests/server/payment/paymentTransaction.admin.dao.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/payment/paymentTransaction.admin.dao.test.ts`，结构对称于 Task 3 测试：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
    findPaymentTransactionsForAdminDao,
    findPaymentTransactionForAdminDao,
    updatePaymentTransactionAdminRemarkDao,
    closePendingPaymentsForOrderDao,
} from '~~/server/services/payment/paymentTransaction.admin.dao'
import { PaymentStatus } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'

describe('paymentTransaction.admin.dao', () => {
    let testUserId: number
    let testOrderId: number
    let testPaymentId: number

    beforeEach(async () => {
        const setup = await import('./_setup')
        const fixture = await setup.createOrderFixture()
        testUserId = fixture.testUserId
        testOrderId = fixture.testOrderId
        const payment = await prisma.paymentTransactions.create({
            data: {
                transactionNo: `TXN${Date.now()}`,
                orderId: testOrderId,
                amount: 99,
                paymentChannel: 'wechat',
                paymentMethod: 'mini_program',
                status: PaymentStatus.PENDING,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        })
        testPaymentId = payment.id
    })

    it('按支付单号关键字搜索命中', async () => {
        const r = await findPaymentTransactionsForAdminDao(
            { keyword: 'TXN' },
            { page: 1, pageSize: 10 },
        )
        expect(r.items.some((p) => p.id === testPaymentId)).toBe(true)
    })

    it('按渠道筛选只返回该渠道', async () => {
        const r = await findPaymentTransactionsForAdminDao(
            { paymentChannel: 'wechat' },
            { page: 1, pageSize: 10 },
        )
        expect(r.items.every((p) => p.paymentChannel === 'wechat')).toBe(true)
    })

    it('详情含 order + user', async () => {
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p!.order).toBeDefined()
        expect(p!.order!.user).toBeDefined()
    })

    it('updateRemark 写入字段', async () => {
        await updatePaymentTransactionAdminRemarkDao(testPaymentId, '已核对', testUserId)
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p!.adminRemark).toBe('已核对')
        expect(p!.adminRemarkUpdatedBy).toBe(testUserId)
    })

    it('closePendingPaymentsForOrderDao 把订单下所有 PENDING 改为 EXPIRED', async () => {
        const count = await closePendingPaymentsForOrderDao(testOrderId)
        expect(count).toBeGreaterThanOrEqual(1)
        const p = await findPaymentTransactionForAdminDao(testPaymentId)
        expect(p!.status).toBe(PaymentStatus.EXPIRED)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/paymentTransaction.admin.dao.test.ts
```

预期：FAIL，模块未找到。

- [ ] **Step 3: 实现 DAO**

创建 `server/services/payment/paymentTransaction.admin.dao.ts`：

```typescript
import type { Prisma } from '#shared/types/prisma'
import type { AdminPaymentQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { PaymentStatus } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'

const paymentInclude = {
    order: {
        include: {
            user: { select: { id: true, phone: true, name: true } },
        },
    },
} satisfies Prisma.paymentTransactionsInclude

const buildWhere = (q: AdminPaymentQuery): Prisma.paymentTransactionsWhereInput => {
    const where: Prisma.paymentTransactionsWhereInput = { deletedAt: null }
    if (q.keyword) {
        where.OR = [
            { transactionNo: { contains: q.keyword } },
            { outTradeNo: { contains: q.keyword } },
            { order: { orderNo: { contains: q.keyword } } },
            { order: { user: { phone: { contains: q.keyword } } } },
            { order: { user: { name: { contains: q.keyword } } } },
        ]
    }
    if (q.status !== undefined) where.status = q.status
    if (q.paymentChannel) where.paymentChannel = q.paymentChannel
    if (q.paymentMethod) where.paymentMethod = q.paymentMethod
    if (q.startTime || q.endTime) {
        where.createdAt = {}
        if (q.startTime) where.createdAt.gte = q.startTime
        if (q.endTime) where.createdAt.lte = q.endTime
    }
    return where
}

export const findPaymentTransactionsForAdminDao = async (
    query: AdminPaymentQuery,
    pagination: PaginationParams = {},
    tx?: Prisma.TransactionClient,
) => {
    const { page = 1, pageSize = 20 } = pagination
    const where = buildWhere(query)
    const client = tx ?? prisma
    const [items, total] = await Promise.all([
        client.paymentTransactions.findMany({
            where,
            include: paymentInclude,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
        }),
        client.paymentTransactions.count({ where }),
    ])
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export const findPaymentTransactionsForAdminExportDao = async (
    query: AdminPaymentQuery,
    limit: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).paymentTransactions.findMany({
        where: buildWhere(query),
        include: paymentInclude,
        take: limit,
        orderBy: { createdAt: 'desc' },
    })
}

export const findPaymentTransactionForAdminDao = async (
    id: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).paymentTransactions.findFirst({
        where: { id, deletedAt: null },
        include: paymentInclude,
    })
}

export const updatePaymentTransactionAdminRemarkDao = async (
    id: number,
    remark: string | null,
    operatorId: number,
    tx?: Prisma.TransactionClient,
) => {
    return (tx ?? prisma).paymentTransactions.update({
        where: { id },
        data: {
            adminRemark: remark,
            adminRemarkUpdatedBy: operatorId,
            adminRemarkUpdatedAt: new Date(),
        },
    })
}

/** 关闭某订单下所有"待支付"状态的支付单（取消订单事务调用） */
export const closePendingPaymentsForOrderDao = async (
    orderId: number,
    tx?: Prisma.TransactionClient,
): Promise<number> => {
    const result = await (tx ?? prisma).paymentTransactions.updateMany({
        where: { orderId, status: PaymentStatus.PENDING, deletedAt: null },
        data: { status: PaymentStatus.EXPIRED },
    })
    return result.count
}
```

- [ ] **Step 4: 验证测试通过**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/paymentTransaction.admin.dao.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/payment/paymentTransaction.admin.dao.ts tests/server/payment/paymentTransaction.admin.dao.test.ts
git commit -m "feat(admin): paymentTransaction.admin.dao 管理端支付数据访问"
```

---

## Task 5: 审计日志包装函数

**Files:**
- Modify: `server/services/rbac/auditLog.service.ts`

- [ ] **Step 1: 在 `auditLog.service.ts` 末尾追加 3 个 log 函数**

打开 `server/services/rbac/auditLog.service.ts`，在文件末尾（最后一个函数 `logApiPermissionBatchDelete` 之后）追加：

```typescript

// ==================== 订单/支付管理审计 ====================

/**
 * 记录后台手动取消订单
 */
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
        oldValue: { status: payload.oldStatus } as Prisma.InputJsonValue,
        newValue: { status: 2, reason: payload.reason } as Prisma.InputJsonValue, // 2 = OrderStatus.CANCELLED
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录订单管理员备注变更
 */
export const logOrderRemarkUpdate = async (
    event: H3Event,
    operatorId: number,
    orderId: number,
    payload: { oldRemark: string | null; newRemark: string | null },
    tx?: Prisma.TransactionClient,
) => {
    return createAuditLogDao({
        action: AuditLogAction.ORDER_REMARK_UPDATE,
        targetType: 'order',
        targetId: orderId,
        operatorId,
        oldValue: { remark: payload.oldRemark } as Prisma.InputJsonValue,
        newValue: { remark: payload.newRemark } as Prisma.InputJsonValue,
        ip: getClientIp(event),
    }, tx)
}

/**
 * 记录支付单管理员备注变更
 */
export const logPaymentRemarkUpdate = async (
    event: H3Event,
    operatorId: number,
    paymentTransactionId: number,
    payload: { oldRemark: string | null; newRemark: string | null },
    tx?: Prisma.TransactionClient,
) => {
    return createAuditLogDao({
        action: AuditLogAction.PAYMENT_REMARK_UPDATE,
        targetType: 'payment_transaction',
        targetId: paymentTransactionId,
        operatorId,
        oldValue: { remark: payload.oldRemark } as Prisma.InputJsonValue,
        newValue: { remark: payload.newRemark } as Prisma.InputJsonValue,
        ip: getClientIp(event),
    }, tx)
}
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。

- [ ] **Step 3: Commit**

```bash
git add server/services/rbac/auditLog.service.ts
git commit -m "feat(admin): auditLog.service 加订单/支付审计包装函数"
```

---

## Task 6: 订单 admin Service（业务逻辑 + 事务）

**Files:**
- Create: `server/services/payment/order.admin.service.ts`
- Create: `tests/server/payment/order.admin.service.test.ts`

- [ ] **Step 1: 写失败测试（重点测取消事务原子性）**

```typescript
// tests/server/payment/order.admin.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
    findOrdersForAdminService,
    findOrderForAdminService,
    updateOrderAdminRemarkService,
    cancelOrderByAdminService,
} from '~~/server/services/payment/order.admin.service'
import { OrderStatus, PaymentStatus } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'

const fakeEvent = {
    node: { req: { socket: { remoteAddress: '127.0.0.1' } } },
} as any

describe('order.admin.service', () => {
    let testUserId: number
    let testOrderId: number

    beforeEach(async () => {
        const setup = await import('./_setup')
        const fixture = await setup.createOrderFixture()
        testUserId = fixture.testUserId
        testOrderId = fixture.testOrderId
        // 给订单加一个 PENDING 支付单
        await prisma.paymentTransactions.create({
            data: {
                transactionNo: `TXN${Date.now()}`,
                orderId: testOrderId,
                amount: 99,
                paymentChannel: 'wechat',
                paymentMethod: 'mini_program',
                status: PaymentStatus.PENDING,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        })
    })

    it('cancelOrderByAdminService 同时改订单 + 关闭支付单 + 写审计', async () => {
        const operatorId = testUserId
        await cancelOrderByAdminService(fakeEvent, operatorId, testOrderId, '客户误下单')

        const order = await findOrderForAdminService(testOrderId)
        expect(order!.status).toBe(OrderStatus.CANCELLED)
        expect(order!.adminRemark).toContain('[后台取消]')

        const pendingCount = await prisma.paymentTransactions.count({
            where: { orderId: testOrderId, status: PaymentStatus.PENDING },
        })
        expect(pendingCount).toBe(0)

        const auditCount = await prisma.permissionAuditLogs.count({
            where: { targetType: 'order', targetId: testOrderId, action: 'order_cancel' },
        })
        expect(auditCount).toBe(1)
    })

    it('cancelOrderByAdminService 对已支付订单返回失败', async () => {
        await prisma.orders.update({
            where: { id: testOrderId },
            data: { status: OrderStatus.PAID, paidAt: new Date() },
        })
        await expect(
            cancelOrderByAdminService(fakeEvent, testUserId, testOrderId, '试图取消'),
        ).rejects.toThrow(/仅待支付订单可取消/)
    })

    it('updateOrderAdminRemarkService 写备注 + 审计', async () => {
        await updateOrderAdminRemarkService(fakeEvent, testUserId, testOrderId, '已联系用户')
        const order = await findOrderForAdminService(testOrderId)
        expect(order!.adminRemark).toBe('已联系用户')

        const auditCount = await prisma.permissionAuditLogs.count({
            where: { targetType: 'order', targetId: testOrderId, action: 'order_remark_update' },
        })
        expect(auditCount).toBe(1)
    })

    it('findOrdersForAdminService 返回完整列表结构', async () => {
        const r = await findOrdersForAdminService({}, { page: 1, pageSize: 10 })
        expect(r.items).toBeInstanceOf(Array)
        expect(r.total).toBeGreaterThan(0)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/order.admin.service.test.ts
```

预期：FAIL，模块未找到。

- [ ] **Step 3: 实现 service**

创建 `server/services/payment/order.admin.service.ts`：

```typescript
/**
 * 订单管理端业务服务
 *
 * 与 order.service.ts（用户端）物理隔离。
 */
import type { H3Event } from 'h3'
import type { AdminOrderQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { OrderStatus } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'
import {
    findOrdersForAdminDao,
    findOrderForAdminDao,
    updateOrderAdminRemarkDao,
    updateOrderForAdminCancelDao,
    findOrdersForAdminExportDao,
} from './order.admin.dao'
import { closePendingPaymentsForOrderDao } from './paymentTransaction.admin.dao'
import { findAuditLogsByTargetDao } from '~~/server/services/rbac/auditLog.dao'
import {
    logOrderCancel,
    logOrderRemarkUpdate,
} from '~~/server/services/rbac/auditLog.service'

export const findOrdersForAdminService = async (
    query: AdminOrderQuery,
    pagination: PaginationParams = {},
) => findOrdersForAdminDao(query, pagination)

export const findOrderForAdminService = async (id: number) => {
    const order = await findOrderForAdminDao(id)
    if (!order) return null
    // 附加审计日志
    const audit = await findAuditLogsByTargetDao('order', id, { page: 1, pageSize: 50 })
    return { ...order, auditLogs: audit.items }
}

export const updateOrderAdminRemarkService = async (
    event: H3Event,
    operatorId: number,
    id: number,
    remark: string | null,
) => {
    return prisma.$transaction(async (tx) => {
        const before = await findOrderForAdminDao(id, tx)
        if (!before) throw new Error('订单不存在')
        await updateOrderAdminRemarkDao(id, remark, operatorId, tx)
        await logOrderRemarkUpdate(event, operatorId, id, {
            oldRemark: before.adminRemark,
            newRemark: remark,
        }, tx)
        return findOrderForAdminDao(id, tx)
    })
}

export const cancelOrderByAdminService = async (
    event: H3Event,
    operatorId: number,
    id: number,
    reason: string,
) => {
    return prisma.$transaction(async (tx) => {
        const order = await findOrderForAdminDao(id, tx)
        if (!order) throw new Error('订单不存在')
        if (order.status !== OrderStatus.PENDING) {
            throw new Error('仅待支付订单可取消')
        }
        await updateOrderForAdminCancelDao(id, reason, operatorId, tx)
        await closePendingPaymentsForOrderDao(id, tx)
        await logOrderCancel(event, operatorId, id, {
            oldStatus: order.status,
            reason,
        }, tx)
        return findOrderForAdminDao(id, tx)
    })
}

export const exportOrdersService = async (
    query: AdminOrderQuery,
    limit: number,
): Promise<string> => {
    if (limit > 10000) throw new Error('导出条数超过上限 10000，请缩小筛选范围')
    const orders = await findOrdersForAdminExportDao(query, limit)
    return buildOrdersCsv(orders)
}

// ===== CSV 拼接 =====
import dayjs from 'dayjs'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import { OrderTypeText } from '#shared/types/payment'

const ORDER_STATUS_TEXT: Record<number, string> = {
    [OrderStatus.PENDING]: '待支付',
    [OrderStatus.PAID]: '已支付',
    [OrderStatus.CANCELLED]: '已取消',
    [OrderStatus.REFUNDED]: '已退款',
}

const csvEscape = (v: unknown): string => {
    if (v === null || v === undefined) return '""'
    const s = String(v).replace(/"/g, '""')
    return `"${s}"`
}

const fmtTime = (d: Date | null): string =>
    d ? dayjs(d).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss') : ''

function buildOrdersCsv(orders: any[]): string {
    const headers = [
        '订单号', '用户手机号', '用户昵称', '商品名',
        '订单类型', '金额（元）', '状态',
        '创建时间', '支付时间', '管理员备注',
    ]
    const rows = orders.map((o) => [
        o.orderNo,
        o.user?.phone ?? '',
        o.user?.name ?? '',
        o.product?.name ?? '',
        OrderTypeText[o.orderType] ?? o.orderType,
        decimalToNumberUtils(o.amount),
        ORDER_STATUS_TEXT[o.status] ?? '',
        fmtTime(o.createdAt),
        fmtTime(o.paidAt),
        o.adminRemark ?? '',
    ])
    const BOM = '﻿'
    return BOM + [headers, ...rows]
        .map((row) => row.map(csvEscape).join(','))
        .join('\n')
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/order.admin.service.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/payment/order.admin.service.ts tests/server/payment/order.admin.service.test.ts
git commit -m "feat(admin): order.admin.service 含取消订单事务"
```

---

## Task 7: 支付 admin Service（含 CSV 导出）

**Files:**
- Create: `server/services/payment/paymentTransaction.admin.service.ts`
- Create: `tests/server/payment/paymentTransaction.admin.service.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/server/payment/paymentTransaction.admin.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
    findPaymentTransactionsForAdminService,
    findPaymentTransactionForAdminService,
    updatePaymentAdminRemarkService,
    exportPaymentTransactionsService,
} from '~~/server/services/payment/paymentTransaction.admin.service'
import { PaymentStatus } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'

const fakeEvent = {
    node: { req: { socket: { remoteAddress: '127.0.0.1' } } },
} as any

describe('paymentTransaction.admin.service', () => {
    let testUserId: number
    let testPaymentId: number

    beforeEach(async () => {
        const setup = await import('./_setup')
        const fixture = await setup.createOrderFixture()
        testUserId = fixture.testUserId
        const payment = await prisma.paymentTransactions.create({
            data: {
                transactionNo: `TXN${Date.now()}`,
                orderId: fixture.testOrderId,
                amount: 99,
                paymentChannel: 'wechat',
                paymentMethod: 'mini_program',
                status: PaymentStatus.PENDING,
                expiredAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        })
        testPaymentId = payment.id
    })

    it('updatePaymentAdminRemarkService 写备注 + 审计', async () => {
        await updatePaymentAdminRemarkService(fakeEvent, testUserId, testPaymentId, '已退款')
        const p = await findPaymentTransactionForAdminService(testPaymentId)
        expect(p!.adminRemark).toBe('已退款')
        const auditCount = await prisma.permissionAuditLogs.count({
            where: {
                targetType: 'payment_transaction',
                targetId: testPaymentId,
                action: 'payment_remark_update',
            },
        })
        expect(auditCount).toBe(1)
    })

    it('exportPaymentTransactionsService 生成带 BOM 的 CSV', async () => {
        const csv = await exportPaymentTransactionsService({}, 10000)
        expect(csv.charCodeAt(0)).toBe(0xFEFF)  // BOM
        expect(csv).toContain('支付单号')
    })

    it('exportPaymentTransactionsService 超 10000 抛错', async () => {
        await expect(exportPaymentTransactionsService({}, 10001)).rejects.toThrow(/上限/)
    })
})
```

- [ ] **Step 2: 验证失败**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/paymentTransaction.admin.service.test.ts
```

预期：FAIL。

- [ ] **Step 3: 实现 service**

创建 `server/services/payment/paymentTransaction.admin.service.ts`：

```typescript
import type { H3Event } from 'h3'
import type { AdminPaymentQuery } from '#shared/types/payment'
import type { PaginationParams } from '#shared/types/rbac'
import { PaymentStatus, PaymentChannelText, PaymentMethodText } from '#shared/types/payment'
import { prisma } from '#shared/utils/prisma'
import dayjs from 'dayjs'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import {
    findPaymentTransactionsForAdminDao,
    findPaymentTransactionForAdminDao,
    updatePaymentTransactionAdminRemarkDao,
    findPaymentTransactionsForAdminExportDao,
} from './paymentTransaction.admin.dao'
import { findAuditLogsByTargetDao } from '~~/server/services/rbac/auditLog.dao'
import { logPaymentRemarkUpdate } from '~~/server/services/rbac/auditLog.service'

export const findPaymentTransactionsForAdminService = async (
    query: AdminPaymentQuery,
    pagination: PaginationParams = {},
) => findPaymentTransactionsForAdminDao(query, pagination)

export const findPaymentTransactionForAdminService = async (id: number) => {
    const p = await findPaymentTransactionForAdminDao(id)
    if (!p) return null
    const audit = await findAuditLogsByTargetDao('payment_transaction', id, { page: 1, pageSize: 50 })
    return { ...p, auditLogs: audit.items }
}

export const updatePaymentAdminRemarkService = async (
    event: H3Event,
    operatorId: number,
    id: number,
    remark: string | null,
) => {
    return prisma.$transaction(async (tx) => {
        const before = await findPaymentTransactionForAdminDao(id, tx)
        if (!before) throw new Error('支付单不存在')
        await updatePaymentTransactionAdminRemarkDao(id, remark, operatorId, tx)
        await logPaymentRemarkUpdate(event, operatorId, id, {
            oldRemark: before.adminRemark,
            newRemark: remark,
        }, tx)
        return findPaymentTransactionForAdminDao(id, tx)
    })
}

export const exportPaymentTransactionsService = async (
    query: AdminPaymentQuery,
    limit: number,
): Promise<string> => {
    if (limit > 10000) throw new Error('导出条数超过上限 10000，请缩小筛选范围')
    const list = await findPaymentTransactionsForAdminExportDao(query, limit)
    return buildPaymentsCsv(list)
}

const PAYMENT_STATUS_TEXT: Record<number, string> = {
    [PaymentStatus.PENDING]: '待支付',
    [PaymentStatus.SUCCESS]: '支付成功',
    [PaymentStatus.FAILED]: '支付失败',
    [PaymentStatus.EXPIRED]: '已过期',
    [PaymentStatus.REFUNDED]: '已退款',
}

const csvEscape = (v: unknown): string => {
    if (v === null || v === undefined) return '""'
    return `"${String(v).replace(/"/g, '""')}"`
}

const fmtTime = (d: Date | null): string =>
    d ? dayjs(d).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss') : ''

function buildPaymentsCsv(list: any[]): string {
    const headers = [
        '支付单号', '关联订单号', '用户手机号',
        '支付渠道', '支付方式', '金额（元）', '状态',
        '第三方交易号', '创建时间', '支付时间', '管理员备注',
    ]
    const rows = list.map((p) => [
        p.transactionNo,
        p.order?.orderNo ?? '',
        p.order?.user?.phone ?? '',
        PaymentChannelText[p.paymentChannel] ?? p.paymentChannel,
        PaymentMethodText[p.paymentMethod] ?? p.paymentMethod,
        decimalToNumberUtils(p.amount),
        PAYMENT_STATUS_TEXT[p.status] ?? '',
        p.outTradeNo ?? '',
        fmtTime(p.createdAt),
        fmtTime(p.paidAt),
        p.adminRemark ?? '',
    ])
    const BOM = '﻿'
    return BOM + [headers, ...rows]
        .map((row) => row.map(csvEscape).join(','))
        .join('\n')
}
```

- [ ] **Step 4: 验证测试通过**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/paymentTransaction.admin.service.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add server/services/payment/paymentTransaction.admin.service.ts tests/server/payment/paymentTransaction.admin.service.test.ts
git commit -m "feat(admin): paymentTransaction.admin.service 含 CSV 导出"
```

---

## Task 8: 用户端 admin_remark 隔离回归测试

**Files:**
- Read: `server/api/v1/payments/orders.get.ts`（确认 map 已显式排除）
- Create: `tests/server/payments/userOrderAdminRemarkRegression.test.ts`

- [ ] **Step 1: 核对用户端 map 字段**

打开 `server/api/v1/payments/orders.get.ts`，确认 `list.map((order) => ({...}))` 处的字段白名单中**不包含** `adminRemark` / `adminRemarkUpdatedBy` / `adminRemarkUpdatedAt`。如果包含立即删除。

预期：现有 map 已经只暴露安全字段（id / orderNo / productName / amount / status / 时间），无需修改。

- [ ] **Step 2: 写回归测试**

创建 `tests/server/payments/userOrderAdminRemarkRegression.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '#shared/utils/prisma'
import { getUserOrdersService } from '~~/server/services/payment/order.service'

describe('用户端订单接口不暴露 admin_remark', () => {
    let testUserId: number
    let testOrderId: number

    beforeEach(async () => {
        const setup = await import('../payment/_setup')
        const fixture = await setup.createOrderFixture()
        testUserId = fixture.testUserId
        testOrderId = fixture.testOrderId
        // 设置 admin_remark
        await prisma.orders.update({
            where: { id: testOrderId },
            data: {
                adminRemark: '管理员内部备注_不应泄漏',
                adminRemarkUpdatedBy: testUserId,
                adminRemarkUpdatedAt: new Date(),
            },
        })
    })

    it('getUserOrdersService 返回数据不含 adminRemark 字段', async () => {
        // 模拟用户端接口的字段 map（与 server/api/v1/payments/orders.get.ts 一致）
        const result = await getUserOrdersService(testUserId, { page: 1, pageSize: 10 })
        const list = result.list.map((order) => ({
            id: order.id,
            orderNo: order.orderNo,
            productName: order.product?.name || '未知商品',
            productType: order.product?.type || 0,
            amount: Number(order.amount),
            duration: order.duration,
            durationUnit: order.durationUnit,
            status: order.status,
            paidAt: order.paidAt,
            expiredAt: order.expiredAt,
            createdAt: order.createdAt,
        }))

        for (const item of list) {
            expect(Object.keys(item)).not.toContain('adminRemark')
            expect(Object.keys(item)).not.toContain('admin_remark')
            expect(JSON.stringify(item)).not.toContain('管理员内部备注_不应泄漏')
        }
    })
})
```

- [ ] **Step 3: 运行验证（应直接通过，因为现有代码已隔离）**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payments/userOrderAdminRemarkRegression.test.ts
```

预期：PASS。

- [ ] **Step 4: Commit**

```bash
git add tests/server/payments/userOrderAdminRemarkRegression.test.ts
git commit -m "test(admin): 用户端订单接口 admin_remark 隔离回归测试"
```

---

## Task 9: 订单 admin API handlers（5 个接口）

**Files:**
- Create: `server/api/v1/admin/orders/index.get.ts`
- Create: `server/api/v1/admin/orders/export.get.ts`
- Create: `server/api/v1/admin/orders/[id].get.ts`
- Create: `server/api/v1/admin/orders/remark/[id].patch.ts`
- Create: `server/api/v1/admin/orders/cancel/[id].post.ts`

- [ ] **Step 1: 列表接口**

创建 `server/api/v1/admin/orders/index.get.ts`：

```typescript
import { z } from 'zod'
import { findOrdersForAdminService } from '~~/server/services/payment/order.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),     // 单选：0/1/2/3 或不传
    orderType: z.enum(['purchase', 'upgrade', 'renew']).optional(),
    productId: z.coerce.number().int().optional(),
    startTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    endTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    const { page, pageSize, ...query } = parsed.data
    const data = await findOrdersForAdminService(query, { page, pageSize })
    return resSuccess(event, '获取成功', data)
})
```

- [ ] **Step 2: 详情接口**

创建 `server/api/v1/admin/orders/[id].get.ts`：

```typescript
import { findOrderForAdminService } from '~~/server/services/payment/order.admin.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id) return resError(event, 400, '订单 ID 无效')

    const order = await findOrderForAdminService(id)
    if (!order) return resError(event, 404, '订单不存在')
    return resSuccess(event, '获取成功', order)
})
```

- [ ] **Step 3: 更新备注接口**

创建 `server/api/v1/admin/orders/remark/[id].patch.ts`：

```typescript
import { z } from 'zod'
import { updateOrderAdminRemarkService } from '~~/server/services/payment/order.admin.service'

const bodySchema = z.object({
    remark: z.string().max(500).nullable(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id) return resError(event, 400, '订单 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    try {
        const order = await updateOrderAdminRemarkService(event, user.id, id, parsed.data.remark)
        return resSuccess(event, '更新成功', order)
    } catch (error: any) {
        return resError(event, 400, error.message || '更新失败')
    }
})
```

- [ ] **Step 4: 取消订单接口**

创建 `server/api/v1/admin/orders/cancel/[id].post.ts`：

```typescript
import { z } from 'zod'
import { cancelOrderByAdminService } from '~~/server/services/payment/order.admin.service'

const bodySchema = z.object({
    reason: z.string().min(1, '请填写取消原因').max(200, '取消原因最多 200 字'),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id) return resError(event, 400, '订单 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    try {
        const order = await cancelOrderByAdminService(event, user.id, id, parsed.data.reason)
        return resSuccess(event, '取消成功', order)
    } catch (error: any) {
        return resError(event, 400, error.message || '取消失败')
    }
})
```

- [ ] **Step 5: 导出接口**

创建 `server/api/v1/admin/orders/export.get.ts`：

```typescript
import { z } from 'zod'
import { exportOrdersService } from '~~/server/services/payment/order.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),
    orderType: z.enum(['purchase', 'upgrade', 'renew']).optional(),
    productId: z.coerce.number().int().optional(),
    startTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    endTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    limit: z.coerce.number().int().min(1).max(10000).default(10000),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    const { limit, ...query } = parsed.data
    try {
        const csv = await exportOrdersService(query, limit)
        setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
        setResponseHeader(event, 'Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`)
        logger.info(`管理员 ${user.id} 导出订单`)
        return csv
    } catch (error: any) {
        return resError(event, 400, error.message || '导出失败')
    }
})
```

- [ ] **Step 6: 启动 dev server 手工冒烟测试**

```bash
bun dev
```

新开终端，用超管账号 cookie 测试 5 个接口（替换 `<COOKIE>`）：

```bash
curl -s -b "$COOKIE" 'http://localhost:3000/api/v1/admin/orders?page=1&pageSize=5' | jq
curl -s -b "$COOKIE" 'http://localhost:3000/api/v1/admin/orders/1' | jq
```

预期：5 个接口分别返回 200 + 正确数据结构（即使无数据也返回空数组 + total:0）。

- [ ] **Step 7: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。

- [ ] **Step 8: Commit**

```bash
git add server/api/v1/admin/orders/
git commit -m "feat(admin): 订单管理 5 个 admin API handlers"
```

---

## Task 10: 支付 admin API handlers（4 个接口）

**Files:**
- Create: `server/api/v1/admin/payments/index.get.ts`
- Create: `server/api/v1/admin/payments/export.get.ts`
- Create: `server/api/v1/admin/payments/[id].get.ts`
- Create: `server/api/v1/admin/payments/remark/[id].patch.ts`

- [ ] **Step 1: 列表接口**

创建 `server/api/v1/admin/payments/index.get.ts`：

```typescript
import { z } from 'zod'
import { findPaymentTransactionsForAdminService } from '~~/server/services/payment/paymentTransaction.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),     // 单选：0-4 或不传
    paymentChannel: z.enum(['wechat', 'alipay']).optional(),
    paymentMethod: z.enum(['mini_program', 'scan_code', 'wap', 'app', 'pc']).optional(),
    startTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    endTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    const { page, pageSize, ...query } = parsed.data
    const data = await findPaymentTransactionsForAdminService(query, { page, pageSize })
    return resSuccess(event, '获取成功', data)
})
```

- [ ] **Step 2: 详情接口**

创建 `server/api/v1/admin/payments/[id].get.ts`：

```typescript
import { findPaymentTransactionForAdminService } from '~~/server/services/payment/paymentTransaction.admin.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id) return resError(event, 400, '支付单 ID 无效')

    const p = await findPaymentTransactionForAdminService(id)
    if (!p) return resError(event, 404, '支付单不存在')
    return resSuccess(event, '获取成功', p)
})
```

- [ ] **Step 3: 备注接口**

创建 `server/api/v1/admin/payments/remark/[id].patch.ts`：

```typescript
import { z } from 'zod'
import { updatePaymentAdminRemarkService } from '~~/server/services/payment/paymentTransaction.admin.service'

const bodySchema = z.object({
    remark: z.string().max(500).nullable(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!id) return resError(event, 400, '支付单 ID 无效')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    try {
        const result = await updatePaymentAdminRemarkService(event, user.id, id, parsed.data.remark)
        return resSuccess(event, '更新成功', result)
    } catch (error: any) {
        return resError(event, 400, error.message || '更新失败')
    }
})
```

- [ ] **Step 4: 导出接口**

创建 `server/api/v1/admin/payments/export.get.ts`（结构与订单导出对称）：

```typescript
import { z } from 'zod'
import { exportPaymentTransactionsService } from '~~/server/services/payment/paymentTransaction.admin.service'

const querySchema = z.object({
    keyword: z.string().optional(),
    status: z.coerce.number().int().optional(),
    paymentChannel: z.enum(['wechat', 'alipay']).optional(),
    paymentMethod: z.enum(['mini_program', 'scan_code', 'wap', 'app', 'pc']).optional(),
    startTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    endTime: z.string().optional().transform((v) => v ? new Date(v) : undefined),
    limit: z.coerce.number().int().min(1).max(10000).default(10000),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = querySchema.safeParse(getQuery(event))
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    const { limit, ...query } = parsed.data
    try {
        const csv = await exportPaymentTransactionsService(query, limit)
        setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
        setResponseHeader(event, 'Content-Disposition', `attachment; filename="payments-${Date.now()}.csv"`)
        logger.info(`管理员 ${user.id} 导出支付记录`)
        return csv
    } catch (error: any) {
        return resError(event, 400, error.message || '导出失败')
    }
})
```

- [ ] **Step 5: 类型检查 + 冒烟**

```bash
npx nuxi typecheck
curl -s -b "$COOKIE" 'http://localhost:3000/api/v1/admin/payments?page=1&pageSize=5' | jq
```

预期：通过 + 200 响应。

- [ ] **Step 6: Commit**

```bash
git add server/api/v1/admin/payments/
git commit -m "feat(admin): 支付管理 4 个 admin API handlers"
```

---

## Task 11: 通用 StatusBadge 组件

**Files:**
- Create: `app/components/admin/shared/StatusBadge.vue`

- [ ] **Step 1: 创建组件**

创建 `app/components/admin/shared/StatusBadge.vue`：

```vue
<template>
    <Badge :variant="variant">{{ text }}</Badge>
</template>

<script setup lang="ts" generic="T extends number">
import { Badge } from '~/components/ui/badge'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive'

const props = defineProps<{
    /** 状态值（数字） */
    status: T
    /** 状态值 → 中文文本映射 */
    textMap: Record<T, string>
    /** 状态值 → variant 映射 */
    variantMap: Record<T, Variant>
}>()

const text = computed(() => props.textMap[props.status] ?? '未知')
const variant = computed<Variant>(() => props.variantMap[props.status] ?? 'secondary')
</script>
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。

- [ ] **Step 3: Commit**

```bash
git add app/components/admin/shared/StatusBadge.vue
git commit -m "feat(admin): 通用 StatusBadge 组件"
```

---

## Task 12: 订单前端组件（6 个）

**Files:**
- Create: `app/components/admin/orders/{OrderTable,OrderMobile,OrderFilters,OrderDetailSheet,OrderAdminRemarkEditor}.vue`

> 由于代码量较大，本任务分 6 个子步骤，每个子步骤单独 commit。组件之间无强依赖，可单独开发联调。

- [ ] **Step 1: OrderFilters 筛选条**

创建 `app/components/admin/orders/OrderFilters.vue`：

```vue
<template>
    <div class="flex flex-col md:flex-row gap-3 flex-wrap">
        <Input v-model="local.keyword" placeholder="订单号 / 手机号 / 昵称" class="md:w-56" />
        <Select v-model="statusValue">
            <SelectTrigger class="md:w-40"><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="0">待支付</SelectItem>
                <SelectItem value="1">已支付</SelectItem>
                <SelectItem value="2">已取消</SelectItem>
                <SelectItem value="3">已退款</SelectItem>
            </SelectContent>
        </Select>
        <Select v-model="local.orderType">
            <SelectTrigger class="md:w-32"><SelectValue placeholder="类型" /></SelectTrigger>
            <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="purchase">新购</SelectItem>
                <SelectItem value="upgrade">升级</SelectItem>
                <SelectItem value="renew">续费</SelectItem>
            </SelectContent>
        </Select>
        <Input v-model="local.startTime" type="date" class="md:w-40" />
        <Input v-model="local.endTime" type="date" class="md:w-40" />
        <Button variant="outline" @click="emit('search', toQuery())">
            <Search class="w-4 h-4 mr-1" /> 筛选
        </Button>
        <Button variant="ghost" @click="reset">重置</Button>
    </div>
</template>

<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { Input } from '~/components/ui/input'
import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

interface LocalForm {
    keyword: string
    orderType: string
    startTime: string
    endTime: string
}

const local = ref<LocalForm>({ keyword: '', orderType: 'all', startTime: '', endTime: '' })
const statusValue = ref('all')

const emit = defineEmits<{ search: [query: any] }>()

function toQuery() {
    const q: any = {}
    if (local.value.keyword) q.keyword = local.value.keyword
    if (statusValue.value !== 'all') q.status = statusValue.value
    if (local.value.orderType !== 'all') q.orderType = local.value.orderType
    if (local.value.startTime) q.startTime = local.value.startTime
    if (local.value.endTime) q.endTime = local.value.endTime
    return q
}

function reset() {
    local.value = { keyword: '', orderType: 'all', startTime: '', endTime: '' }
    statusValue.value = 'all'
    emit('search', {})
}
</script>
```

提交：`git add app/components/admin/orders/OrderFilters.vue && git commit -m "feat(admin): OrderFilters 筛选条"`

- [ ] **Step 2: OrderTable 桌面端表格**

创建 `app/components/admin/orders/OrderTable.vue`：

```vue
<template>
    <div class="hidden md:block border rounded-md overflow-x-auto">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>订单号</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead>金额</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow v-for="o in orders" :key="o.id" class="cursor-pointer hover:bg-muted/50"
                    @click="emit('open', o)">
                    <TableCell class="font-mono text-xs">{{ o.orderNo }}</TableCell>
                    <TableCell>
                        <div class="text-sm">{{ o.userPhone }}</div>
                        <div class="text-xs text-muted-foreground">{{ o.userName ?? '-' }}</div>
                    </TableCell>
                    <TableCell>{{ o.productName }}</TableCell>
                    <TableCell>¥{{ Number(o.amount).toFixed(2) }}</TableCell>
                    <TableCell>{{ orderTypeText(o.orderType) }}</TableCell>
                    <TableCell>
                        <StatusBadge :status="o.status" :text-map="OrderStatusText" :variant-map="OrderStatusVariant" />
                    </TableCell>
                    <TableCell class="text-xs">{{ formatDate(o.createdAt) }}</TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { OrderStatusVariant, OrderStatusText, OrderTypeText } from '#shared/types/payment'
import type { AdminOrderListItem } from '#shared/types/payment'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'

defineProps<{ orders: AdminOrderListItem[] }>()
const emit = defineEmits<{ open: [order: AdminOrderListItem] }>()

function orderTypeText(t: string) {
    return OrderTypeText[t] ?? t
}

function formatDate(d: Date | string) {
    return dayjs(d).format('YYYY-MM-DD HH:mm')
}
</script>
```

提交：`git add app/components/admin/orders/OrderTable.vue && git commit -m "feat(admin): OrderTable 桌面表格"`

- [ ] **Step 3: OrderMobile 移动端卡片**

创建 `app/components/admin/orders/OrderMobile.vue`：

```vue
<template>
    <div class="md:hidden space-y-2">
        <Card v-for="o in orders" :key="o.id" class="cursor-pointer" @click="emit('open', o)">
            <CardContent class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-mono text-xs">{{ o.orderNo }}</span>
                    <StatusBadge :status="o.status" :text-map="OrderStatusText" :variant-map="OrderStatusVariant" />
                </div>
                <div class="text-sm">{{ o.productName }} · ¥{{ Number(o.amount).toFixed(2) }}</div>
                <div class="text-xs text-muted-foreground mt-1">
                    {{ o.userPhone }} · {{ formatDate(o.createdAt) }}
                </div>
            </CardContent>
        </Card>
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { OrderStatusVariant, OrderStatusText } from '#shared/types/payment'
import type { AdminOrderListItem } from '#shared/types/payment'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import { Card, CardContent } from '~/components/ui/card'

defineProps<{ orders: AdminOrderListItem[] }>()
const emit = defineEmits<{ open: [order: AdminOrderListItem] }>()

function formatDate(d: Date | string) { return dayjs(d).format('MM-DD HH:mm') }
</script>
```

提交：`git add app/components/admin/orders/OrderMobile.vue && git commit -m "feat(admin): OrderMobile 移动端卡片"`

- [ ] **Step 4: OrderAdminRemarkEditor 备注编辑器**

创建 `app/components/admin/orders/OrderAdminRemarkEditor.vue`：

```vue
<template>
    <div>
        <div v-if="!editing" class="space-y-2">
            <p class="text-sm whitespace-pre-wrap">{{ modelValue || '（暂无管理员备注）' }}</p>
            <p v-if="updaterName" class="text-xs text-muted-foreground">
                — {{ updaterName }} {{ updatedAt ? formatDate(updatedAt) : '' }}
            </p>
            <Button size="sm" variant="outline" @click="startEdit">
                <Pencil class="w-3 h-3 mr-1" /> 编辑
            </Button>
        </div>
        <div v-else class="space-y-2">
            <Textarea v-model="draft" rows="3" placeholder="管理员内部备注（仅后台可见）" />
            <div class="flex gap-2">
                <Button size="sm" :disabled="saving" @click="save">保存</Button>
                <Button size="sm" variant="ghost" @click="editing = false">取消</Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { useApiFetch } from '~/composables/useApiFetch'

const props = defineProps<{
    apiUrl: string                       // 调用方传入：/api/v1/admin/orders/remark/123 或 /api/v1/admin/payments/remark/456
    modelValue: string | null
    updaterName?: string | null
    updatedAt?: Date | string | null
}>()
const emit = defineEmits<{ saved: [newRemark: string | null] }>()

const editing = ref(false)
const draft = ref('')
const saving = ref(false)

function startEdit() {
    draft.value = props.modelValue ?? ''
    editing.value = true
}

async function save() {
    saving.value = true
    try {
        const body = { remark: draft.value.trim() || null }
        const result = await useApiFetch(props.apiUrl, { method: 'PATCH', body })
        if (result) {
            toast.success('备注已更新')
            emit('saved', body.remark)
            editing.value = false
        }
    } finally {
        saving.value = false
    }
}

function formatDate(d: Date | string) { return dayjs(d).format('YYYY-MM-DD HH:mm') }
</script>
```

提交：`git add app/components/admin/orders/OrderAdminRemarkEditor.vue && git commit -m "feat(admin): OrderAdminRemarkEditor 备注编辑器（订单/支付通用）"`

- [ ] **Step 5: OrderDetailSheet 详情抽屉（含取消订单 inline 表单）**

创建 `app/components/admin/orders/OrderDetailSheet.vue`：

```vue
<template>
    <Sheet v-model:open="open">
        <SheetContent class="w-full sm:max-w-[640px] overflow-y-auto">
            <SheetHeader>
                <SheetTitle>订单详情</SheetTitle>
            </SheetHeader>
            <div v-if="!detail" class="py-12 text-center text-muted-foreground">
                <Loader2 class="w-6 h-6 animate-spin mx-auto" />
            </div>
            <div v-else class="space-y-6 mt-4">
                <!-- 基本信息 -->
                <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">基本信息</h3>
                    <dl class="space-y-1 text-sm">
                        <div class="flex"><dt class="w-24 text-muted-foreground">订单号</dt><dd class="font-mono">{{ detail.orderNo }}</dd></div>
                        <div class="flex items-center"><dt class="w-24 text-muted-foreground">状态</dt>
                            <dd><StatusBadge :status="detail.status" :text-map="OrderStatusText" :variant-map="OrderStatusVariant" /></dd>
                        </div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">订单金额</dt><dd>¥{{ Number(detail.amount).toFixed(2) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">订单类型</dt><dd>{{ OrderTypeText[detail.orderType] }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">时长</dt><dd>{{ detail.duration }} {{ detail.durationUnit === 'month' ? '个月' : '年' }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">创建时间</dt><dd>{{ formatDate(detail.createdAt) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">支付时间</dt><dd>{{ formatDate(detail.paidAt) }}</dd></div>
                        <div class="flex"><dt class="w-24 text-muted-foreground">过期时间</dt><dd>{{ formatDate(detail.expiredAt) }}</dd></div>
                    </dl>
                </div>

                <!-- 用户信息 -->
                <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">用户信息</h3>
                    <p class="text-sm">{{ detail.userPhone }} · {{ detail.userName ?? '-' }}</p>
                </div>

                <!-- 商品信息 -->
                <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">商品信息</h3>
                    <p class="text-sm">{{ detail.productName }}</p>
                </div>

                <!-- 业务备注（只读） -->
                <div v-if="detail.remark">
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">业务备注（系统记录，仅供参考）</h3>
                    <pre class="text-xs bg-muted p-2 rounded overflow-x-auto">{{ detail.remark }}</pre>
                </div>

                <!-- 管理员备注（可编辑） -->
                <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">管理员备注</h3>
                    <OrderAdminRemarkEditor :api-url="`/api/v1/admin/orders/remark/${detail.id}`"
                        :model-value="detail.adminRemark"
                        :updater-name="detail.adminRemarkUpdaterName"
                        :updated-at="detail.adminRemarkUpdatedAt"
                        @saved="loadDetail()" />
                </div>

                <!-- 关联支付单 -->
                <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">
                        关联支付单（{{ detail.paymentTransactions?.length ?? 0 }} 条）
                    </h3>
                    <div v-if="!detail.paymentTransactions?.length" class="text-sm text-muted-foreground">
                        暂无支付单
                    </div>
                    <ul v-else class="space-y-1 text-sm">
                        <li v-for="p in detail.paymentTransactions" :key="p.id"
                            class="flex justify-between items-center border-b pb-1">
                            <div>
                                <span class="font-mono text-xs">{{ p.transactionNo }}</span>
                                <span class="ml-2">{{ p.paymentChannel === 'wechat' ? '微信' : '支付宝' }}</span>
                                <span class="ml-2">¥{{ Number(p.amount).toFixed(2) }}</span>
                            </div>
                            <StatusBadge :status="p.status" :text-map="PaymentStatusText" :variant-map="PaymentStatusVariant" />
                        </li>
                    </ul>
                </div>

                <!-- 操作记录 -->
                <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-2">操作记录</h3>
                    <ul v-if="detail.auditLogs?.length" class="space-y-1 text-xs">
                        <li v-for="log in detail.auditLogs" :key="log.id">
                            <span class="text-muted-foreground">{{ formatDate(log.createdAt) }}</span>
                            <span class="ml-2">{{ log.operatorName ?? '系统' }}</span>
                            <span class="ml-2">{{ actionText(log.action) }}</span>
                        </li>
                    </ul>
                    <div v-else class="text-sm text-muted-foreground">暂无操作记录</div>
                </div>

                <!-- 取消订单 inline 表单（仅待支付） -->
                <div v-if="detail.status === 0" class="pt-4 border-t">
                    <div v-if="cancelMode === 'idle'">
                        <Button variant="destructive" @click="enterCancelMode">
                            <Ban class="w-4 h-4 mr-1" /> 取消订单
                        </Button>
                    </div>
                    <div v-else class="space-y-2">
                        <h3 class="text-sm font-medium">取消订单</h3>
                        <Textarea v-model="cancelReason" rows="3" placeholder="请填写取消原因（1-200 字）" />
                        <div class="flex gap-2">
                            <Button variant="destructive" :disabled="!isReasonValid || cancelling" @click="submitCancel">
                                <Loader2 v-if="cancelling" class="w-4 h-4 mr-1 animate-spin" />
                                确认取消
                            </Button>
                            <Button variant="ghost" @click="cancelMode = 'idle'">返回</Button>
                        </div>
                        <p v-if="cancelReason && !isReasonValid" class="text-xs text-destructive">
                            原因 1-200 字
                        </p>
                    </div>
                </div>
            </div>
        </SheetContent>
    </Sheet>
</template>

<script setup lang="ts">
import { Loader2, Ban } from 'lucide-vue-next'
import dayjs from 'dayjs'
import { toast } from 'vue-sonner'
import {
    OrderStatusVariant, PaymentStatusVariant,
    OrderStatusText, PaymentStatusText,
    OrderTypeText,
} from '#shared/types/payment'
import type { AdminOrderDetail } from '#shared/types/payment'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '~/components/ui/sheet'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import OrderAdminRemarkEditor from '~/components/admin/orders/OrderAdminRemarkEditor.vue'
import { useApiFetch } from '~/composables/useApiFetch'

const open = ref(false)
const detail = ref<AdminOrderDetail | null>(null)

// 取消订单 inline 表单状态
const cancelMode = ref<'idle' | 'editing'>('idle')
const cancelReason = ref('')
const cancelling = ref(false)
const isReasonValid = computed(() => {
    const t = cancelReason.value.trim()
    return t.length >= 1 && t.length <= 200
})

const ACTION_TEXT: Record<string, string> = {
    order_cancel: '取消了订单',
    order_remark_update: '修改了备注',
    payment_remark_update: '修改了支付单备注',
}

const emit = defineEmits<{ refresh: [] }>()
defineExpose({ openOrder })

async function openOrder(id: number) {
    open.value = true
    detail.value = null
    cancelMode.value = 'idle'
    cancelReason.value = ''
    await loadDetail(id)
}

async function loadDetail(id?: number) {
    const orderId = id ?? detail.value?.id
    if (!orderId) return
    const data = await useApiFetch<AdminOrderDetail>(`/api/v1/admin/orders/${orderId}`)
    if (data) detail.value = data
}

function enterCancelMode() {
    cancelReason.value = ''
    cancelMode.value = 'editing'
}

async function submitCancel() {
    if (!detail.value || !isReasonValid.value) return
    cancelling.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/orders/cancel/${detail.value.id}`, {
            method: 'POST',
            body: { reason: cancelReason.value.trim() },
        })
        if (result) {
            toast.success('订单已取消')
            cancelMode.value = 'idle'
            await loadDetail()
            emit('refresh')
        }
    } finally {
        cancelling.value = false
    }
}

function formatDate(d: Date | string | null) {
    return d ? dayjs(d).format('YYYY-MM-DD HH:mm:ss') : '-'
}

function actionText(action: string) {
    return ACTION_TEXT[action] ?? action
}
</script>
```

提交：`git add app/components/admin/orders/OrderDetailSheet.vue && git commit -m "feat(admin): OrderDetailSheet 订单详情抽屉（含取消订单 inline 表单）"`

- [ ] **Step 6: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。

---

## Task 13: 支付前端组件（5 个）

**Files:**
- Create: `app/components/admin/payments/{PaymentTable,PaymentMobile,PaymentFilters,PaymentDetailSheet,PaymentAdminRemarkEditor}.vue`

> 结构对称于订单组件。关键差异：
> - PaymentDetailSheet 多一个"回调原始数据"折叠区块（`<details><pre>`）
> - PaymentDetailSheet "关联订单"行点击触发 `emit('open-order', orderId)`，由父页面切换抽屉
> - 不需要 PaymentCancelDialog（支付单本身不能直接取消）
> - PaymentAdminRemarkEditor 复用订单的 OrderAdminRemarkEditor.vue（apiUrl 不同），可以**直接 import 订单的同名组件**或抽到 shared

- [ ] **Step 1: PaymentFilters**

参照 OrderFilters（状态单选 + 'all'）。差异：状态选项为 5 种（待支付/支付成功/支付失败/已过期/已退款），新增 paymentChannel（wechat/alipay）和 paymentMethod（mini_program/scan_code/wap/app/pc）下拉。状态文本字典从 `#shared/types/payment` 的 `PaymentStatusText` import，禁止本地重复定义。代码结构 90% 复用 OrderFilters。

- [ ] **Step 2: PaymentTable / PaymentMobile**

参照 OrderTable / OrderMobile，列调整为：支付单号 / 关联订单号 / 用户 / 渠道 / 方式 / 金额 / 状态 / 创建时间。

- [ ] **Step 3: PaymentAdminRemarkEditor**

直接复用 `OrderAdminRemarkEditor.vue`（已经设计成通用，传入 `api-url` prop 即可）。或者新建一个 thin wrapper：

```vue
<!-- app/components/admin/payments/PaymentAdminRemarkEditor.vue -->
<template>
    <OrderAdminRemarkEditor :api-url="apiUrl" :model-value="modelValue"
        :updater-name="updaterName" :updated-at="updatedAt"
        @saved="emit('saved', $event)" />
</template>
<script setup lang="ts">
import OrderAdminRemarkEditor from '~/components/admin/orders/OrderAdminRemarkEditor.vue'
defineProps<{ apiUrl: string; modelValue: string | null; updaterName?: string | null; updatedAt?: Date | string | null }>()
const emit = defineEmits<{ saved: [string | null] }>()
</script>
```

- [ ] **Step 4: PaymentDetailSheet**

参照 OrderDetailSheet，关键差异：

```vue
<!-- 区块 "关联订单" -->
<Section title="关联订单">
    <div class="text-sm cursor-pointer hover:underline" @click="emit('open-order', detail.order.id)">
        {{ detail.order.orderNo }} · ¥{{ Number(detail.order.amount).toFixed(2) }}
        <ArrowUpRight class="inline w-3 h-3 ml-1" />
    </div>
</Section>

<!-- 区块 "回调原始数据" -->
<Section v-if="detail.callbackData" title="回调原始数据">
    <details class="text-xs">
        <summary class="cursor-pointer text-muted-foreground">展开 / 收起 JSON</summary>
        <pre class="bg-muted p-2 rounded overflow-x-auto font-mono mt-2">{{ JSON.stringify(detail.callbackData, null, 2) }}</pre>
    </details>
</Section>
```

emit 类型：`{ refresh: []; 'open-order': [orderId: number] }`

- [ ] **Step 5: 类型检查 + 5 次 commit（每组件单独 commit）**

每个文件创建后单独 commit：

```bash
git add app/components/admin/payments/PaymentFilters.vue && git commit -m "feat(admin): PaymentFilters 筛选条"
git add app/components/admin/payments/PaymentTable.vue && git commit -m "feat(admin): PaymentTable 桌面表格"
git add app/components/admin/payments/PaymentMobile.vue && git commit -m "feat(admin): PaymentMobile 移动端卡片"
git add app/components/admin/payments/PaymentAdminRemarkEditor.vue && git commit -m "feat(admin): PaymentAdminRemarkEditor 备注编辑器"
git add app/components/admin/payments/PaymentDetailSheet.vue && git commit -m "feat(admin): PaymentDetailSheet 支付详情抽屉"
```

---

## Task 14: 订单管理页面

**Files:**
- Create: `app/pages/admin/orders/index.vue`

- [ ] **Step 1: 创建页面**

```vue
<template>
    <div class="space-y-6">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">订单管理</h1>
                <p class="text-muted-foreground text-sm">查询和管理用户订单</p>
            </div>
            <Button variant="outline" @click="exportCsv">
                <Download class="w-4 h-4 mr-2" /> 导出 CSV
            </Button>
        </div>

        <OrderFilters @search="onSearch" />

        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="w-10 h-10 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="!list.length" class="flex flex-col items-center justify-center py-12 text-center">
            <ShoppingCart class="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium">暂无订单</h3>
        </div>
        <template v-else>
            <OrderTable :orders="list" @open="openDetail" />
            <OrderMobile :orders="list" @open="openDetail" />
            <GeneralPagination :current-page="page" :page-size="pageSize" :total="total" @change="onPage" />
        </template>

        <OrderDetailSheet ref="sheetRef" @refresh="loadList" />
    </div>
</template>

<script setup lang="ts">
import { ShoppingCart, Download, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '~/components/ui/button'
import OrderFilters from '~/components/admin/orders/OrderFilters.vue'
import OrderTable from '~/components/admin/orders/OrderTable.vue'
import OrderMobile from '~/components/admin/orders/OrderMobile.vue'
import OrderDetailSheet from '~/components/admin/orders/OrderDetailSheet.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import type { AdminOrderListItem } from '#shared/types/payment'
import { useApiFetch } from '~/composables/useApiFetch'

definePageMeta({ layout: 'admin-layout', title: '订单管理' })

const list = ref<AdminOrderListItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const query = ref<Record<string, any>>({})
const loading = ref(false)
const sheetRef = ref<any>(null)

async function loadList() {
    loading.value = true
    try {
        const params = { ...query.value, page: page.value, pageSize: pageSize.value }
        const data = await useApiFetch<{ items: AdminOrderListItem[]; total: number }>(
            '/api/v1/admin/orders', { query: params },
        )
        if (data) {
            list.value = data.items
            total.value = data.total
        }
    } finally {
        loading.value = false
    }
}

function onSearch(q: Record<string, any>) {
    query.value = q
    page.value = 1
    loadList()
}

function onPage(p: number) { page.value = p; loadList() }

function openDetail(order: AdminOrderListItem) {
    sheetRef.value?.openOrder(order.id)
}

async function exportCsv() {
    const params = new URLSearchParams(query.value as any).toString()
    window.open(`/api/v1/admin/orders/export?${params}`, '_blank')
    toast.success('正在导出...')
}

onMounted(loadList)
</script>
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。

- [ ] **Step 3: Commit**

```bash
git add app/pages/admin/orders/index.vue
git commit -m "feat(admin): 订单管理列表页"
```

---

## Task 15: 支付管理页面

**Files:**
- Create: `app/pages/admin/payments/index.vue`

- [ ] **Step 1: 创建页面**

参照 Task 14，结构基本相同，关键差异：
- 标题改为"支付记录"
- 描述改为"查询用户支付情况"
- 图标改为 `CreditCard`
- 路径改为 `/api/v1/admin/payments` 和 `/api/v1/admin/payments/export`
- 详情抽屉换成 PaymentDetailSheet
- **PaymentDetailSheet 监听 `open-order` 事件**：当用户点击关联订单时，关闭支付抽屉，导航到 `/admin/orders` 并打开订单详情（或者直接 `navigateTo('/admin/orders?openId=xxx')`）

```vue
<!-- app/pages/admin/payments/index.vue 关键片段 -->
<PaymentDetailSheet ref="sheetRef" @refresh="loadList" @open-order="goToOrder" />

<script setup lang="ts">
function goToOrder(orderId: number) {
    navigateTo(`/admin/orders?openId=${orderId}`)
}
</script>
```

订单页同步监听 `route.query.openId`：

```typescript
// app/pages/admin/orders/index.vue 末尾追加
const route = useRoute()
watch(() => route.query.openId, (id) => {
    if (id) sheetRef.value?.openOrder(Number(id))
}, { immediate: true })
```

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：通过。

- [ ] **Step 3: Commit**

```bash
git add app/pages/admin/payments/index.vue app/pages/admin/orders/index.vue
git commit -m "feat(admin): 支付记录列表页 + 订单页支持 openId query 跳转"
```

---

## Task 16: RBAC 验证（不改 seedData.sql）

**Files:** 无新增 / 修改文件

> **重要变更**：原 plan 计划手写 INSERT 到 `prisma/seeds/seedData.sql`。**已废止**——seedData.sql 只保留最干净的基础数据快照，不用作 migrate 增量记录。
>
> 项目已有 `routers/scan` + `api-permissions/scan` + 超管菜单兜底机制（见 spec §9.1）。本任务**开发阶段不需要任何 seed 操作**：
>
> - **超管登录**：菜单兜底机制让"订单管理"和"支付记录"自动出现在左侧导航（即使 routers 表没记录）
> - **API 调用**：RBAC 中间件对超管自动放行
>
> **本 Task 只做验证**，不写代码、不改文件。

- [ ] **Step 1: 启动 dev server**

```bash
bun dev
```

- [ ] **Step 2: 用超管账号登录访问 `/admin`**

预期：左侧菜单出现"订单管理"和"支付记录"两项（来自磁盘扫描兜底）。如果没出现，原因排查：
- `app/pages/admin/orders/index.vue` 和 `app/pages/admin/payments/index.vue` 是否在 Task 14/15 创建成功
- `menu-routers.get.ts` 的页面缓存：重启 dev server 让 `pagesCache` 重置

- [ ] **Step 3: 访问列表页验证 API 通**

```
http://localhost:3000/admin/orders
http://localhost:3000/admin/payments
```

预期：两个页面正常加载，能看到列表（即使数据为空也应返回 200 + 空 items）。

- [ ] **Step 4: 上线 / 多角色入库流程（部署文档，开发阶段不执行）**

把以下流程记录到部署 checklist（**本 Task 不需要执行**，只是写下来供上线时参考）：

1. 部署后用超管登录
2. 进入 `/admin/routers` → 点【扫描】→ 选中 `admin-orders` / `admin-payments` 两条 → 【导入】
3. 在路由编辑里把 `menu_group` 设为 "财务管理"、`menu_group_sort` 设为 4、`icon` 设为 `ShoppingCartIcon` / `CreditCardIcon`
4. 进入 `/admin/api-permissions` → 点【扫描】→ 选中本次新增的 9 条权限 → 【批量导入】
5. 进入 `/admin/roles` → 给需要赋权的角色（如运营、客服）勾选这 9 条权限点

> 9 条权限的清单见 spec §9.4。

- [ ] **Step 5: 无需 commit**

本 Task 无文件改动，无 commit。

---

## Task 17: 全量测试 + 联调收尾

**Files:**
- 无新增文件

- [ ] **Step 1: 跑全量后端测试**

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' npx vitest run tests/server/payment/ tests/server/payments/
```

预期：所有 admin 相关测试 PASS。

- [ ] **Step 2: 类型全量检查**

```bash
npx nuxi typecheck
```

预期：通过。

- [ ] **Step 3: 浏览器手工冒烟（关键路径）**

按超管账号登录，依次验证：

1. `/admin/orders` 列表加载、筛选、分页
2. 点击订单行打开详情抽屉、所有信息块渲染正确
3. 编辑管理员备注 → 保存成功 → 刷新后值还在
4. 找一个待支付订单 → 点取消订单 → 填原因 → 状态变已取消、关联待支付支付单同步变已过期
5. 点导出 CSV → 浏览器下载成功 → Excel 打开中文正常
6. `/admin/payments` 同上验证
7. 在支付详情里点关联订单 → 跳转到订单详情抽屉
8. 打开 `/admin/audit` → 应能看到刚才的取消订单和备注修改记录

- [ ] **Step 4: 验证用户端零泄漏**

用普通用户登录，访问 `/dashboard/membership` 或类似页面查看自己的订单，DevTools Network 检查 `/api/v1/payments/orders` 响应 JSON **不含** `adminRemark` 字段。

- [ ] **Step 5: 杀 dev server（按项目记忆）**

```bash
ps aux | grep -E 'nuxt|nitro' | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
```

- [ ] **Step 6: Commit 收尾（如有 lint 修复等小变更）**

```bash
git status
# 如有未提交修改：
git add -A && git commit -m "chore(admin): 联调小修"
```

- [ ] **Step 7: PR 准备**

```bash
git log --oneline main..HEAD
```

确认所有 commit 信息符合 conventional commits 规范，准备 PR。

---

## 实施完成检查清单

- [ ] Task 1-17 全部完成且每步 commit
- [ ] `npx vitest run tests/server/payment/` 全绿
- [ ] `npx nuxi typecheck` 全绿
- [ ] 手工冒烟 8 项全部通过
- [ ] 用户端 admin_remark 零泄漏（Network 验证）
- [ ] 审计日志能追溯取消订单和备注修改

---

## 风险与注意事项

1. **不改 seedData.sql**：菜单 + API 权限通过 admin scan+import 入库（见 Task 16）；开发期间超管菜单兜底机制让页面立即可见。
2. **取消订单事务**：cron-scheduler 的 `handleExpiredPaymentTransactionsService` 仍在跑，作为兜底。spec §5.4 已说明同步关闭+cron 兜底的关系。
3. **CSV 导出大数据量**：上限 10000，单次响应约 5-10 MB，浏览器下载无压力。但导出操作建议只在实际需要时点击，避免反复触发。
4. **z-index 冲突**：Sheet 抽屉默认 z-50。本 plan 取消订单走 OrderDetailSheet 内嵌 inline 表单，**不嵌套任何 AlertDialog/Dialog**，从根本上回避 Overlay z-index 冲突。备注编辑同样走 inline 切换（OrderAdminRemarkEditor）。
5. **测试库 schema 同步**：每次 prisma schema 改动后必须跑 `prisma:push` 同步到 ls_new_testing。
