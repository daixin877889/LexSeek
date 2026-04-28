/**
 * 兼容性 shim
 *
 * 历史上本文件作为 vitest setupFiles，注入 globalThis.prisma / logger / 14 个枚举常量。
 * 现已迁移到 tests/_infra/worker-setup.ts（每个 worker 连接独立的 ls_test_w<id> 数据库）。
 *
 * 仅保留 mockLogger 的 re-export 以兼容 14 个仍 import 它的测试文件。
 * 后续可批量改这些 import 路径并彻底删除本 shim。
 */
export { mockLogger } from '../../_infra/worker-setup'
