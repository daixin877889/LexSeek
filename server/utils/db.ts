import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'

const prismaClientSingleton = () => {
    // Fix: Set PG session timezone to UTC via connection options
    // @prisma/adapter-pg sends Date values as UTC strings without timezone suffix,
    // and PG interprets these in the session timezone. By setting TimeZone=UTC,
    // PG treats the bare timestamps as UTC, ensuring correct storage and retrieval.
    // Related: https://github.com/prisma/prisma/issues/26786
    const pool = new PrismaPg({
        connectionString: process.env.DATABASE_URL!,
        options: '-c TimeZone=UTC',
    })
    return new PrismaClient({ adapter: pool })
}

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClientSingleton | undefined
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
