/**
 * 手机号脱敏
 * @param {string} phone 手机号
 * @returns {string} 脱敏后的手机号
 */
export const maskPhone = (phone: string): string => {
    if (!phone || typeof phone !== 'string') {
        // throw new Error('请输入有效的手机号');
        return phone;
    }

    // 校验手机号格式（简单校验）
    const phoneRegex = /^1\d{10}$/;
    if (!phoneRegex.test(phone)) {
        // throw new Error('手机号格式不正确');
        return phone;
    }

    // 脱敏处理：保留前 3 位和后 4 位，中间用 **** 替换
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

/**
 * 通用电话号码脱敏
 * @param {string} tel 电话号码
 * @returns {string} 脱敏后的电话号码
 */
export const maskTel = (tel: string): string => {
    if (!tel || typeof tel !== 'string') {
        // throw new Error('请输入有效的电话号码');
        return tel;
    }

    // 手机号脱敏
    if (/^1\d{10}$/.test(tel)) {
        return tel.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    }

    // 固定电话脱敏（示例：010-12345678）
    if (/^\d{3,4}-\d{7,8}$/.test(tel)) {
        return tel.replace(/(\d{3,4}-)\d{4}/, '$1****');
    }

    // 国际号码脱敏（示例：+86-13812345678）
    if (/^\+\d{1,4}-\d{6,14}$/.test(tel)) {
        return tel.replace(/(\+\d{1,4}-)\d{4}(\d{4})/, '$1****$2');
    }
    return tel;
    // throw new Error('电话号码格式不支持');

}


/**
 * 验证手机号
 * @param {string} phoneNumber 手机号
 * @returns {boolean} 验证结果
 */
export const validatePhone = (phoneNumber: string): boolean => {
    const phoneRegex = /^1[3-9]\d{9}$/;
    return phoneRegex.test(phoneNumber);
}
