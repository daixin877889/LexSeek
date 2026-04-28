/** 记忆类型 */
export type MemoryKind = 'fact' | 'preference' | 'dialogue_note'

/** 记忆来源 */
export type MemorySource = 'manual' | 'consolidator' | 'auto_extract' | 'manual_user'

/** 案件记忆 metadata（存在 case_memories.metadata JSONB 里） */
export interface CaseMemoryMetadata {
    /** 行 UUID（和 case_memories.id 列相同），写入时存入 metadata 以供召回时读回 */
    id: string
    /** 案件 ID（硬过滤必需） */
    caseId: number
    /** 记忆类型 */
    kind: MemoryKind
    /** 主题指纹，如 "plaintiff.address"；同主题版本链用 */
    subjectKey?: string
    /** consolidator 抽取置信度 0-1 */
    confidence?: number
    /** 写入来源 */
    source?: MemorySource
    /** 上一版 id */
    supersedes?: string
    /** ISO 时间串，非空即失效 */
    invalidatedAt?: string
    /** ISO 创建时间 */
    createdAt: string
}

/** 召回命中 */
export interface MemoryHit {
    id: string
    text: string
    score: number
    metadata: CaseMemoryMetadata
}
