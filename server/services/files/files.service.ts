/**
 * 文件服务
 */
export async function generateOssPostSignature(query: {
    bucket: string,
    originalFileName: string,
    maxSize: number,
    dir: string,
    saveName: string,
    allowedMimeTypes: string[],
    callbackVar?: Record<string, string | number>
},

): Promise<PostSignatureResult> {
    try {
        const { bucket, originalFileName, maxSize, dir, saveName, allowedMimeTypes, callbackVar } = query;
        // 获取回调URL
        const config = useRuntimeConfig();
        const callbackUrl = config.aliyun.oss.callbackUrl;

        // 获取OSS配置
        const ossConfig = await getConfigsByGroupAndKeyDao('ossConfig', bucket);
        if (!ossConfig) {
            throw new Error('OSS配置不存在');
        }
        const ossConfigValue = ossConfig.value as unknown as OSSConfig;

        // 生成OSS配置
        const configWithSts: OssConfig = {
            accessKeyId: ossConfigValue.accessKeyId,
            accessKeySecret: ossConfigValue.accessKeySecret,
            bucket,
            region: ossConfigValue.region,
            customDomain: ossConfigValue.domain,  // 使用自定义域名
            sts: {
                roleArn: ossConfigValue.roleArn ?? '',
                roleSessionName: ossConfigValue.roleSessionName ?? 'OSS',  // 可选
                durationSeconds: ossConfigValue.expiration ?? 3600             // 可选，默认 3600
            }
        }

        logger.info('oss配置：', { bucket: bucket, callbackUrl: callbackUrl });


        // 生成签名
        const signature = await OSS.generatePostSignature(configWithSts, {
            // 文件目录前缀
            dir: dir,
            // 文件名生成选项
            fileKey: {
                originalFileName,
                strategy: 'custom',  // 使用 UUID 生成文件名
                customFileName: saveName,
            },
            // 签名过期时间（分钟），默认 10
            expirationMinutes: 10,
            // 回调配置（可选）
            callback: {
                callbackUrl: callbackUrl,
                callbackBody: 'filename=${object}&size=${size}&mimeType=${mimeType}',
                callbackBodyType: 'application/x-www-form-urlencoded',
                // 自定义回调参数
                callbackVar
            },
            // 策略条件（可选）
            conditions: {
                // 文件大小限制 [最小, 最大]（字节）
                contentLengthRange: [0, maxSize],  // 最大 10MB
                // 允许的文件类型
                contentType: allowedMimeTypes
            }
        })
        return signature;

    } catch (error: any) {
        throw error;
    }
}