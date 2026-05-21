import type { NewPrismaClient } from '../clients'
import { log, warn } from '../logger'

export interface ReferenceReport {
  label: string
  status: 'ok' | 'warn'
  detail: string
}

/**
 * 非外键约束引用的完整性校验（设计文档 §13 校验 2）。
 * 新库 DB 外键约束已保证带 FK 的引用不悬空；此处只查"无 FK 约束的引用列"：
 * text_content_records.materialId、recognition 表的 ossFileId。
 */
export async function verifyReferences(next: NewPrismaClient): Promise<ReferenceReport[]> {
  const reports: ReferenceReport[] = []

  // text_content_records.materialId 应都能在 case_materials 找到
  const orphanText = await next.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*)::bigint AS n FROM text_content_records t
    LEFT JOIN case_materials m ON m.id = t.material_id
    WHERE t.material_id IS NOT NULL AND m.id IS NULL
  `)
  const orphanTextN = Number(orphanText[0]?.n ?? 0)
  reports.push({
    label: 'text_content_records.materialId 引用',
    status: orphanTextN === 0 ? 'ok' : 'warn',
    detail: `悬空 ${orphanTextN} 行`,
  })

  // 识别记录的 ossFileId 应都能在 oss_files 找到（无 FK 约束）
  for (const t of ['doc_recognition_records', 'image_recognition_records', 'asr_records']) {
    const r = await next.$queryRawUnsafe<{ n: bigint }[]>(`
      SELECT count(*)::bigint AS n FROM "${t}" x
      LEFT JOIN oss_files f ON f.id = x.oss_file_id
      WHERE x.oss_file_id IS NOT NULL AND f.id IS NULL
    `)
    const n = Number(r[0]?.n ?? 0)
    reports.push({
      label: `${t}.ossFileId 引用`,
      status: n === 0 ? 'ok' : 'warn',
      detail: `悬空 ${n} 行`,
    })
  }

  log('--- 引用完整性校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'warn') warn(line)
    else log(line)
  }
  return reports
}
