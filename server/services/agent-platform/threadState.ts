/**
 * threadState 平台库出口（re-export）。
 * 注：源文件 workflow/agents/threadState.ts 在 T13-T17 业务 vertical 阶段
 * 不会被搬走（它是真正通用的），所以只做 re-export 即可。
 */
export * from '~~/server/services/workflow/agents/threadState'
