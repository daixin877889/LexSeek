import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import { buildRemap, type Remap } from './idRemap'
import { warn } from './logger'

/** benefits 重命名：旧 name → 新 code（新项目把 diskSpace 改名为 storage_space） */
const BENEFIT_RENAME: Record<string, string> = { diskSpace: 'storage_space' }

export interface ConfigRemaps {
  caseTypes: Remap
  membershipLevels: Remap
  products: Remap
  nodes: Remap
  pointConsumptionItems: Remap
  benefits: Remap
}

/** 读旧+新配置表，按 name 构建全部重映射；打印失配项 */
export async function loadConfigRemaps(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
): Promise<ConfigRemaps> {
  const byName = (r: { name: string }) => r.name

  const caseTypes = buildRemap(
    await legacy.caseType.findMany({ select: { id: true, name: true } }),
    await next.caseTypes.findMany({ select: { id: true, name: true } }),
    byName,
  )
  const membershipLevels = buildRemap(
    await legacy.membershipLevels.findMany({ select: { id: true, name: true } }),
    await next.membershipLevels.findMany({ select: { id: true, name: true } }),
    byName,
  )
  const products = buildRemap(
    await legacy.products.findMany({ select: { id: true, name: true } }),
    await next.products.findMany({ select: { id: true, name: true } }),
    byName,
  )
  // 旧 analysis_modules 的 name → 新 nodes 的 name
  const nodes = buildRemap(
    await legacy.analysisModules.findMany({ select: { id: true, name: true } }),
    await next.nodes.findMany({ select: { id: true, name: true } }),
    byName,
  )
  // 旧 point_consumption_items.name 是 code 串，对应新表的 key（非 name）
  const newPci = await next.pointConsumptionItems.findMany({ select: { id: true, key: true } })
  const pointConsumptionItems = buildRemap(
    await legacy.pointConsumptionItems.findMany({ select: { id: true, name: true } }),
    newPci.filter((r): r is { id: number; key: string } => r.key != null).map(r => ({ id: r.id, name: r.key })),
    byName,
  )
  // 旧 benefits.name 是 code 串、对应新表的 code；diskSpace 在新库重命名为 storage_space
  const benefits = buildRemap(
    (await legacy.benefits.findMany({ select: { id: true, name: true } }))
      .map(r => ({ id: r.id, name: BENEFIT_RENAME[r.name] ?? r.name })),
    (await next.benefits.findMany({ select: { id: true, code: true } })).map(r => ({ id: r.id, name: r.code })),
    byName,
  )

  const remaps = { caseTypes, membershipLevels, products, nodes, pointConsumptionItems, benefits }
  for (const [name, r] of Object.entries(remaps)) {
    const unmatched = r.unmatchedOldIds()
    if (unmatched.length > 0) {
      warn(`[idRemap] ${name} 有 ${unmatched.length} 个旧 ID 在新库无对应：${unmatched.join(',')}`)
    }
  }
  return remaps
}
