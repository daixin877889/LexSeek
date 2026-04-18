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
import fs from 'node:fs'
import path from 'node:path'
// @ts-ignore
import OSS from 'ali-oss'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { scanPlaceholders } from '../server/services/assistant/document/templateScanner'
import { FileSource } from '../shared/types/file'

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
            tools: ['search_law'],
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
 * Seed: assistantTitleGen 节点 + 系统提示词 v1
 *
 * 独立于 assistantMain，用于会话标题生成：
 * - 运营可单独调整温度/模型/提示词，不影响主对话体验
 * - 模型优先复用 assistantMain 的 modelId（保持语言风格一致），缺失时回退首个启用 model
 * - 提示词支持 `{{firstUserMessage}}` / `{{firstAssistantReply}}` 模板变量
 */
async function seedAssistantTitleGenNode(prismaClient: PrismaClient): Promise<void> {
    // 1. 选模型：优先复用 assistantMain
    const assistantMain = await prismaClient.nodes.findUnique({ where: { name: 'assistantMain' } })
    let modelId = assistantMain?.modelId
    if (modelId == null) {
        const firstModel = await prismaClient.models.findFirst({ where: { status: 1 } })
        if (!firstModel) {
            throw new Error('[seed] 无可用 model，请先 seed models 表后再执行 assistantTitleGen seed')
        }
        modelId = firstModel.id
        console.warn(
            `[seed] assistantMain 不存在，assistantTitleGen 使用首个可用 model: ${firstModel.name} (id=${firstModel.id})`,
        )
    }

    // 2. upsert 节点（已存在则保留配置）
    const node = await prismaClient.nodes.upsert({
        where: { name: 'assistantTitleGen' },
        update: {},
        create: {
            name: 'assistantTitleGen',
            title: '会话标题生成',
            description: '根据首轮对话生成 ≤20 字会话标题，供侧栏列表展示',
            type: 'extraction',
            priority: 20,
            modelId,
            tools: [],
            status: 1,
        },
    })

    // 3. upsert 系统提示词 v1
    const systemPromptContent = `你是一个会话标题生成助手。请根据下面的首轮对话，生成一个简洁的会话标题。

要求：
- 长度不超过 20 字
- 用中文
- 不要加引号、标点结尾、换行或任何前后缀
- 概括对话主题，不要重复问题原文

用户提问：{{firstUserMessage}}

助手回复：{{firstAssistantReply}}

请直接输出标题（不要包含"标题："或其他前缀）：`

    const existing = await prismaClient.prompts.findFirst({
        where: { nodeId: node.id, type: 'system', version: 'v1', deletedAt: null },
    })
    if (!existing) {
        await prismaClient.prompts.create({
            data: {
                name: 'assistantTitleGen_system',
                title: '会话标题生成系统提示词 v1',
                content: systemPromptContent,
                variables: ['firstUserMessage', 'firstAssistantReply'],
                version: 'v1',
                type: 'system',
                status: 1,
                nodeId: node.id,
            },
        })
    }

    console.log('[seed] assistantTitleGen 节点 + 提示词 v1 完成')
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

/**
 * Seed: documentMain 节点 + 系统提示词 v1
 *
 * ⚠️ 关键约束：documentMain 必须使用支持 tool_choice 的 chat 模型。
 *    deepseek-reasoner 等 reasoner 类模型不支持 tool_choice，
 *    LangChain responseFormat 依赖 tool_choice，因此 documentMain 不能使用 reasoner 模型。
 *
 * 模型选择策略：
 * - 优先复用 caseMain 的 modelId（保证与案件分析能力基线一致）
 * - 若 caseMain 配置的是 reasoner 模型（name 包含 reasoner/r1），退回首个非 reasoner 的启用 chat 模型
 * - 回退模型不存在时报错，提示运维补齐 chat 模型配置
 */
async function seedDocumentMainNode(prismaClient: PrismaClient): Promise<void> {
    // 1. 取 caseMain 的 modelId 作为初始候选
    const caseMain = await prismaClient.nodes.findUnique({ where: { name: 'caseMain' } })
    let documentModelId = caseMain?.modelId

    if (documentModelId == null) {
        // caseMain 不存在，直接取首个启用的 chat 模型
        const firstChat = await prismaClient.models.findFirst({
            where: {
                status: 1,
                modelType: 'chat',
                NOT: [{ name: { contains: 'reasoner' } }, { name: { contains: '-r1' } }],
            },
            orderBy: { id: 'asc' },
        })
        if (!firstChat) {
            throw new Error('[seed] 无可用 chat 模型，请先在 models 表添加支持 tool_choice 的模型后再执行 documentMain seed')
        }
        documentModelId = firstChat.id
        console.warn(
            `[seed] caseMain 不存在，documentMain 使用首个可用 chat 模型: ${firstChat.name} (id=${firstChat.id})`,
        )
    } else {
        // caseMain 存在，校验其模型是否为 reasoner 类型
        const caseMainModel = await prismaClient.models.findUnique({ where: { id: documentModelId } })
        const isReasoner = caseMainModel?.name?.toLowerCase().includes('reasoner') || caseMainModel?.name?.toLowerCase().includes('-r1')
        if (isReasoner) {
            console.warn(
                `[seed] documentMain 不能用 reasoner 模型（${caseMainModel?.name}），退回首个非 reasoner chat 模型`,
            )
            const nonReasoner = await prismaClient.models.findFirst({
                where: {
                    status: 1,
                    modelType: 'chat',
                    NOT: [{ name: { contains: 'reasoner' } }, { name: { contains: '-r1' } }],
                },
                orderBy: { id: 'asc' },
            })
            if (!nonReasoner) {
                throw new Error('[seed] 无可用非 reasoner chat 模型，documentMain seed 无法执行')
            }
            console.warn(`[seed] documentMain 将使用模型: ${nonReasoner.name} (id=${nonReasoner.id})`)
            documentModelId = nonReasoner.id
        }
    }

    // 2. upsert documentMain 节点（已存在则保留配置，不覆盖人工修订）
    const node = await prismaClient.nodes.upsert({
        where: { name: 'documentMain' },
        update: {},
        create: {
            name: 'documentMain',
            title: '文书生成主Agent',
            description: '按模板占位符填充生成文书',
            type: 'agent',
            priority: 30,
            modelId: documentModelId,
            tools: ['search_case_materials', 'search_law'],
            status: 1,
        },
    })

    // 3. 提示词 v1（find-then-create 保证幂等；已存在则不覆盖内容）
    const systemPromptContent = `你是 LexSeek 的文书生成助手，负责按模板占位符逐一填充法律文书内容。

# 当前模板

模板名称：{{templateName}}
模板分类：{{templateCategory}}

# 可用工具

- search_case_materials：检索用户已上传的案件材料，获取当事人信息、事实经过、金额明细等
- search_law：查询相关法律条文，为文书引用提供依据

# 工作流程

1. 调用 search_case_materials 检索案件材料，逐一推断每个占位符的值
2. 如需引用法条，调用 search_law 获取准确条文
3. 对无法从材料中推断的占位符，返回 null（严禁编造）
4. 在 suggestions 中为每个字段说明填充依据或无法推断的原因

# 输出格式

必须返回以下标准 JSON，不得包含额外文字：

\`\`\`json
{
  "values": {
    "占位符名称": "填充内容或 null"
  },
  "suggestions": {
    "占位符名称": "填充依据说明"
  }
}
\`\`\`

# 约束

- 所有涉及姓名、金额、日期的值必须来自材料或法条，来源不明的一律返回 null
- 不替用户做最终法律判断，只提供基于材料的客观填充
- 使用简体中文，法律术语准确规范`

    const existing = await prismaClient.prompts.findFirst({
        where: { nodeId: node.id, type: 'system', version: 'v1', deletedAt: null },
    })
    if (!existing) {
        await prismaClient.prompts.create({
            data: {
                name: 'documentMain_system',
                title: '文书生成主Agent系统提示词 v1',
                content: systemPromptContent,
                variables: ['templateName', 'templateCategory'],
                version: 'v1',
                type: 'system',
                status: 1,
                nodeId: node.id,
            },
        })
    }

    console.log('[seed] documentMain 节点 + 提示词 v1 完成')
}

/**
 * Seed: document_draft_token 积分消耗规则
 *
 * 参考 assistant_token / case_analysis_token 的字段结构（group=agentToken, unit=千tokens）。
 * 积分单价与 discount 由运营后续调整，此处只保证运行时有可用规则。
 */
async function seedDocumentDraftTokenRule(prismaClient: PrismaClient): Promise<void> {
    // 优先参考 assistant_token，其次 case_analysis_token，都不存在时使用默认值
    const reference =
        (await prismaClient.pointConsumptionItems.findUnique({ where: { key: 'assistant_token' } })) ??
        (await prismaClient.pointConsumptionItems.findUnique({ where: { key: 'case_analysis_token' } }))

    const pointAmount = reference?.pointAmount ?? 1
    const discount = reference?.discount ?? 1
    const unit = reference?.unit ?? '千tokens'
    const group = reference?.group ?? 'agentToken'

    await prismaClient.pointConsumptionItems.upsert({
        where: { key: 'document_draft_token' },
        update: {},
        create: {
            key: 'document_draft_token',
            group,
            name: '文书生成 token 计费',
            description: '文书生成按模型 token 用量扣减积分',
            unit,
            pointAmount,
            discount,
            status: 1,
        },
    })

    console.log('[seed] document_draft_token 积分规则完成')
}

/**
 * 让位：把 seedData.sql 中原 sort ∈ [5, 9] 的 dashboard 顶级菜单整体下移 2 格，
 * 为法律助手三条菜单（sort=4/5/6）腾出位置。
 *
 * 幂等保护：
 * - 只修改 name 属于原始静态菜单集合（legal/tools/diskSpace/membership/settings）的行
 * - 且当前 sort 仍在 [5, 9] 区间时才 +2（已经被挪过的不再动）
 * - 检测 assistant 菜单是否已存在并 sort ≤ 6，若满足则跳过（说明已经让位完毕）
 */
async function shiftLegacyDashboardMenus(prismaClient: PrismaClient): Promise<void> {
    // 如果 assistant 菜单已经在 4/5/6 位置，说明已让位过，跳过
    const existingAssistant = await prismaClient.routers.findUnique({
        where: { name: 'dashboard-assistant-chat' },
        select: { sort: true },
    })
    if (existingAssistant && existingAssistant.sort <= 6) {
        return
    }

    // 原静态菜单（sort=5..9）按名称精准定位，避免误伤自定义菜单
    const legacyNames = ['dashboard-legal', 'tools', 'diskSpace', 'membership', 'settings']
    const legacy = await prismaClient.routers.findMany({
        where: {
            name: { in: legacyNames },
            sort: { gte: 5, lte: 9 },
        },
        select: { id: true, name: true, sort: true },
    })

    for (const row of legacy) {
        await prismaClient.routers.update({
            where: { id: row.id },
            data: { sort: row.sort + 2 },
        })
    }

    if (legacy.length > 0) {
        console.log(
            `[seed] 已让位 ${legacy.length} 条 dashboard 菜单（sort +2，为法律助手腾位）`,
        )
    }
}

/**
 * Seed: 法律助手侧边栏三级菜单 + 默认角色授权
 *
 * 设计要点：
 * 1. navMain.vue 渲染扁平 isMenu=true 列表，不支持父子折叠，因此直接注册三条顶级菜单。
 * 2. 图标与现有菜单统一使用 `lucideIcons.XxxIcon` 前缀；图标名沿用 lucide-vue-next 官方命名。
 * 3. upsert by `name`（unique）——新部署时从 create 创建；
 *    既有部署时 update 字段强制刷新 title/path/sort（这几个字段是本次 bug 修复必须覆盖的）。
 *    icon/description 不强制覆盖，允许运营按需调整。
 * 4. 菜单顺序：三条助手菜单紧跟"创建案件"(sort=3)，使用 sort=4/5/6；
 *    基础 seedData.sql 中原 sort∈[5,9] 的菜单需要在部署前往后让 2 格（见同文件下方 shiftLegacyDashboardMenus）。
 * 5. 角色授权：默认分配给普通用户 (code=user) 与管理员 (code=admin)；
 *    super_admin 在 permission.service.ts 中通过代码旁路获得所有路由，不需单独授权。
 * 6. roleRouters 关联使用 upsert by 复合唯一键 (roleId, routerId) 保持幂等。
 */
async function seedAssistantRouters(prismaClient: PrismaClient): Promise<void> {
    // 1. 先让位：把 sort∈[5,9] 的老 dashboard 菜单整体往后挪 2 格（幂等保护）
    await shiftLegacyDashboardMenus(prismaClient)

    // 2. 确认路由组（dashboard 组，id=1 由 seedData.sql 预置）
    const dashboardGroup = await prismaClient.routerGroups.findUnique({
        where: { name: 'dashboard' },
    })
    if (!dashboardGroup) {
        throw new Error('[seed] router_groups.dashboard 不存在，请先执行 seedData.sql 初始化基础数据')
    }

    // 3. 定义菜单元信息（sort=4/5/6 紧跟创建案件）
    const menus = [
        {
            name: 'dashboard-assistant-chat',
            title: '法律助手',
            path: '/dashboard/assistant',
            icon: 'lucideIcons.MessageSquareIcon',
            description: '无案件上下文的通用法律助手对话入口',
            sort: 4,
        },
        {
            name: 'dashboard-assistant-contract',
            title: '合同审查',
            path: '/dashboard/contract',
            icon: 'lucideIcons.FileSearchIcon',
            description: '合同审查（占位，开发中）',
            sort: 5,
        },
        {
            name: 'dashboard-assistant-document',
            title: '文书生成',
            path: '/dashboard/assistant/document',
            icon: 'lucideIcons.FileTextIcon',
            description: '按模板生成法律文书，AI 自动填充占位符',
            sort: 6,
        },
    ] as const

    // 4. upsert 路由：title/path/sort 本次必须覆盖存量（修复菜单名/路由/顺序）
    const routerIds: number[] = []
    for (const menu of menus) {
        const router = await prismaClient.routers.upsert({
            where: { name: menu.name },
            update: {
                title: menu.title,
                path: menu.path,
                sort: menu.sort,
            },
            create: {
                name: menu.name,
                title: menu.title,
                description: menu.description,
                path: menu.path,
                isMenu: true,
                parentId: null,
                icon: menu.icon,
                groupId: dashboardGroup.id,
                sort: menu.sort,
            },
        })
        routerIds.push(router.id)
    }

    // 4. 找默认被授权角色（普通用户 + 管理员）；角色缺失仅告警不阻塞
    const targetRoles = await prismaClient.roles.findMany({
        where: { code: { in: ['user', 'admin'] }, deletedAt: null },
        select: { id: true, code: true },
    })
    if (targetRoles.length === 0) {
        console.warn('[seed] 未找到 user/admin 角色，跳过助手菜单授权（super_admin 由代码旁路放行）')
        console.log('[seed] 法律助手菜单注册完成')
        return
    }

    // 5. upsert roleRouters 关联（幂等，利用复合唯一键）
    for (const role of targetRoles) {
        for (const routerId of routerIds) {
            await prismaClient.roleRouters.upsert({
                where: {
                    idx_role_router_unique: { roleId: role.id, routerId },
                },
                update: {},
                create: {
                    roleId: role.id,
                    routerId,
                },
            })
        }
    }

    console.log(
        `[seed] 法律助手菜单注册完成：${menus.length} 条路由，授权角色 [${targetRoles
            .map((r) => r.code)
            .join(', ')}]`,
    )
}

/** 文书模板名称 → 分类映射 */
const TEMPLATE_CATEGORY_MAP: Record<string, string> = {
    '民间借贷起诉状': 'litigation',
    '民事答辩状': 'litigation',
    '委托代理合同': 'general',
    '律师函': 'general',
    '民事调解协议': 'arbitration',
}

/**
 * Seed: 5 个样本文书模板
 *
 * - 从 prisma/seeds/document-templates/*.docx 读取文件
 * - 扫描占位符，上传至 OSS，写入 document_templates 表
 * - 幂等：name + scope='global' 已存在则跳过
 * - ossFiles.userId 使用数据库第一个用户（seed 环境无系统用户）
 * - OSS 配置直接从环境变量读取（seed 不在 Nuxt 运行时，无法用 useRuntimeConfig）
 */
async function seedDocumentTemplates(prismaClient: PrismaClient): Promise<void> {
    const dir = path.join(process.cwd(), 'prisma/seeds/document-templates')
    if (!fs.existsSync(dir)) {
        console.log('[seed] document-templates 目录不存在，跳过')
        return
    }

    // 从环境变量读取 OSS 配置（与 nuxt.config.ts 中 NUXT_STORAGE_ALIYUN_OSS_* 对应）
    const ossAccessKeyId = process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID ?? ''
    const ossAccessKeySecret = process.env.NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_SECRET ?? ''
    const ossBucket = process.env.NUXT_STORAGE_ALIYUN_OSS_BUCKET ?? ''
    const ossRegion = process.env.NUXT_STORAGE_ALIYUN_OSS_REGION ?? ''
    if (!ossAccessKeyId || !ossBucket) {
        throw new Error(
            '[seed] 缺少 OSS 环境变量（NUXT_STORAGE_ALIYUN_OSS_ACCESS_KEY_ID / BUCKET 等），无法上传模板文件',
        )
    }
    // 直接使用 ali-oss 客户端，避免引入 server/lib/oss（依赖 Nuxt 路径别名）
    const ossClient = new OSS({
        accessKeyId: ossAccessKeyId,
        accessKeySecret: ossAccessKeySecret,
        bucket: ossBucket,
        region: ossRegion,
    })

    // 取第一个用户作为 ossFiles.userId（ossFiles.userId 是 NOT NULL 字段，全局模板不属于任何用户但表字段必填）
    const firstUser = await prismaClient.users.findFirst({ select: { id: true } })
    if (!firstUser) {
        throw new Error('[seed] 数据库无用户记录，请先创建至少一个用户后再运行 seed')
    }
    const systemUserId = firstUser.id

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.docx'))
    for (const file of files) {
        const name = path.basename(file, '.docx')
        const category = TEMPLATE_CATEGORY_MAP[name]
        if (!category) {
            console.warn(`[seed] 样本模板 ${name} 未映射到 category，跳过`)
            continue
        }

        // 幂等：已存在则跳过
        const existing = await prismaClient.documentTemplates.findFirst({
            where: { name, scope: 'global', deletedAt: null },
        })
        if (existing) {
            continue
        }

        const buffer = fs.readFileSync(path.join(dir, file))
        const placeholders = await scanPlaceholders(buffer)
        if (placeholders.length === 0) {
            throw new Error(`[seed] 样本模板 ${file} 无占位符，请检查模板内容`)
        }

        // 上传至 OSS（路径带时间戳保证唯一）
        const ossPath = `seed-templates/${Date.now()}_${file}`
        await ossClient.put(ossPath, buffer, {
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })

        // 写 oss_files 记录（userId 用系统用户，scope=global 模板不属于个人）
        const ossFile = await prismaClient.ossFiles.create({
            data: {
                userId: systemUserId,
                bucketName: ossBucket,
                fileName: file,
                filePath: ossPath,
                fileSize: buffer.length,
                fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                source: FileSource.DOCUMENT_TEMPLATE,
                status: 1,
                encrypted: false,
            },
        })

        // 写 document_templates 记录
        await prismaClient.documentTemplates.create({
            data: {
                name,
                category,
                scope: 'global',
                userId: null,
                ossFileId: ossFile.id,
                placeholders: placeholders as any,
                description: `系统预置：${name}`,
                priority: 100,
                status: 1,
            },
        })

        console.log(`[seed] 文书模板写入：${name}（${placeholders.length} 个占位符）`)
    }
}

async function main(): Promise<void> {
    await seedAssistantMainNode(prisma)
    await seedAssistantTitleGenNode(prisma)
    await seedAssistantTokenRule(prisma)
    await seedAssistantRouters(prisma)
    await seedDocumentTemplates(prisma)
    await seedDocumentMainNode(prisma)
    await seedDocumentDraftTokenRule(prisma)
}

main()
    .catch((err) => {
        console.error('[seed] 执行失败：', err)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
