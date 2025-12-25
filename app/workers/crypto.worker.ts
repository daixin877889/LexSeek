/**
 * 加密/解密 Web Worker
 * 
 * 在独立线程中执行加密解密操作，避免阻塞主线程
 */

import { Decrypter, Encrypter } from 'age-encryption'

/** Worker 消息类型 */
type WorkerMessage =
    | { type: 'decrypt'; id: string; data: ArrayBuffer; identity: string }
    | { type: 'encrypt'; id: string; data: ArrayBuffer; recipient: string }

/** Worker 响应类型 */
type WorkerResponse =
    | { type: 'success'; id: string; data: ArrayBuffer }
    | { type: 'error'; id: string; error: string; errorType?: string }
    | { type: 'progress'; id: string; progress: number }

/**
 * 发送响应到主线程
 */
const postResponse = (response: WorkerResponse) => {
    if (response.type === 'success') {
        // 使用 Transferable 传输 ArrayBuffer，避免复制
        self.postMessage(response, [response.data])
    } else {
        self.postMessage(response)
    }
}

/**
 * 解密文件
 */
const decryptFile = async (id: string, data: ArrayBuffer, identity: string) => {
    try {
        postResponse({ type: 'progress', id, progress: 10 })

        const d = new Decrypter()
        d.addIdentity(identity)

        postResponse({ type: 'progress', id, progress: 30 })

        const uint8Data = new Uint8Array(data)
        const decrypted = await d.decrypt(uint8Data)

        postResponse({ type: 'progress', id, progress: 100 })

        // 返回解密后的数据
        const resultBuffer = decrypted.buffer as ArrayBuffer
        postResponse({ type: 'success', id, data: resultBuffer })
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        let errorType = 'FileCorruptedError'

        if (errorMessage.includes('no identity matched') || errorMessage.includes('no matching')) {
            errorType = 'IdentityMismatchError'
        } else if (errorMessage.includes('invalid header') || errorMessage.includes('not a valid')) {
            errorType = 'InvalidAgeFileError'
        }

        postResponse({ type: 'error', id, error: errorMessage, errorType })
    }
}

/**
 * 加密文件
 */
const encryptFile = async (id: string, data: ArrayBuffer, recipient: string) => {
    try {
        postResponse({ type: 'progress', id, progress: 10 })

        const e = new Encrypter()
        e.addRecipient(recipient)

        postResponse({ type: 'progress', id, progress: 30 })

        const uint8Data = new Uint8Array(data)
        const encrypted = await e.encrypt(uint8Data)

        postResponse({ type: 'progress', id, progress: 100 })

        // 返回加密后的数据
        const resultBuffer = encrypted.buffer as ArrayBuffer
        postResponse({ type: 'success', id, data: resultBuffer })
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        postResponse({ type: 'error', id, error: errorMessage })
    }
}

/**
 * 监听主线程消息
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data

    switch (message.type) {
        case 'decrypt':
            await decryptFile(message.id, message.data, message.identity)
            break
        case 'encrypt':
            await encryptFile(message.id, message.data, message.recipient)
            break
    }
}

// 标记 Worker 已就绪
self.postMessage({ type: 'ready' })
