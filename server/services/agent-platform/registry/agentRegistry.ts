/**
 * Agent Registry
 *
 * 用 (scope, type?) 元组作为 key 注册 runner，dispatch 时按 session 路由分发。
 * 阶段 1 中由 registerLegacyRunners 注册现有 5 个 runner（runDocumentChat 等）；
 * 阶段 2 起被 defineDomainAgent 工厂自动调用，实现"业务注册 → 自动路由"。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.3
 */

import type { SessionScope, SessionType } from '#shared/types/agentEvent'
import type {
    AgentRegistryEntry,
    AgentRunnerContext,
    SessionRouteKey,
} from './types'

/** 内部 key：把 (scope, type) 拼成字符串 */
function makeMapKey(scope: SessionScope, type: SessionType | number | null | undefined): string {
    if (type == null) return `${scope}::`
    return `${scope}::${type}`
}

export class AgentRegistry {
    private readonly entries = new Map<string, AgentRegistryEntry>()

    /**
     * 注册 entry。
     * (scope, type) 重复注册会抛错——业务 vertical 的 agent.config.ts 各自唯一。
     */
    register(entry: AgentRegistryEntry): void {
        const key = makeMapKey(entry.scope, entry.type ?? null)
        if (this.entries.has(key)) {
            throw new Error(`AgentRegistry 已注册 ${key}（重复注册）`)
        }
        this.entries.set(key, entry)
    }

    /**
     * 按 scope + type 路由分发。
     * 路由规则：
     *   1. 优先匹配 (scope, type) 精确组合；
     *   2. 没有则降级匹配 (scope, null) 默认 entry。
     */
    async dispatch(routeKey: SessionRouteKey, ctx: AgentRunnerContext): Promise<ReadableStream> {
        const exactKey = makeMapKey(routeKey.scope, routeKey.type ?? null)
        const fallbackKey = makeMapKey(routeKey.scope, null)

        const entry = this.entries.get(exactKey) ?? this.entries.get(fallbackKey)
        if (!entry) {
            throw new Error(
                `AgentRegistry 未注册 scope=${routeKey.scope} type=${routeKey.type ?? 'null'}`,
            )
        }
        return entry.runner(ctx)
    }

    /** 列出所有 entry（admin / introspection 用）*/
    list(): AgentRegistryEntry[] {
        return Array.from(this.entries.values())
    }

    /** 检查指定 (scope, type) 是否已注册 */
    has(key: { scope: SessionScope; type?: SessionType | null }): boolean {
        return this.entries.has(makeMapKey(key.scope, key.type ?? null))
    }
}

/** 全局单例 */
export const agentRegistry = new AgentRegistry()
