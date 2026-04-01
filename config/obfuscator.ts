import type { ObfuscatorOptions } from 'javascript-obfuscator'

/**
 * 中度混淆配置 — 服务端代码混淆
 *
 * 包含：变量名压缩、字符串混淆、控制流扁平化
 * 不包含：死代码注入、反调试（高强度特性）
 */
export const obfuscatorConfig: ObfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  sourceMap: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 16,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
}
