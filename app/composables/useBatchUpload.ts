import mime from "mime";
import { formatByteSize } from "#shared/utils/unitConverision";
import type { FileSourceAccept } from "#shared/types/file";
import type { PostSignatureResult } from "~~/shared/types/oss";
import { useFileUploadWorker } from '~/composables/useFileUploadWorker'
import { useFileStore } from '~/store/file'

export interface AcceptItem {
  name: string;
  mime: string;
  maxSize: number;
}

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export interface FileUploadState {
  id: string; // 唯一标识，通常可以用 name + size
  file: File;
  mimeType: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
  signature?: PostSignatureResult;
  result?: Record<string, unknown>; // 存储成功上传后的返回数据
}

export const useBatchUpload = () => {
  const fileStore = useFileStore();
  const uploadWorker = useFileUploadWorker();

  const detectMimeType = (file: File): string => {
    const fileName = file.name || "";
    const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
    let mimeType = file.type || "";
    if (!mimeType || mimeType.trim() === "") {
      mimeType = mime.getType(fileExtension) || "";
    }
    if (fileExtension === "md" && file.type === "text/x-markdown") {
      mimeType = "text/markdown";
    }
    return mimeType;
  };

  const validateFile = (file: File, currentScene: FileSourceAccept | null): ValidationResult => {
    if (!currentScene) {
      return { valid: false, message: "请选择上传场景" };
    }
    if (currentScene.accept && currentScene.accept.length > 0) {
      const fileName = file.name || "";
      const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
      const fileMimeType = detectMimeType(file);
      const acceptedMimeType = currentScene.accept.find((item: AcceptItem) => item.mime === fileMimeType);
      
      if (!acceptedMimeType) {
        const acceptedByExtension = currentScene.accept.find((item: AcceptItem) => item.name === fileExtension);
        if (!acceptedByExtension) {
          return { valid: false, message: `不支持的文件格式：${fileExtension || "未知"}` };
        }
        if (file.size > acceptedByExtension.maxSize) {
          return {
            valid: false,
            message: `文件大小超出限制: ${formatByteSize(file.size, 2)}，最大允许: ${formatByteSize(acceptedByExtension.maxSize, 2)}`,
          };
        }
        return { valid: true };
      }
      if (file.size > acceptedMimeType.maxSize) {
        return {
          valid: false,
          message: `文件大小超出限制: ${formatByteSize(file.size, 2)}，${acceptedMimeType.mime}最大允许: ${formatByteSize(acceptedMimeType.maxSize, 2)}`,
        };
      }
    }
    return { valid: true };
  };

  const uploadToOSS = (file: File, signature: PostSignatureResult, onProgress?: (progress: number) => void, contentType?: string): Promise<Record<string, unknown>> => {
    if (!signature.key) {
      return Promise.reject(new Error("未获取到文件路径"));
    }

    // 如果指定了 contentType，则创建一个新的 File 对象，其 type 属性被修改
    // 这在后端 Policy 强制要求特定 Content-Type（如加密文件要求 application/octet-stream）时非常有用
    const finalFile = contentType ? new File([file], file.name, { type: contentType }) : file;

    return new Promise((resolve, reject) => {
      uploadWorker.upload(finalFile, signature, {
        onProgress: (progress) => {
          onProgress?.(progress);
        },
        onSuccess: (data) => {
          resolve(data);
        },
        onError: (error) => {
          reject(error);
        },
      });
    });
  };

  return {
    detectMimeType,
    validateFile,
    uploadToOSS,
  };
};
