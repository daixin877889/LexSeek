/**
 * Prisma Seed 入口
 *
 * 职责：向数据库补全运行时必须的基础数据（节点、提示词、积分规则等）。
 *
 * 设计原则：
 * 1. 所有写操作必须幂等（upsert 或 find-then-create）——重跑不报错、不重复写。
 * 2. 不覆盖已有人工配置：update 子句留空或只补默认值，避免踩踏线上配置。
 * 3. 按领域拆分独立 `seedXxx` 函数，便于后续扩展与 PR 审阅。
 *
 * 运行：`bun prisma db seed`
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

/**
 * Seed: assistantMain 节点 + 系统提示词 v1
 *
 * - 模型优先复用 caseMain 的 modelId，保证通用法律助手与案件分析能力基线一致。
 * - caseMain 不存在时，回退到首个启用的 model，并打印 warning 提醒运维补齐。
 * - upsert 节点：不覆盖已有配置（update 留空）。
 * - 提示词 v1 仅在不存在时创建，已有人工修订的提示词保持不变。
 */
async function seedAssistantMainNode(prismaClient: PrismaClient): Promise<void> {
    // 1. 选模型：优先复用 caseMain
    const caseMain = await prismaClient.nodes.findUnique({ where: { name: 'caseMain' } })
    let modelId = caseMain?.modelId
    if (modelId == null) {
        const firstModel = await prismaClient.models.findFirst({ where: { status: 1 } })
        if (!firstModel) {
            throw new Error('[seed] 无可用 model，请先 seed models 表后再执行 assistantMain seed')
        }
        modelId = firstModel.id
        console.warn(
            `[seed] caseMain 不存在，assistantMain 使用首个可用 model: ${firstModel.name} (id=${firstModel.id})`,
        )
    }

    // 2. upsert assistantMain 节点（已存在则保留配置，不覆盖 tools / title 等人工修订）
    const node = await prismaClient.nodes.upsert({
        where: { name: 'assistantMain' },
        update: {},
        create: {
            name: 'assistantMain',
            title: '通用法律助手主Agent',
            description: '无案件上下文的法律问答与工具调用',
            type: 'agent',
            priority: 10,
            modelId,
            tools: ['searchLaw'],
            status: 1,
        },
    })

    // 3. upsert 系统提示词 v1（find-then-create 保证幂等；若已存在则不覆盖内容）
    const systemPromptContent = `你是 LexSeek 的通用法律助手，服务于中国大陆法律场景下的律师、法务与普通用户。

# 能力边界
- 你可以回答法律知识问题、提供文书起草思路、做合同基础分析。
- 你可以调用 searchLaw 工具检索最新法条。
- 你【不】拥有任何案件上下文；如果用户提到"我的案件"但没有贴出详情，主动请用户提供关键信息。
- 对于需要严谨尽职调查的任务（完整合同审查、正式文书生成），提示用户切换到
  「合同审查」「文书生成」专用入口，那里有专用工具与流程。

# 输出要求
- 准确、中立、使用法律术语，避免情绪化用语与感叹号。
- 引用法条时标注名称与条号（如《民法典》第 509 条）。
- 涉及不确定事实时主动说明前提假设。
- 默认使用简体中文。
- 所有涉及日期、金额、主体名称的内容，必须明确来源（来自用户输入 / 法条 / 工具返回）。

# 不做的事
- 不替用户做最终法律决定，只提供分析与建议。
- 不编造案例编号、当事人姓名、未经检索的法条内容。
- 不讨论与法律无关的话题（礼貌拒绝并引导回法律咨询）。`

    const existing = await prismaClient.prompts.findFirst({
        where: { nodeId: node.id, type: 'system', version: 'v1', deletedAt: null },
    })
    if (!existing) {
        await prismaClient.prompts.create({
            data: {
                name: 'assistantMain_system',
                title: '通用法律助手系统提示词 v1',
                content: systemPromptContent,
                variables: [],
                version: 'v1',
                type: 'system',
                status: 1,
                nodeId: node.id,
            },
        })
    }

    console.log('[seed] assistantMain 节点 + 提示词 v1 完成')
}

/**
 * Seed: assistant_token 积分消耗规则
 *
 * 参考线上 case_analysis_token 行的字段结构（group=agentToken, unit=千tokens）。
 * 若 case_analysis_token 不存在（新环境），使用与其一致的默认字段。
 *
 * 积分单价与 discount 由运营后续调整，这里只保证运行时有可用规则。
 */
async function seedAssistantTokenRule(prismaClient: PrismaClient): Promise<void> {
    const reference = await prismaClient.pointConsumptionItems.findUnique({
        where: { key: 'case_analysis_token' },
    })

    // 复用参考行字段；参考行不存在时使用一致的默认值（unit=千tokens, 单价=1, discount=1）。
    const pointAmount = reference?.pointAmount ?? 1
    const discount = reference?.discount ?? 1
    const unit = reference?.unit ?? '千tokens'
    const group = reference?.group ?? 'agentToken'

    await prismaClient.pointConsumptionItems.upsert({
        where: { key: 'assistant_token' },
        update: {},
        create: {
            key: 'assistant_token',
            group,
            name: '通用法律助手 token 计费',
            description: '通用法律助手按模型 token 用量扣减积分',
            unit,
            pointAmount,
            discount,
            status: 1,
        },
    })

    console.log('[seed] assistant_token 积分规则完成')
}

async function main(): Promise<void> {
    await seedAssistantMainNode(prisma)
    await seedAssistantTokenRule(prisma)
}

main()
    .catch((err) => {
        console.error('[seed] 执行失败：', err)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
