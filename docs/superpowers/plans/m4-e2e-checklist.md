# M4 · E2E 手工验收清单

## 分析模块完成流程
- [ ] 跑完一个案件的风险评估模块分析，3-5 秒内 `caseAnalyses.summary` 有值（200-400 字）
- [ ] `case_analysis_embeddings` 表对应 `analysisId` 的多条记录写入（按段落切块）
- [ ] 这些记录的 `metadata.isActive = true` / `metadata.analysisType = 'risk_assessment'` / `metadata.version = N`
- [ ] 主对话里触发 `search_case_analysis` 工具，能命中该模块的内容

## 多版本切换
- [ ] 对同一模块跑第二次分析，产生 version=2 的 caseAnalyses + embeddings
- [ ] version=2 自动 isActive=true，version=1 自动 isActive=false（caseAnalyses 和 embeddings 都变）
- [ ] 调 `switchActiveVersionService(v1Id)` 切回 v1 版本
- [ ] v1 的 caseAnalyses.isActive=true，v2 的=false
- [ ] v1 的 embeddings.metadata.isActive=true，v2 的=false
- [ ] `search_case_analysis` 跟随切版本，返回 v1 片段

## 模块摘要进 prompt
- [ ] 分析完风险评估后，打开另一个模块的对话
- [ ] 观察 system prompt 第 ④ 段包含"已完成分析模块"+ 风险评估的 summary
- [ ] prompt 中**不**出现风险评估全文（只摘要）
- [ ] Agent 可以调 `search_case_analysis` 召回全文片段

## 旧数据兼容
- [ ] 生产前的 caseAnalyses（无 summary）不阻塞对话
- [ ] 这些旧版本召回不到（合理，Q4.3 B）

## 事务边界
- [ ] 故意让 embedding 服务不可达（停 embedding API 或改环境变量到错地址）
- [ ] 跑分析：`caseAnalyses.summary` 仍有值（主事务 commit）
- [ ] 日志出现 `case_analysis_embeddings 写入失败，主分析已 commit` warn
- [ ] 后续恢复 embedding 服务，新分析正常写入

## 中文分词
- [ ] 分析摘要全中文：`合同纠纷的违约责任中高`
- [ ] Agent 调 `search_case_analysis({ query: '违约' })` 能命中（BM25 通过 tsv('chinese') 召回）
