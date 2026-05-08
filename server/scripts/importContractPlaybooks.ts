/**
 * 合同审查清单要点 一次性导入脚本
 *
 * 数据来源：prisma/seeds/contractPlaybooks.json（由桌面 Excel「合同审查要点清单.xlsx」转换生成）
 *
 * 行为：
 *  1. TRUNCATE contract_playbooks（重置自增 id）
 *  2. 按 fixture 顺序批量 INSERT
 *  3. 校验 (contractType, code) 唯一与字段长度
 *
 * 幂等：每次重跑都先 TRUNCATE 再写入，因此可任意重复执行。
 *
 * 用法：
 *   npx tsx server/scripts/importContractPlaybooks.ts
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { prisma } from '~~/server/utils/db'
import {
    CONTRACT_TYPE_OPTIONS,
    SUBTYPE_TO_CATEGORY,
} from '#shared/types/contract'

interface PlaybookSeed {
    contractType: string
    code: string
    title: string
    defaultLevel: 'high' | 'medium' | 'low'
    stancePreference: 'strict' | 'balanced' | 'lenient'
    checkContent: string
    legalBasis: string | null
    suggestion: string | null
}

const FIXTURE_PATH = resolve(process.cwd(), 'prisma/seeds/contractPlaybooks.json')

function loadFixture(): PlaybookSeed[] {
    const raw = readFileSync(FIXTURE_PATH, 'utf-8')
    const data = JSON.parse(raw) as PlaybookSeed[]
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error(`fixture 为空或非数组: ${FIXTURE_PATH}`)
    }
    return data
}

function validate(seeds: PlaybookSeed[]): void {
    const validTypes = new Set<string>(CONTRACT_TYPE_OPTIONS)
    const seenKeys = new Set<string>()
    const errors: string[] = []

    for (const s of seeds) {
        if (!validTypes.has(s.contractType)) {
            errors.push(`未在 CONTRACT_TYPE_OPTIONS 中的合同类型: ${s.contractType}`)
        }
        if (!SUBTYPE_TO_CATEGORY[s.contractType]) {
            errors.push(`合同类型未挂大类: ${s.contractType}`)
        }
        const key = `${s.contractType}::${s.code}`
        if (seenKeys.has(key)) errors.push(`重复 (contractType, code): ${key}`)
        seenKeys.add(key)

        if (s.code.length > 20) errors.push(`code 超长 ${s.code.length}: ${s.code}`)
        if (!/^[a-z0-9_]+$/.test(s.code)) errors.push(`code 含非法字符: ${s.code}`)
        if (s.title.length > 30) errors.push(`title 超长 ${s.title.length}: ${s.title}`)
        if (s.checkContent.length > 500) errors.push(`checkContent 超长 ${s.checkContent.length}: ${s.title}`)
        if (s.legalBasis && s.legalBasis.length > 300) errors.push(`legalBasis 超长 ${s.legalBasis.length}: ${s.title}`)
        if (s.suggestion && s.suggestion.length > 500) errors.push(`suggestion 超长 ${s.suggestion.length}: ${s.title}`)
    }

    if (errors.length) {
        console.error('校验失败：')
        for (const e of errors) console.error('  -', e)
        throw new Error(`fixture 校验失败，共 ${errors.length} 处问题`)
    }
}

async function main() {
    console.log('合同审查清单要点 导入脚本启动')
    const seeds = loadFixture()
    console.log(`fixture 加载: ${seeds.length} 条`)

    validate(seeds)
    console.log('校验通过')

    // 统计 fixture 内分布
    const byType = new Map<string, number>()
    for (const s of seeds) byType.set(s.contractType, (byType.get(s.contractType) ?? 0) + 1)
    console.log(`涵盖 ${byType.size} 种合同类型`)

    // 旧数据快照
    const before = await prisma.contractPlaybooks.count()
    console.log(`清空前 contract_playbooks 行数: ${before}`)

    await prisma.$executeRawUnsafe('TRUNCATE TABLE contract_playbooks RESTART IDENTITY')
    console.log('旧数据已 TRUNCATE')

    const inserted = await prisma.contractPlaybooks.createMany({
        data: seeds.map(s => ({
            contractType: s.contractType,
            code: s.code,
            title: s.title,
            defaultLevel: s.defaultLevel,
            stancePreference: s.stancePreference,
            checkContent: s.checkContent,
            legalBasis: s.legalBasis ?? null,
            suggestion: s.suggestion ?? null,
            enabled: true,
        })),
    })
    console.log(`已写入 ${inserted.count} 条`)

    const after = await prisma.contractPlaybooks.count()
    if (after !== seeds.length) {
        throw new Error(`导入后行数与 fixture 不一致: 预期 ${seeds.length}, 实际 ${after}`)
    }

    console.log(`完成：contract_playbooks 当前 ${after} 行`)
}

main()
    .then(async () => {
        await prisma.$disconnect()
        process.exit(0)
    })
    .catch(async (err) => {
        console.error('导入失败:', err)
        await prisma.$disconnect()
        process.exit(1)
    })
