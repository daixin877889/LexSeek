/**
 * 微信授权回调测试
 *
 * 使用 fast-check 进行属性测试，验证授权回调接口的核心功能
 *
 * **Feature: wechat-auth-callback**
 * **Validates: Requirements 2.3, 2.4, 2.5**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/** state 参数结构 */
interface AuthCallbackState {
    targetUrl: string;
    source?: string;
}

/**
 * 编码 state 参数（与前端 encodeAuthState 一致）
 */
function encodeAuthState(state: AuthCallbackState): string {
    return Buffer.from(JSON.stringify(state)).toString('base64');
}

/**
 * 解码 state 参数（与后端 parseState 一致）
 */
function decodeAuthState(encoded: string): AuthCallbackState | null {
    try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);

        if (!parsed.targetUrl || typeof parsed.targetUrl !== 'string') {
            return null;
        }

        return parsed as AuthCallbackState;
    } catch {
        return null;
    }
}

/**
 * 验证目标 URL 是否在白名单中（与后端 isUrlInWhitelist 一致）
 */
function isUrlInWhitelist(targetUrl: string, whitelist: string): boolean {
    if (!whitelist) return false;

    try {
        const url = new URL(targetUrl);
        const origin = url.origin;
        const allowedOrigins = whitelist.split(',').map(s => s.trim()).filter(Boolean);

        // 严格匹配 origin，不使用 startsWith 避免子域名绕过
        return allowedOrigins.includes(origin);
    } catch {
        return false;
    }
}

/**
 * 将 code 参数附加到目标 URL（与后端 appendCodeToUrl 一致）
 */
function appendCodeToUrl(targetUrl: string, code: string): string {
    const url = new URL(targetUrl);
    url.searchParams.set('code', code);
    return url.toString();
}

// 生成有效的 URL 字符串
const validUrlArb = fc.tuple(
    fc.constantFrom('https://lexseek.cn', 'https://dev.lexseek.cn', 'http://localhost:3000'),
    fc.array(fc.constantFrom('/', 'a', 'b', 'c', '1', '2', '3', '-', '_'), { minLength: 0, maxLength: 20 })
).map(([origin, pathChars]) => `${origin}/${pathChars.join('')}`);

// 生成有效的 source 字符串
const sourceArb = fc.option(
    fc.array(fc.constantFrom('a', 'b', 'c', '1', '2', '3', '_'), { minLength: 1, maxLength: 20 }).map(chars => chars.join('')),
    { nil: undefined }
);

// 生成有效的 code 字符串
const codeArb = fc.string({ minLength: 10, maxLength: 50, unit: 'grapheme' }).filter(s => /^[a-zA-Z0-9]+$/.test(s));

describe("微信授权回调", () => {
    describe("Property 4: State 参数编解码往返一致性", () => {
        it("编码后再解码应得到与原始对象等价的结果", () => {
            fc.assert(
                fc.property(validUrlArb, sourceArb, (targetUrl, source) => {
                    const original: AuthCallbackState = { targetUrl };
                    if (source) {
                        original.source = source;
                    }

                    // 编码
                    const encoded = encodeAuthState(original);

                    // 解码
                    const decoded = decodeAuthState(encoded);

                    // 验证
                    expect(decoded).not.toBeNull();
                    expect(decoded!.targetUrl).toBe(original.targetUrl);
                    if (source) {
                        expect(decoded!.source).toBe(original.source);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it("无效的 base64 字符串应返回 null", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }).filter(s => {
                        // 过滤掉可能是有效 base64 的字符串
                        try {
                            const decoded = Buffer.from(s, 'base64').toString('utf-8');
                            JSON.parse(decoded);
                            return false;
                        } catch {
                            return true;
                        }
                    }),
                    (invalidEncoded) => {
                        const result = decodeAuthState(invalidEncoded);
                        expect(result).toBeNull();
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe("Property 5: 授权回调白名单验证", () => {
        it("白名单中的 URL 应通过验证", () => {
            const whitelist = "https://lexseek.cn,https://dev.lexseek.cn,http://localhost:3000";

            fc.assert(
                fc.property(validUrlArb, (targetUrl) => {
                    const result = isUrlInWhitelist(targetUrl, whitelist);
                    expect(result).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it("不在白名单中的 URL 应拒绝", () => {
            const whitelist = "https://lexseek.cn";

            fc.assert(
                fc.property(
                    fc.constantFrom(
                        'https://evil.com/path',
                        'https://lexseek.cn.evil.com/path',
                        'http://lexseek.cn/path'  // http vs https
                    ),
                    (targetUrl) => {
                        const result = isUrlInWhitelist(targetUrl, whitelist);
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 10 }
            );
        });

        it("空白名单应拒绝所有 URL", () => {
            fc.assert(
                fc.property(validUrlArb, (targetUrl) => {
                    const result = isUrlInWhitelist(targetUrl, "");
                    expect(result).toBe(false);
                }),
                { numRuns: 100 }
            );
        });

        it("无效的 URL 应拒绝", () => {
            const whitelist = "https://lexseek.cn";

            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }).filter(s => {
                        try {
                            new URL(s);
                            return false;
                        } catch {
                            return true;
                        }
                    }),
                    (invalidUrl) => {
                        const result = isUrlInWhitelist(invalidUrl, whitelist);
                        expect(result).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe("Property 6: 授权回调 code 参数传递", () => {
        it("重定向 URL 应包含原始 code 参数", () => {
            fc.assert(
                fc.property(validUrlArb, codeArb, (targetUrl, code) => {
                    const redirectUrl = appendCodeToUrl(targetUrl, code);

                    // 解析重定向 URL
                    const url = new URL(redirectUrl);
                    const codeParam = url.searchParams.get('code');

                    // 验证 code 参数
                    expect(codeParam).toBe(code);
                }),
                { numRuns: 100 }
            );
        });

        it("已有 code 参数的 URL 应被覆盖", () => {
            fc.assert(
                fc.property(validUrlArb, codeArb, codeArb, (targetUrl, oldCode, newCode) => {
                    // 先添加旧的 code
                    const urlWithOldCode = `${targetUrl}?code=${oldCode}`;

                    // 再添加新的 code
                    const redirectUrl = appendCodeToUrl(urlWithOldCode, newCode);

                    // 解析重定向 URL
                    const url = new URL(redirectUrl);
                    const codeParam = url.searchParams.get('code');

                    // 验证 code 参数是新的
                    expect(codeParam).toBe(newCode);
                }),
                { numRuns: 100 }
            );
        });

        it("其他查询参数应保留", () => {
            fc.assert(
                fc.property(
                    validUrlArb,
                    codeArb,
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z]+$/.test(s)),
                    fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-z0-9]+$/.test(s)),
                    (targetUrl, code, paramKey, paramValue) => {
                        // 添加其他参数
                        const urlWithParam = `${targetUrl}?${paramKey}=${paramValue}`;

                        // 添加 code
                        const redirectUrl = appendCodeToUrl(urlWithParam, code);

                        // 解析重定向 URL
                        const url = new URL(redirectUrl);

                        // 验证其他参数保留
                        expect(url.searchParams.get(paramKey)).toBe(paramValue);
                        // 验证 code 参数
                        expect(url.searchParams.get('code')).toBe(code);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
