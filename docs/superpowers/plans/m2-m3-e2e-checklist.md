# M2+M3 · E2E 手工验收清单

## M2 · 5 段式 prompt + Caching
- [ ] 第 3 段（案件档案 JSON）在刷新/切模块时**字节级完全一致**（无时间戳/随机值）
- [ ] Anthropic 模型第二次请求 `usage.cache_read_input_tokens` > 0（命中缓存）
- [ ] OpenAI 模型第二次请求 `usage.prompt_tokens_details.cached_tokens` > 0
- [ ] DeepSeek 模型第二次请求 `usage.prompt_cache_hit_tokens` > 0
- [ ] 材料上下文只出现在第 ⑤ 段（清单 + 100 字摘要），**不塞全文**
- [ ] 材料上传完成后 5-10 秒内 `caseMaterials.summary` 字段有值
- [ ] 对话触发 `search_case_materials` 工具能正常召回片段

## M3 · 记忆工具链
- [ ] 首次对话后 30-60 秒，`case_memories` 表里有新记录（source='consolidator'）
- [ ] 确实抽取出事实/偏好（confidence >= 0.6）
- [ ] Agent 调用 `search_case_memory({ query: '...' })` 返回合理结果
- [ ] Agent 调用 `write_case_memory({ text, kind })` 成功写入（检查表）
- [ ] Agent 调用 `update_case_memory({ id, invalidate: true })` 后，该记忆 metadata.invalidatedAt 有值
- [ ] 同 subjectKey 的新记忆进入，旧记忆被自动 invalidate（版本链）
- [ ] `search_case_memory({ include_history: true })` 能看到失效记忆
- [ ] `include_history: false` 过滤失效记忆

## 权限/隔离
- [ ] ARCHIVED 案件调 `write_case_memory` 返回错误消息
- [ ] ARCHIVED 案件调 `update_case_memory` 返回错误消息
- [ ] 案件 A 的 Agent 不能检索到案件 B 的记忆（caseId 硬过滤）

## Reranker 降级
- [ ] 停掉 bge-reranker 容器（`docker stop bge-reranker`），召回仍能返回结果（降级走 hybrid 分数）
- [ ] 日志出现 `rerankerClient 不可达，降级走 hybrid 分数` warn

## 中文分词
- [ ] 重新执行 `prisma migrate reset` + `prisma migrate deploy` 后，`chinese` 配置仍可用
- [ ] 全中文记忆能被中文 query BM25 召回（如"合同违约"能命中"违约金"记忆）
