// @ts-ignore
import OSS from "ali-oss"

// 自定义工具函数，避免直接导入 ali-oss 内部 TypeScript 模块
function getStandardRegion(str: string): string {
    return str.replace(/^oss-/g, '');
}

function policy2Str(policy: object): string {
    return JSON.stringify(policy);
}

function getCredential(date: string, region: string, accessKeyId: string): string {
    return `${accessKeyId}/${date}/${region}/oss/aliyun_v4_request`;
}


let client: any = null

export async function getOssClient() {
    const config = useRuntimeConfig()

    // 初始化STS客户端
    let sts = new OSS.STS({
        accessKeyId: "LTAI5tKjkmyusj6Vb8RU9RxM",
        accessKeySecret: "DMgjeS7xftgMakV1aPWiVRr63g24Fb"
    });

    const result = await sts.assumeRole("acs:ram::1857010335484493:role/oss", '', '3600', 'OSS');

    // 提取临时访问凭证中的AccessKeyId、AccessKeySecret和SecurityToken
    const accessKeyId = result.credentials.AccessKeyId;
    const accessKeySecret = result.credentials.AccessKeySecret;
    const securityToken = result.credentials.SecurityToken;


    // 初始化OSS Client
    const client = new OSS({
        bucket: 'lexseek-files', // 请替换为目标Bucket名称
        region: 'cn-hangzhou', // 请替换为标Bucket所在地域
        accessKeyId,
        accessKeySecret,
        stsToken: securityToken,
        refreshSTSTokenInterval: 0,
        refreshSTSToken: async () => {
            const { accessKeyId, accessKeySecret, securityToken } = await client.getCredential();
            return { accessKeyId, accessKeySecret, stsToken: securityToken };
        },
    });


    // 创建表单数据Map
    const formData = new Map();

    // 设置签名过期时间为当前时间往后推10分钟 
    const date = new Date();
    const expirationDate = new Date(date);
    expirationDate.setMinutes(date.getMinutes() + 10);

    // 格式化日期为符合ISO 8601标准的UTC时间字符串格式
    function padTo2Digits(num: number) {
        return num.toString().padStart(2, '0');
    }

    function formatDateToUTC(date: Date) {
        return (
            date.getUTCFullYear() +
            padTo2Digits(date.getUTCMonth() + 1) +
            padTo2Digits(date.getUTCDate()) +
            'T' +
            padTo2Digits(date.getUTCHours()) +
            padTo2Digits(date.getUTCMinutes()) +
            padTo2Digits(date.getUTCSeconds()) +
            'Z'
        );
    }

    const formattedDate = formatDateToUTC(expirationDate);
    // 设置上传回调URL，即回调服务器地址，用于处理应用服务器与OSS之间的通信。OSS会在文件上传完成后，把文件上传信息通过此回调URL发送给应用服务器。例如callbackUrl填写为https://oss-demo.aliyuncs.com:23450。

    // 生成x-oss-credential并设置表单数据
    const credential = getCredential(formattedDate.split('T')[0], getStandardRegion(client.options.region), client.options.accessKeyId);
    formData.set('x_oss_date', formattedDate);
    formData.set('x_oss_credential', credential);
    formData.set('x_oss_signature_version', 'OSS4-HMAC-SHA256');

    // 创建policy
    // 示例policy表单域只列举必填字段
    const policy: {
        expiration: string;
        conditions: Array<Record<string, string>>;
    } = {
        expiration: expirationDate.toISOString(),
        conditions: [
            { 'bucket': 'lexseek-files' }, // 请替换为目标Bucket名称
            { 'x-oss-credential': credential },
            { 'x-oss-signature-version': 'OSS4-HMAC-SHA256' },
            { 'x-oss-date': formattedDate },
        ],
    };

    // 如果存在STS Token，添加到策略和表单数据中
    if (client.options.stsToken) {
        policy.conditions.push({ 'x-oss-security-token': client.options.stsToken });
        formData.set('security_token', client.options.stsToken);
    }

    // 生成签名并设置表单数据
    const signature = client.signPostObjectPolicyV4(policy, date);
    const policyStr = policy2Str(policy);
    formData.set('policy', Buffer.from(policyStr, 'utf8').toString('base64'));
    formData.set('signature', signature);
    const callback = {
        callbackUrl: 'http://lsd.lexseek.cn/api/v1/callback/oss',
        callbackBody: "filename=${object}&size=${size}&mimeType=${mimeType}&etag=${etag}",
        callbackBodyType: "application/x-www-form-urlencoded",
    };

    // 返回表单数据
    return {
        host: `http://${client.options.bucket}.oss-${client.options.region}.aliyuncs.com`,
        policy: Buffer.from(policyStr, 'utf8').toString('base64'),
        x_oss_signature_version: 'OSS4-HMAC-SHA256',
        x_oss_credential: credential,
        x_oss_date: formattedDate,
        signature: signature,
        dir: 'user-dir', // 指定上传到OSS的文件前缀
        callback: Buffer.from(JSON.stringify(callback)).toString("base64"),// 通过Buffer.from对JSON进行Base64编码。
        security_token: client.options.stsToken
    };

}



