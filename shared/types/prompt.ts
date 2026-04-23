/**
 * 带 cache 标记的 prompt 片段。
 * 各供应商 adapter 会按自家协议翻译：
 * - Anthropic: 包装为 content block 数组 + cache_control
 * - OpenAI / DeepSeek: 只需保持前缀稳定，自动命中；cache 字段被忽略
 */
export interface PromptSegment {
  /** 段落文本 */
  text: string
  /** 缓存策略；不填则不打 cache_control 标记 */
  cache?: {
    /**
     * '1h' = 稳定内容（案件档案、角色 prompt）
     * '5m' = 半稳定内容（模块摘要，每完成一个模块才变）
     */
    ttl: '1h' | '5m'
  }
}

/**
 * 带 cache 能力的 System Prompt（多段）。
 * 段落顺序约定：1h TTL 段必须在 5m TTL 段之前（Anthropic 要求）。
 */
export type CachedPrompt = PromptSegment[]
