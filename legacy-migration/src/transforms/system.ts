import type { LSystemConfig } from '../legacyTypes'

/** §8.3 system_configs：结构两边一致，一对一直拷（旧 createdAt/updatedAt 必填） */
export function transformSystemConfig(o: LSystemConfig) {
  return {
    id: o.id,
    configGroup: o.configGroup,
    key: o.key,
    value: o.value,
    description: o.description,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
