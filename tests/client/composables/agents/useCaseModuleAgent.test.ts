/**
 * useCaseModuleAgent · activeModules 显隐回归测试
 *
 * 用户场景：在案件详情页点开"未生成分析结果"模块开始分析,关闭对话框后,
 * 屏幕右下角应显示模块标签(分析在后台跑,通过标签可重新打开对话框)。
 *
 * 历史回归(commit 02c21ad6):activeModules 过滤条件加了 isLoading || (sessions.length>0 && currentSessionId)
 * 之后,init() / sendMessage 的异步窗口期内 SDK isLoading 仍是 false / sessions 仍空,
 * 关闭对话框立刻被 filter 掉,标签消失,用户失去重新进入入口。
 *
 * 修复:回到 `!isHidden` 单条件——instances 字典本身已保证"用户交互过的模块才入池"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, shallowRef, computed } from 'vue'

vi.mock('~/store/user', () => ({
    useUserStore: () => ({ userInfo: { id: 1 } }),
}))

const mockFactoryRefs = {
    isLoading: shallowRef(false),
    sessions: ref<any[]>([]),
    currentSessionId: ref(''),
}

vi.mock('../../../../app/composables/agent-platform/useDomainAgentSession', () => ({
    useDomainAgentSessionPool: () => ({
        getOrCreate: () => ({
            sessions: mockFactoryRefs.sessions,
            currentSessionId: mockFactoryRefs.currentSessionId,
            isLoading: computed(() => mockFactoryRefs.isLoading.value),
            messages: computed(() => []),
            init: vi.fn(),
            sendMessage: vi.fn(),
            stopGeneration: vi.fn(),
        }),
    }),
}))

const { useCaseModuleAgent } = await import('~/composables/agents/useCaseModuleAgent')

beforeEach(() => {
    mockFactoryRefs.isLoading.value = false
    mockFactoryRefs.sessions.value = []
    mockFactoryRefs.currentSessionId.value = ''
})

describe('useCaseModuleAgent · activeModules', () => {
    it('刚 getOrCreateInstance、未 init 时,activeModules 已包含该模块(标签立刻可见)', () => {
        const caseId = ref(1)
        const mgr = useCaseModuleAgent(caseId)

        expect(mgr.activeModules.value).toHaveLength(0)

        mgr.getOrCreateInstance('evidence', '证据梳理')
        // 此时 isLoading=false / sessions=[] / currentSessionId=''——init 还没跑
        // 旧 bug 下被 filter 掉;修复后应可见
        expect(mgr.activeModules.value).toHaveLength(1)
        expect(mgr.activeModules.value[0]?.moduleName).toBe('evidence')
    })

    it('expandModule + 关闭对话框后(isExpanded=false),activeModules 仍含该模块', () => {
        const caseId = ref(1)
        const mgr = useCaseModuleAgent(caseId)

        const inst = mgr.getOrCreateInstance('evidence', '证据梳理')
        mgr.expandModule('evidence')
        expect(inst.isExpanded.value).toBe(true)

        // 模拟用户点 X 关闭对话框: ChatWindowShell 触发 v-model open=false → isExpanded=false
        inst.isExpanded.value = false

        // ChatBar 显示条件: activeModules 包含 + isExpanded=false → 标签出现
        expect(mgr.activeModules.value).toHaveLength(1)
        expect(mgr.activeModules.value[0]?.isExpanded.value).toBe(false)
    })

    it('hideModule 后,activeModules 不再包含(标签隐藏)', () => {
        const caseId = ref(1)
        const mgr = useCaseModuleAgent(caseId)

        mgr.getOrCreateInstance('evidence', '证据梳理')
        expect(mgr.activeModules.value).toHaveLength(1)

        mgr.hideModule('evidence')
        expect(mgr.activeModules.value).toHaveLength(0)
    })

    it('isLoading=true 时也保持显示(分析中应可见)', () => {
        const caseId = ref(1)
        const mgr = useCaseModuleAgent(caseId)

        mgr.getOrCreateInstance('evidence', '证据梳理')
        mockFactoryRefs.isLoading.value = true
        expect(mgr.activeModules.value).toHaveLength(1)
    })

    it('sessions / currentSessionId 都有值时也保持显示', () => {
        const caseId = ref(1)
        const mgr = useCaseModuleAgent(caseId)

        mgr.getOrCreateInstance('evidence', '证据梳理')
        mockFactoryRefs.sessions.value = [{ sessionId: 's1' }]
        mockFactoryRefs.currentSessionId.value = 's1'
        expect(mgr.activeModules.value).toHaveLength(1)
    })

    it('expandModule 会重置 isHidden,从隐藏态重新展开能再现标签', () => {
        const caseId = ref(1)
        const mgr = useCaseModuleAgent(caseId)

        const inst = mgr.getOrCreateInstance('evidence', '证据梳理')
        mgr.hideModule('evidence')
        expect(inst.isHidden.value).toBe(true)
        expect(mgr.activeModules.value).toHaveLength(0)

        mgr.expandModule('evidence')
        expect(inst.isHidden.value).toBe(false)
        expect(inst.isExpanded.value).toBe(true)
        expect(mgr.activeModules.value).toHaveLength(1)
    })
})
