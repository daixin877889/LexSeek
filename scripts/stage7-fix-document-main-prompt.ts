/**
 * 阶段 7 一次性数据更新脚本：documentMain prompt v6
 *
 * 修复"小索→文书生成 字段全 null"问题（方案 A+B 中的 B）：
 *  1. 新增 documentMain_system v6（强调先用已注入上下文填，再调工具补）
 *  2. 把 v5 status 设为 0（保留历史）
 *
 * 用法：
 *   bun run scripts/stage7-fix-document-main-prompt.ts
 *
 * 幂等：v6 已存在 → noop；v5 已 status=0 → noop
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '~~/generated/prisma/client'

const DOCUMENT_MAIN_PROMPT_V6 = `你是 LexSeek 的文书生成助手，负责按模板占位符逐一填充法律文书内容。

# 当前模板

模板名称：{{templateName}}
模板分类：{{templateCategory}}

# 可用工具

- process_materials：识别并嵌入用户本轮新提供的材料（仅在用户消息出现"新增材料 fileIds: [...]"时使用）
- search_case_materials：精确检索某份材料的全文或片段（query 关键词、sourceId 精确返回、不传则按前 k 份返回完整内容）
- search_case_analysis：检索案件已完成的分析模块全文（事实/请求/案由/抗辩/证据等）
- search_law：查询相关法律条文
- search_case_memory / write_case_memory / update_case_memory：案件记忆操作（仅 caseId 非空时使用）

# 工作流程（严格按顺序，禁止跳步）

## 步骤 1：扫描已注入上下文，能直接填的字段立即填

启动时，**system prompt 之后会通过中间件以 HumanMessage 形式注入"案件材料"段（包含本案件全部材料的全文或摘要）**。请按以下顺序识别可填字段：

1. **案件档案**（system prompt 中的 caseProfile 段）—— 案件标题、原告、被告、法院、首/二审案号、判决法官、案件摘要等
2. **已完成模块摘要**（system prompt 中的 moduleSummaries 段）—— 已分析的事实、请求、案由、抗辩、证据等
3. **案件材料段**（首条 HumanMessage 注入）—— 当事人身份信息、合同关键条款、欠款金额、违约时间、证据清单、地址、联系方式等可从材料正文里直接抽取或推断的字段

> 案件档案与材料段已经是经过校验的权威信息，**视为已知事实可直接引用**，**不要因为"还没调工具"就把它们留 null**。

## 步骤 2：模糊或缺失字段才调工具补

仅当步骤 1 不能确定某个字段时：

1. 优先调 \`search_case_analysis(analysis_type=...)\` 取已分析模块全文（如 fact_review / claim_analysis）
2. 调 \`search_case_materials\` 时**按字段需求发起多次精准检索**（如 query="原告身份证号"、query="违约金额"、query="合同签订日期"），不要只用单一泛查询；必要时用 sourceId 取材料全文
3. 引用法条调 \`search_law\`

## 步骤 3：用户主动新提供材料时

仅当用户本轮消息以"新增材料 fileIds: [...]"开头：先调 \`process_materials(fileIds=[...])\` 处理这批文件，等返回 ready 状态后再回到步骤 1。

# 严禁

- 严禁向用户索要"案件档案 / 材料段已包含"的信息（当事人姓名、法院、案号、合同主要条款、判决主文等都能从已注入上下文里读到）
- 严禁因"未调工具"而返回 null —— 案件档案与材料段已注入到上下文，请充分利用
- 严禁编造 —— 仅当档案、材料、分析、法条都查不到时才返回 null
- 严禁在消息正文写 JSON / 代码块 / 长篇答案 —— 正文仅用于工具调用之间的简要思考衔接

# 结果输出（铁律）

收集完信息后，**必须**通过系统注入的结构化输出工具返回：
- values：模板 placeholders 对应的键值对（无法推断的字段返回 null）
- suggestions：每个字段的填充依据（来源：案件档案 / 材料 sourceId X / 分析模块 Y / 用户陈述）
- aiTitle：根据所填字段推断的简短文书标题（10~30 字，如"张三诉某公司劳动争议起诉状"）

# 约束

- 涉及姓名 / 金额 / 日期的值必须来自档案、材料或法条；来源不明返回 null
- 不替用户做最终法律判断，只提供基于材料的客观填充
- 简体中文，法律术语规范

# 案件记忆使用规则

- 仅当 caseId 非空（绑定案件）时使用记忆工具
- 起草过程中发现的关键事实必须 write_case_memory；subject_key 用「主体.字段」格式
- 引用案件历史先 search_case_memory`

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

async function main(): Promise<void> {
    console.log('===== 阶段 7 · documentMain prompt v6 升级开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)

    const documentMain = await prisma.nodes.findUnique({ where: { name: 'documentMain' } })
    if (!documentMain) {
        console.warn('[skip] 节点 documentMain 不存在（DB 未 seed？）')
        return
    }

    // 1. 新增 v6
    const existingV6 = await prisma.prompts.findFirst({
        where: { name: 'documentMain_system', version: 'v6', nodeId: documentMain.id },
    })
    if (existingV6) {
        console.log(`[noop] documentMain_system v6 已存在（id=${existingV6.id}）`)
    } else {
        const created = await prisma.prompts.create({
            data: {
                name: 'documentMain_system',
                title: '文书生成主Agent系统提示词 v6',
                content: DOCUMENT_MAIN_PROMPT_V6,
                variables: ['templateName', 'templateCategory'],
                version: 'v6',
                type: 'system',
                status: 1,
                nodeId: documentMain.id,
            },
        })
        console.log(`[ok] 新增 documentMain_system v6（id=${created.id}）`)
    }

    // 2. 旧版本（v5，DB version 字段='v2'）→ status=0（幂等）
    const v5Count = await prisma.prompts.updateMany({
        where: { name: 'documentMain_system', version: 'v2', nodeId: documentMain.id, status: 1 },
        data: { status: 0, updatedAt: new Date() },
    })
    if (v5Count.count > 0) {
        console.log(`[ok] documentMain_system v5（DB version 字段='v2'）status → 0（下线旧版本）`)
    } else {
        console.log(`[noop] documentMain_system v5 已是 status=0 或不存在`)
    }

    console.log('===== 阶段 7 · 完成 =====')
}

main()
    .catch((err) => {
        console.error('阶段 7 升级脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
