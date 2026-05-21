import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.LEGACY_DATABASE_URL
    delete process.env.DATABASE_URL
    delete process.env.MIGRATION_BATCH_SIZE
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('缺少 LEGACY_DATABASE_URL 时抛错', () => {
    process.env.DATABASE_URL = 'postgresql://new'
    expect(() => loadConfig()).toThrow(/LEGACY_DATABASE_URL/)
  })

  it('两个连接串齐全时返回配置，批大小有默认值', () => {
    process.env.LEGACY_DATABASE_URL = 'postgresql://old'
    process.env.DATABASE_URL = 'postgresql://new'
    const cfg = loadConfig()
    expect(cfg.legacyDatabaseUrl).toBe('postgresql://old')
    expect(cfg.newDatabaseUrl).toBe('postgresql://new')
    expect(cfg.batchSize).toBe(800)
    expect(cfg.failureRateThreshold).toBe(0.05)
  })
})
