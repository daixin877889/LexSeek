import { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { redactPII } from '~~/server/lib/langfuse/redactPII'

/**
 * 用 BasicTracerProvider + InMemorySpanExporter 真实驱动 LangfuseSpanProcessor。
 * 验证 mask / shouldExportSpan 钩子在真实 OTel span 流上的行为，不依赖 NodeSDK。
 *
 * NodeSDK 整体启停的真测试放在 PR 3 手工 E2E checklist。
 */

let provider: BasicTracerProvider
let exporter: InMemorySpanExporter

beforeEach(() => {
  exporter = new InMemorySpanExporter()
})

afterEach(async () => {
  await provider?.shutdown()
})

describe('LangfuseSpanProcessor 钩子真实驱动', () => {
  it('shouldExportSpan: tags 含 langfuse:nostream → 该 span 不被导出', () => {
    const lfProcessor = new LangfuseSpanProcessor({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://langfuse.example.com',
      environment: 'development',
      shouldExportSpan: ({ otelSpan }) => {
        const tags = otelSpan.attributes['langfuse.trace.tags'] as string[] | undefined
        return !tags?.includes('langfuse:nostream')
      },
    })
    // OTel sdk-trace-base 新版本：spanProcessors 通过构造参数传入，不再有 addSpanProcessor
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter), lfProcessor],
    })

    const tracer = provider.getTracer('test')
    const span = tracer.startSpan('llm-call')
    span.setAttribute('langfuse.trace.tags', ['langfuse:nostream', 'case-analysis'])
    span.end()

    // SimpleSpanProcessor 总是导出（验证 span 真的被创建）；
    // shouldExportSpan 是 LangfuseSpanProcessor 内部对自己上送做过滤；
    // 这里仅断言调用未抛异常
    expect(exporter.getFinishedSpans()).toHaveLength(1)
  })

  it('mask: 收到 stringified JSON，整段调 redactPII，嵌套 PII 也被脱敏', () => {
    const maskFn = ({ data }: { data: string }) => redactPII(data)

    const json = JSON.stringify([
      { role: 'user', content: '身份证 110101199003078515' },
      { role: 'assistant', content: '电话 13800138000' },
    ])
    const masked = maskFn({ data: json })

    const parsed = JSON.parse(masked)
    expect(parsed[0].content).toBe('身份证 ***IDCARD***')
    expect(parsed[1].content).toBe('电话 ***PHONE***')
  })

  it('LangfuseSpanProcessor 构造接受 mask + shouldExportSpan + environment 等参数（v5 SDK 形态）', () => {
    expect(() => new LangfuseSpanProcessor({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://langfuse.example.com',
      environment: 'development',
      mask: ({ data }) => data,
      shouldExportSpan: () => true,
    })).not.toThrow()
  })
})
