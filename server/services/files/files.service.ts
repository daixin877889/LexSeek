/**
 * 文件服务
 */

import { generateSignedUrl } from '~~/server/lib/oss'
import type { ossFiles } from '#shared/types/prisma'
import type { OssConfig } from '~~/shared/types/oss'
import type { OSSConfig } from '~~/shared/types/system'

/**
 * 生成 OSS 上传预签名
 * @param bucket 
 * @param originalFileName 
 * @param maxSize 
 * @param dir 
 * @param saveName 
 * @param allowedMimeTypes 
 * @param callbackVar 
 * @returns 
 */
export async function generateOssPostSignatureService(query: {
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

/**
 * 批量下载签名结果
 */
export interface BatchDownloadSignatureResult {
    /** 文件 ID */
    ossFileId: number
    /** 文件名 */
    fileName: string
    /** 下载 URL */
    downloadUrl: string
    /** 是否加密 */
    encrypted: boolean
}

/**
 * 批量生成 OSS 下载预签名
 * @param ossFiles 文件列表
 * @param expires URL 过期时间（秒），默认 3600
 * @returns 下载签名结果数组
 */
export async function generateOssDownloadSignaturesService(query: {
    ossFiles: ossFiles[],
    expires?: number
}): Promise<BatchDownloadSignatureResult[]> {
    try {
        const { ossFiles, expires = 3600 } = query;

        if (!ossFiles || ossFiles.length === 0) {
            return [];
        }

        // 按 bucket 分组文件，避免重复获取配置
        const filesByBucket = new Map<string, ossFiles[]>();
        for (const file of ossFiles) {
            const bucket = file.bucketName;
            if (!filesByBucket.has(bucket)) {
                filesByBucket.set(bucket, []);
            }
            filesByBucket.get(bucket)!.push(file);
        }

        // 获取所有需要的 bucket 配置（并行获取）
        const bucketNames = Array.from(filesByBucket.keys());
        const configPromises = bucketNames.map(bucket =>
            getConfigsByGroupAndKeyDao('ossConfig', bucket)
        );
        const configs = await Promise.all(configPromises);

        // 构建 bucket -> OssConfig 映射
        const bucketConfigMap = new Map<string, OssConfig>();
        for (let i = 0; i < bucketNames.length; i++) {
            const bucket = bucketNames[i];
            const ossConfig = configs[i];
            if (!ossConfig) {
                logger.warn(`OSS 配置不存在: ${bucket}`);
                continue;
            }
            const ossConfigValue = ossConfig.value as unknown as OSSConfig;
            // 下载签名不使用 STS，直接使用 AK/SK
            // 因为 STS 临时凭证生成的签名 URL 需要额外的权限配置
            const config: OssConfig = {
                accessKeyId: ossConfigValue.accessKeyId,
                accessKeySecret: ossConfigValue.accessKeySecret,
                bucket,
                region: ossConfigValue.region,
                customDomain: ossConfigValue.domain,
                // 不使用 STS
            };
            bucketConfigMap.set(bucket, config);
        }

        // 并行生成所有文件的下载签名
        const signaturePromises = ossFiles.map(async (file): Promise<BatchDownloadSignatureResult | null> => {
            const config = bucketConfigMap.get(file.bucketName);
            if (!config) {
                logger.warn(`跳过文件 ${file.id}，bucket 配置不存在: ${file.bucketName}`);
                return null;
            }

            try {
                // 生成签名 URL
                const downloadUrl = await generateSignedUrl(config, file.filePath || '', {
                    expires,
                    method: 'GET',
                    response: {
                        // 设置下载时的文件名
                        contentDisposition: `attachment; filename="${encodeURIComponent(file.fileName)}"`
                    }
                });

                return {
                    ossFileId: file.id,
                    fileName: file.fileName,
                    downloadUrl,
                    encrypted: file.encrypted
                };
            } catch (err) {
                logger.error(`生成文件 ${file.id} 下载签名失败:`, err);
                return null;
            }
        });

        const results = await Promise.all(signaturePromises);

        // 过滤掉失败的结果
        return results.filter((r): r is BatchDownloadSignatureResult => r !== null);
    } catch (error: any) {
        logger.error('批量生成 OSS 下载预签名失败:', error);
        throw error;
    }
}