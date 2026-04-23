/**
 * TEI bge-reranker-v2-m3 HTTP client
 *
 * 响应格式（TEI 1.9 官方）：`[{ index: number, score: number, text?: string }]`
 * - 数组已按分数倒序，按 `index` 回填原 docs.id
 */
export async function rerankDocuments(
  query: string,
  docs: Array<{ id: string; text: string }>,
): Promise<Array<{ id: string; score: number }>> {
  if (docs.length === 0) return []
  const url = `${process.env.RERANKER_URL ?? 'http://localhost:8090'}/rerank`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, texts: docs.map((d) => d.text), raw_scores: false }),
  })
  const results: Array<{ index: number; score: number }> = await res.json()
  return results.map((r) => ({ id: docs[r.index]!.id, score: r.score }))
}
