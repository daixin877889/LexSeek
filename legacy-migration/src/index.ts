import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { createLegacyClient, createNewClient } from './clients'
import { loadConfig } from './config'
import { log, logError } from './logger'
import { runFullMigration } from './orchestrator'
import { runPreflight } from './preflight'

async function cmdPreflight(): Promise<void> {
  const cfg = loadConfig()
  const legacy = createLegacyClient(cfg.legacyDatabaseUrl)
  const next = createNewClient(cfg.newDatabaseUrl)
  try {
    const results = await runPreflight(legacy, next)
    const reportPath = 'legacy-migration/reports/preflight.json'
    writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8')
    log(`扫描报告已写入 ${reportPath}`)
  } finally {
    await legacy.$disconnect()
    await next.$disconnect()
  }
}

async function cmdMigrate(): Promise<void> {
  const cfg = loadConfig()
  const adminRoleId = Number(process.env.MIGRATION_ADMIN_ROLE_ID ?? 0)
  if (!adminRoleId) throw new Error('缺少 MIGRATION_ADMIN_ROLE_ID（新库基础 admin 角色的 id）')
  const legacy = createLegacyClient(cfg.legacyDatabaseUrl)
  const next = createNewClient(cfg.newDatabaseUrl)
  try {
    await runFullMigration(legacy, next, cfg, adminRoleId)
  } finally {
    await legacy.$disconnect()
    await next.$disconnect()
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2]
  switch (cmd) {
    case 'preflight':
      await cmdPreflight()
      break
    case 'migrate':
      await cmdMigrate()
      break
    default:
      logError(`未知命令：${cmd ?? '(空)'}。可用命令：preflight、migrate`)
      process.exitCode = 1
  }
}

main().catch(e => {
  logError((e as Error).stack ?? String(e))
  process.exitCode = 1
})
