import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as NewPrismaClient } from '../../generated/prisma/client'
import { PrismaClient as LegacyPrismaClient } from '../legacy-client/client'

/** 新库 client（写入目标） */
export function createNewClient(url: string): NewPrismaClient {
  const adapter = new PrismaPg({ connectionString: url, options: '-c TimeZone=UTC' })
  return new NewPrismaClient({ adapter })
}

/** 旧库 client（只读数据源） */
export function createLegacyClient(url: string): LegacyPrismaClient {
  const adapter = new PrismaPg({ connectionString: url, options: '-c TimeZone=UTC' })
  return new LegacyPrismaClient({ adapter })
}

export type { LegacyPrismaClient, NewPrismaClient }
