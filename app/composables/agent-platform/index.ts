/**
 * 平台层导出
 */

export {
  useDomainAgentSession,
  useDomainAgentSessionPool,
} from './useDomainAgentSession'
export type {
  DomainAgentSessionConfig,
  DomainScope,
  SendOpts,
  SessionItem,
  SessionIdConfig,
  DomainAgentApiEndpoints,
  DomainAgentSessionPoolApi,
  SessionFactory,
} from './useDomainAgentSession'

export { InterruptRegistry, globalInterruptRegistry } from './interruptRegistry'
export type { InterruptRegistryOptions } from './interruptRegistry'
