// 用户身份验证相关工具函数

/**
 * 获取存储的 token
 * @returns {string|null}
 */
export function getToken(): string | null {
    return localStorage.getItem('token');
}

/**
 * 保存 token 到本地存储
 * @param {string} token - JWT token
 * @param {boolean} rememberMe - 是否记住用户
 * @param {string} account - 用户手机号
 */
export function setToken(token: string, rememberMe: boolean = false, account: string = '') {
    localStorage.setItem('token', token);

    if (rememberMe) {
        localStorage.setItem('rememberMe', 'true');
        // 如果选择记住我，保存账号信息
        if (account) {
            localStorage.setItem('rememberedAccount', account);
        }
    } else {
        // 如果不记住，清除之前可能保存的账号
        localStorage.removeItem('rememberedAccount');
    }

}

/**
 * 单独的记住我工具函数
 * @returns {boolean}
 */
export function rememberMeHandler(rememberMe: boolean = false, account: string = '') {
    // 检查是否选择了记住我
    if (rememberMe) {
        localStorage.setItem('rememberMe', 'true');
        // 如果选择记住我，保存账号信息
        if (account) {
            localStorage.setItem('rememberedAccount', account);
        }
    } else {
        localStorage.removeItem('rememberMe');
        localStorage.removeItem('rememberedAccount');
    }
}

/**
 * 获取记住的账号
 * @returns {string|null}
 */
export function getRememberedAccount(): string | null {
    return localStorage.getItem('rememberedAccount');
}

/**
 * 移除本地存储的 token 和账号信息
 */
export function removeToken(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('rememberMe');
    // 不删除记住的账号，这样用户下次打开登录页时仍能看到账号
    // localStorage.removeItem('rememberedAccount');
}

/**
 * 检查用户是否已登录
 * @returns {boolean}
 */
export function isLoggedIn(): boolean {
    return !!getToken();
} 