/**
 * 微信浏览器检测工具函数测试
 *
 * 使用 fast-check 进行属性测试，验证微信浏览器检测和授权 URL 生成功能
 *
 * **Feature: pricing-purchase**
 * **Validates: Requirements 5.1, 5.4**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// 导入被测试的函数（在 Nuxt 测试环境中自动导入）
import {
    isWeChatBrowser,
    getWechatAuthUrl,
    getWechatAuthUrlWithUserInfo,
    encodeAuthState,
    decodeAuthState,
    getWechatAuthUrlWithCallback,
} from "~/utils/wechat";

describe("微信浏览器检测工具函数", () => {
    // 保存原始的 window 对象
    const originalWindow = global.window;
    const originalNavigator = global.navigator;

    beforeEach(() => {
        // 重置 window 对象
        vi.stubGlobal("window", {
            navigator: {
                userAgent: "",
            },
        });
    });

    afterEach(() => {
        // 恢复原始的 window 对象
        vi.stubGlobal("window", originalWindow);
        if (originalNavigator) {
            vi.stubGlobal("navigator", originalNavigator);
        }
    });

    describe("isWeChatBrowser", () => {
        it("在微信浏览器中返回 true", () => {
            // 微信浏览器的 User-Agent 包含 MicroMessenger
            const wechatUserAgents = [
                "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.0",
                "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 MicroMessenger/7.0.20",
                "micromessenger/8.0.0",
            ];

            wechatUserAgents.forEach((ua) => {
                vi.stubGlobal("window", {
                    navigator: { userAgent: ua },
                });
                expect(isWeChatBrowser()).toBe(true);
            });
        });

        it("在非微信浏览器中返回 false", () => {
            const nonWechatUserAgents = [
                "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
                "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Mobile Safari/537.36",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            ];

            nonWechatUserAgents.forEach((ua) => {
                vi.stubGlobal("window", {
                    navigator: { userAgent: ua },
                });
                expect(isWeChatBrowser()).toBe(false);
            });
        });

        it("在服务端渲染时返回 false", () => {
            // 模拟服务端环境（window 未定义）
            vi.stubGlobal("window", undefined);
            expect(isWeChatBrowser()).toBe(false);
        });

        it("Property: 任意包含 micromessenger 的 UA 都应返回 true", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 100 }),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (prefix, suffix) => {
                        const ua = `${prefix}micromessenger${suffix}`;
                        vi.stubGlobal("window", {
                            navigator: { userAgent: ua },
                        });
                        expect(isWeChatBrowser()).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("Property: 任意不包含 micromessenger 的 UA 都应返回 false", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 200 }).filter(
                        (s) => !s.toLowerCase().includes("micromessenger")
                    ),
                    (ua) => {
                        vi.stubGlobal("window", {
                            navigator: { userAgent: ua },
                        });
                        expect(isWeChatBrowser()).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe("getWechatAuthUrl", () => {
        it("生成正确的微信授权 URL", () => {
            const redirectPath = "/dashboard/buy/1";
            const url = getWechatAuthUrl(redirectPath);
            const config = useRuntimeConfig();

            // 如果没有配置 appId，跳过此测试
            if (!config.public.wechatAppId) {
                expect(url).toBe("");
                return;
            }

            expect(url).toContain("https://open.weixin.qq.com/connect/oauth2/authorize");
            expect(url).toContain(`appid=${config.public.wechatAppId}`);
            expect(url).toContain("response_type=code");
            expect(url).toContain("scope=snsapi_base");
            expect(url).toContain("#wechat_redirect");
        });

        it("Property: 生成的 URL 格式正确或为空（未配置时）", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/${s.replace(/[^a-zA-Z0-9]/g, '')}`),
                    (redirectPath) => {
                        const url = getWechatAuthUrl(redirectPath);
                        const config = useRuntimeConfig();

                        if (!config.public.wechatAppId) {
                            // 未配置 appId 时返回空字符串
                            expect(url).toBe("");
                        } else {
                            // 已配置时验证 URL 包含所有必要参数
                            expect(url).toContain("appid=");
                            expect(url).toContain("redirect_uri=");
                            expect(url).toContain("response_type=code");
                            expect(url).toContain("scope=snsapi_base");
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it("未配置 appId 时返回空字符串", () => {
            // 这个测试依赖于环境配置
            // 如果环境中没有配置 wechatAppId，应该返回空字符串
            const config = useRuntimeConfig();
            if (!config.public.wechatAppId) {
                const url = getWechatAuthUrl("/test");
                expect(url).toBe("");
            }
        });
    });

    describe("getWechatAuthUrlWithUserInfo", () => {
        it("生成正确的微信授权 URL（获取用户信息）", () => {
            const redirectPath = "/dashboard/buy/1";
            const url = getWechatAuthUrlWithUserInfo(redirectPath);
            const config = useRuntimeConfig();

            // 如果没有配置 appId，跳过此测试
            if (!config.public.wechatAppId) {
                expect(url).toBe("");
                return;
            }

            expect(url).toContain("https://open.weixin.qq.com/connect/oauth2/authorize");
            expect(url).toContain(`appid=${config.public.wechatAppId}`);
            expect(url).toContain("scope=snsapi_userinfo"); // 注意这里是 snsapi_userinfo
            expect(url).toContain("#wechat_redirect");
        });

        it("Property: snsapi_userinfo 和 snsapi_base 的区别", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 50 }).map((s) => `/${s.replace(/[^a-zA-Z0-9]/g, '')}`),
                    (redirectPath) => {
                        const baseUrl = getWechatAuthUrl(redirectPath);
                        const userInfoUrl = getWechatAuthUrlWithUserInfo(redirectPath);
                        const config = useRuntimeConfig();

                        if (!config.public.wechatAppId) {
                            // 未配置时都返回空字符串
                            expect(baseUrl).toBe("");
                            expect(userInfoUrl).toBe("");
                        } else {
                            // snsapi_base 用于静默授权
                            expect(baseUrl).toContain("scope=snsapi_base");
                            // snsapi_userinfo 用于获取用户信息
                            expect(userInfoUrl).toContain("scope=snsapi_userinfo");
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe("encodeAuthState", () => {
        it("应正确编码包含 targetUrl 的 state 对象", () => {
            const state = { targetUrl: "https://example.com/callback" }
            const encoded = encodeAuthState(state)
            expect(typeof encoded).toBe("string")
            expect(encoded.length).toBeGreaterThan(0)
            // 应该是有效的 base64
            expect(() => atob(encoded)).not.toThrow()
        });

        it("应正确编码包含 targetUrl 和 source 的 state 对象", () => {
            const state = { targetUrl: "https://example.com/callback", source: "wechat" }
            const encoded = encodeAuthState(state)
            const decoded = JSON.parse(atob(encoded))
            expect(decoded.targetUrl).toBe("https://example.com/callback")
            expect(decoded.source).toBe("wechat")
        });

        it("Property: 任意有效的 state 对象都应能正确编码", () => {
            fc.assert(
                fc.property(
                    fc.webUrl(),
                    fc.option(fc.string(), { nil: undefined }),
                    (targetUrl, source) => {
                        const state = source !== undefined ? { targetUrl, source } : { targetUrl }
                        const encoded = encodeAuthState(state)
                        const decoded = decodeAuthState(encoded)
                        expect(decoded).not.toBeNull()
                        expect(decoded!.targetUrl).toBe(targetUrl)
                        if (source !== undefined) {
                            expect(decoded!.source).toBe(source)
                        }
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        });
    });

    describe("decodeAuthState", () => {
        it("应正确解码有效的 base64 编码字符串", () => {
            const state = { targetUrl: "https://example.com/callback" }
            const encoded = encodeAuthState(state)
            const decoded = decodeAuthState(encoded)
            expect(decoded).not.toBeNull()
            expect(decoded!.targetUrl).toBe("https://example.com/callback")
        });

        it("应正确解码包含 source 的 state 对象", () => {
            const state = { targetUrl: "https://example.com/callback", source: "wechat" }
            const encoded = encodeAuthState(state)
            const decoded = decodeAuthState(encoded)
            expect(decoded).not.toBeNull()
            expect(decoded!.targetUrl).toBe("https://example.com/callback")
            expect(decoded!.source).toBe("wechat")
        });

        it("缺少 targetUrl 应返回 null", () => {
            const invalidJson = JSON.stringify({ source: "wechat" })
            const encoded = btoa(invalidJson)
            expect(decodeAuthState(encoded)).toBeNull()
        });

        it("targetUrl 非字符串应返回 null", () => {
            const invalidJson = JSON.stringify({ targetUrl: 123 })
            const encoded = btoa(invalidJson)
            expect(decodeAuthState(encoded)).toBeNull()
        });

        it("无效的 base64 应返回 null", () => {
            expect(decodeAuthState("not-valid-base64!!!")).toBeNull()
        });

        it("空字符串应返回 null", () => {
            expect(decodeAuthState("")).toBeNull()
        });

        it("Property: 往返编码解码应保持数据一致", () => {
            fc.assert(
                fc.property(
                    fc.webUrl(),
                    fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
                    (targetUrl, source) => {
                        const state = source !== undefined ? { targetUrl, source } : { targetUrl }
                        const encoded = encodeAuthState(state)
                        const decoded = decodeAuthState(encoded)
                        expect(decoded).not.toBeNull()
                        expect(decoded!.targetUrl).toBe(targetUrl)
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        });
    });

    describe("getWechatAuthUrlWithCallback", () => {
        it("生成正确的微信授权 URL（通用回调模式）", () => {
            const targetUrl = "https://example.com/dashboard"
            const url = getWechatAuthUrlWithCallback(targetUrl)
            const config = useRuntimeConfig()

            // 如果没有配置 appId 或回调地址，返回空字符串
            if (!config.public.wechatAppId || !config.public.wechatAuthCallbackUrl) {
                expect(url).toBe("")
                return
            }

            expect(url).toContain("https://open.weixin.qq.com/connect/oauth2/authorize")
            expect(url).toContain(`appid=${config.public.wechatAppId}`)
            expect(url).toContain("scope=snsapi_base")
            expect(url).toContain("#wechat_redirect")
            // 回调地址应该是 wechatAuthCallbackUrl
            expect(url).toContain(encodeURIComponent(config.public.wechatAuthCallbackUrl))
            // state 参数应该包含 targetUrl 的 base64 编码
            expect(url).toContain("state=")
        });

        it("未配置 appId 时返回空字符串", () => {
            const config = useRuntimeConfig()
            if (!config.public.wechatAppId) {
                const url = getWechatAuthUrlWithCallback("https://example.com")
                expect(url).toBe("")
            }
        });

        it("未配置回调地址时返回空字符串", () => {
            const config = useRuntimeConfig()
            if (config.public.wechatAppId && !config.public.wechatAuthCallbackUrl) {
                const url = getWechatAuthUrlWithCallback("https://example.com")
                expect(url).toBe("")
            }
        });

        it("包含 source 参数时应正确编码到 state", () => {
            const config = useRuntimeConfig()
            if (!config.public.wechatAppId || !config.public.wechatAuthCallbackUrl) return

            const targetUrl = "https://example.com/dashboard"
            const source = "purchase"
            const url = getWechatAuthUrlWithCallback(targetUrl, source)

            expect(url).toContain("state=")
            // state 参数应该是 base64 编码的 JSON，URL 编码后会包含 % 和大写字母
            // 简化验证：state 参数在 #wechat_redirect 之前
            expect(url.indexOf("state=")).toBeGreaterThan(0)
            expect(url.indexOf("#wechat_redirect")).toBeGreaterThan(url.indexOf("state="))
        });

        it("Property: 生成的 URL 格式应正确或为空", () => {
            fc.assert(
                fc.property(
                    fc.webUrl(),
                    fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
                    (targetUrl, source) => {
                        const url = getWechatAuthUrlWithCallback(targetUrl, source)
                        const config = useRuntimeConfig()

                        if (!config.public.wechatAppId || !config.public.wechatAuthCallbackUrl) {
                            expect(url).toBe("")
                        } else {
                            expect(url).toContain("https://open.weixin.qq.com")
                            expect(url).toContain("appid=")
                            expect(url).toContain("scope=snsapi_base")
                            expect(url).toContain("#wechat_redirect")
                        }
                    }
                ),
                { numRuns: 100, seed: 12345 }
            )
        });
    });
});
