/**
 * 文件相关工具函数
 * 提供文件图标、颜色、类型判断等通用方法
 */

import {
    FileTextIcon,
    ImageIcon,
    MusicIcon,
    VideoIcon,
    FileIcon,
} from "lucide-vue-next";


/**
 * 根据文件 MIME 类型获取对应的图标组件
 * @param fileType - 文件的 MIME 类型
 * @returns 对应的 Lucide 图标组件
 */
export const getFileIcon = (fileType: string): Component => {
    if (!fileType) return FileIcon;
    if (fileType.includes("image")) return ImageIcon;
    if (fileType.includes("audio")) return MusicIcon;
    if (fileType.includes("video")) return VideoIcon;
    if (
        fileType.includes("pdf") ||
        fileType.includes("document") ||
        fileType.includes("text") ||
        fileType.includes("word")
    ) {
        return FileTextIcon;
    }
    if (fileType.includes("json")) return FileIcon;
    return FileIcon;
};

/**
 * 根据文件 MIME 类型获取图标背景色 CSS 类名
 * @param fileType - 文件的 MIME 类型
 * @returns Tailwind CSS 背景色类名
 */
export const getFileIconBg = (fileType: string): string => {
    if (!fileType) return "bg-gray-100";
    if (fileType.includes("image")) return "bg-purple-100";
    if (fileType.includes("audio")) return "bg-green-100";
    if (fileType.includes("video")) return "bg-red-100";
    if (
        fileType.includes("pdf") ||
        fileType.includes("document") ||
        fileType.includes("text") ||
        fileType.includes("word")
    ) {
        return "bg-blue-100";
    }
    if (fileType.includes("json")) return "bg-yellow-100";
    return "bg-gray-100";
};

/**
 * 根据文件 MIME 类型获取图标颜色 CSS 类名
 * @param fileType - 文件的 MIME 类型
 * @returns Tailwind CSS 文字颜色类名
 */
export const getFileIconColor = (fileType: string): string => {
    if (!fileType) return "text-gray-500";
    if (fileType.includes("image")) return "text-purple-600";
    if (fileType.includes("audio")) return "text-green-600";
    if (fileType.includes("video")) return "text-red-600";
    if (
        fileType.includes("pdf") ||
        fileType.includes("document") ||
        fileType.includes("text") ||
        fileType.includes("word")
    ) {
        return "text-blue-600";
    }
    if (fileType.includes("json")) return "text-yellow-600";
    return "text-gray-500";
};

/**
 * 判断文件类型是否为图片
 * @param fileType - 文件的 MIME 类型
 * @returns 是否为图片类型
 */
export const isImageType = (fileType: string): boolean => {
    return fileType?.includes("image") || false;
};

/**
 * 判断文件类型是否为音频
 * @param fileType - 文件的 MIME 类型
 * @returns 是否为音频类型
 */
export const isAudioType = (fileType: string): boolean => {
    return fileType?.includes("audio") || false;
};

/**
 * 判断文件类型是否为视频
 * @param fileType - 文件的 MIME 类型
 * @returns 是否为视频类型
 */
export const isVideoType = (fileType: string): boolean => {
    return fileType?.includes("video") || false;
};

/**
 * 判断文件是否可预览（图片或音频）
 * @param fileType - 文件的 MIME 类型
 * @returns 是否可预览
 */
export const canPreviewFile = (fileType: string): boolean => {
    return isImageType(fileType) || isAudioType(fileType);
};

// ==================== HEIC/HEIF 格式处理 ====================

/** HEIC/HEIF 相关的 MIME 类型 */
const HEIC_MIME_TYPES = [
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
];

/** HEIC/HEIF 文件扩展名 */
const HEIC_EXTENSIONS = [".heic", ".heif"];

/**
 * 判断是否为 HEIC/HEIF 格式
 * @param mimeType - 文件的 MIME 类型
 * @param fileName - 文件名
 * @returns 是否为 HEIC/HEIF 格式
 */
export const isHeicFormat = (mimeType: string, fileName: string): boolean => {
    // 检查 MIME 类型
    if (HEIC_MIME_TYPES.includes(mimeType.toLowerCase())) {
        return true;
    }
    // 检查文件扩展名
    const lowerFileName = fileName.toLowerCase();
    return HEIC_EXTENSIONS.some((ext) => lowerFileName.endsWith(ext));
};

/**
 * 将 HEIC 格式转换为 JPEG
 * 使用 heic2any 库进行转换
 * @param objectUrl - HEIC 文件的 Object URL
 * @returns 转换后的 JPEG Object URL
 */
export const convertHeicToJpeg = async (objectUrl: string): Promise<string> => {
    try {
        // 动态导入 heic2any 库
        const heic2any = (await import("heic2any")).default;

        // 获取 HEIC 文件的 Blob
        const response = await fetch(objectUrl);
        const heicBlob = await response.blob();

        // 转换为 JPEG
        const jpegBlob = await heic2any({
            blob: heicBlob,
            toType: "image/jpeg",
            quality: 0.9,
        });

        // 释放原始 Object URL
        URL.revokeObjectURL(objectUrl);

        // 处理返回结果（可能是数组或单个 Blob）
        const resultBlob = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;
        if (!resultBlob) {
            throw new Error("HEIC 转换结果为空");
        }

        return URL.createObjectURL(resultBlob);
    } catch (err) {
        console.error("HEIC 转换失败:", err);
        // 转换失败时返回原始 URL
        return objectUrl;
    }
};
