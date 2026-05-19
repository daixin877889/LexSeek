# 适配器工厂模式

LexSeek 在支付（Payment）、存储（Storage）和 OSS 三个模块中使用了统一的适配器工厂模式，通过接口抽象屏蔽底层服务商差异，实现即插即用的多供应商支持。

## 模式结构

Payment 与 Storage 两个模块遵循相同的文件骨架（`types.ts` / `errors.ts` / `base.ts` / `adapters/` / `factory.ts` / `index.ts`），但 `adapters/` 目录内的具体实现按模块各不相同：

```
server/lib/payment/
├── types.ts          # 配置、参数、结果类型定义
├── errors.ts         # 模块专用错误类层级
├── base.ts           # 抽象基类（实现接口 + 公共方法）
├── adapters/         # 具体适配器实现
│   └── wechat-pay.ts # 当前仅微信支付一种
├── factory.ts        # 工厂函数（创建 + 缓存）
└── index.ts          # 统一导出

server/lib/storage/
├── types.ts          # 配置、参数、结果类型定义
├── errors.ts         # 模块专用错误类层级
├── base.ts           # 抽象基类（实现接口 + 公共方法）
├── adapters/         # 具体适配器实现
│   ├── aliyun-oss.ts # 阿里云 OSS（复用 server/lib/oss）
│   ├── qiniu.ts      # 七牛云
│   └── tencent-cos.ts # 腾讯云 COS
├── factory.ts        # 工厂类（创建 + 缓存 + 自定义注册表）
└── index.ts          # 统一导出
```

## 一、Payment 支付模块

### 接口定义

```typescript
// server/lib/payment/base.ts

export interface IPaymentAdapter {
    getChannel(): PaymentChannel
    getSupportedMethods(): PaymentMethod[]
    createPayment(params: CreatePaymentParams): Promise<PaymentResult>
    verifyCallback(data: CallbackData): Promise<CallbackVerifyResult>
    queryOrder(params: QueryOrderParams): Promise<QueryOrderResult>
    closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>
}
```

### 抽象基类

```typescript
// server/lib/payment/base.ts

export abstract class BasePaymentAdapter<T extends PaymentConfig>
    implements IPaymentAdapter {
    protected config: T

    constructor(config: T) {
        this.config = config
        this.validateConfig()  // 构造时强制验证配置
    }

    protected abstract validateConfig(): void
    abstract getChannel(): PaymentChannel
    abstract getSupportedMethods(): PaymentMethod[]
    abstract createPayment(params: CreatePaymentParams): Promise<PaymentResult>
    abstract verifyCallback(data: CallbackData): Promise<CallbackVerifyResult>
    abstract queryOrder(params: QueryOrderParams): Promise<QueryOrderResult>
    abstract closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>

    // 公共工具方法
    protected generateNonceStr(length = 32): string { /* ... */ }
    protected getTimestamp(): number { /* ... */ }
}
```

### WeChat Pay 适配器

微信支付适配器实现了 V3 API 的四种支付方式：

```typescript
// server/lib/payment/adapters/wechat-pay.ts

export class WechatPayAdapter extends BasePaymentAdapter<WechatPayConfig> {
    protected validateConfig(): void {
        const { appId, mchId, apiV3Key, serialNo, privateKey } = this.config
        if (!appId || !mchId || !apiV3Key || !serialNo || !privateKey) {
            throw new PaymentConfigError('微信支付配置不完整')
        }
    }

    getSupportedMethods(): PaymentMethod[] {
        return [PaymentMethod.MINI_PROGRAM, PaymentMethod.SCAN_CODE,
                PaymentMethod.WAP, PaymentMethod.APP]
    }

    async createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
        switch (params.method) {
            case PaymentMethod.MINI_PROGRAM: return this.createJsapiPayment(params)
            case PaymentMethod.SCAN_CODE:    return this.createNativePayment(params)
            case PaymentMethod.WAP:          return this.createH5Payment(params)
            case PaymentMethod.APP:          return this.createAppPayment(params)
        }
    }

    // 回调验证：签名校验 → AES-256-GCM 解密 → 提取订单信息
    async verifyCallback(data: CallbackData): Promise<CallbackVerifyResult> { /* ... */ }
}
```

### 工厂函数

```typescript
// server/lib/payment/factory.ts

const adapterCache = new Map<PaymentChannel, IPaymentAdapter>()

export const getPaymentAdapter = (channel: PaymentChannel): IPaymentAdapter => {
    if (adapterCache.has(channel)) return adapterCache.get(channel)!

    let adapter: IPaymentAdapter
    switch (channel) {
        case PaymentChannel.WECHAT:
            adapter = new WechatPayAdapter(getWechatPayConfig())
            break
        case PaymentChannel.ALIPAY:
            throw new PaymentConfigError('支付宝支付暂未实现')
        default:
            throw new PaymentConfigError(`不支持的支付渠道: ${channel}`)
    }

    adapterCache.set(channel, adapter)
    return adapter
}
```

### 错误类层级

```typescript
PaymentError (base)
├── PaymentConfigError           // 配置不完整
├── PaymentSignatureError        // 签名校验失败
├── PaymentRequestError          // API 请求失败（含 statusCode、response）
├── PaymentCallbackError         // 回调验证失败
├── PaymentOrderNotFoundError    // 订单不存在
└── PaymentMethodNotSupportedError  // 不支持的支付方式
```

## 二、Storage 存储模块

### 接口定义

```typescript
// server/lib/storage/types.ts

export interface StorageAdapter {
    readonly type: StorageProviderType

    upload(path: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult>
    download(path: string, options?: DownloadOptions): Promise<Buffer>
    downloadStream(path: string, options?: DownloadOptions): Promise<Readable>
    delete(paths: string | string[]): Promise<DeleteResult>
    generateSignedUrl(path: string, options?: SignedUrlOptions): Promise<string>
    generatePostSignature(options: PostSignatureOptions): Promise<PostSignatureResult>
    /**
     * 查询对象元数据（2026-05-08 OSS 上传回调失败兜底链路引入）
     * 对象存在 → HeadObjectResult；NoSuchKey/404 → null；网络/凭证错误 → throw
     * 详见 infra/storage-oss.md §5.4
     */
    head(path: string): Promise<HeadObjectResult | null>
    testConnection(): Promise<boolean>
}
```

> `BaseStorageAdapter.head` 提供 throw NotImplemented 默认实现，目前仅 `AliyunOssAdapter` 实现；七牛 / 腾讯 COS 接入兜底链路时只需重写本方法，无需改 service / handler。

### 三种适配器

| 适配器 | 类 | 服务商 |
|---|---|---|
| `AliyunOssAdapter` | 阿里云 OSS | 复用 `server/lib/oss` 模块 |
| `QiniuAdapter` | 七牛云 | 独立实现 |
| `TencentCosAdapter` | 腾讯云 COS | 独立实现 |

### 抽象基类

Storage 的基类提供了丰富的错误转换辅助方法：

```typescript
// server/lib/storage/base.ts

export abstract class BaseStorageAdapter implements StorageAdapter {
    protected readonly config: StorageConfig

    constructor(config: StorageConfig) {
        this.config = config
        this.validateConfig()
    }

    // 错误转换辅助方法
    protected wrapUploadError(error: unknown): StorageUploadError { /* ... */ }
    protected wrapDownloadError(error: unknown): StorageDownloadError { /* ... */ }
    protected wrapDeleteError(error: unknown): StorageDeleteError { /* ... */ }
    protected wrapSignatureError(error: unknown): StorageSignatureError { /* ... */ }

    // 错误类型检测（子类可重写以适配特定服务商的错误格式）
    protected isNotFoundError(error: unknown): boolean { /* ... */ }
    protected isPermissionError(error: unknown): boolean { /* ... */ }
    protected isConfigError(error: unknown): boolean { /* ... */ }
    protected isNetworkError(error: unknown): boolean { /* ... */ }

    // 通用错误转换
    protected convertError(error: unknown, defaultMessage: string): StorageError { /* ... */ }

    // 文件名生成工具
    protected generateFileName(original: string, strategy: 'uuid' | 'timestamp' | 'original' | 'custom'): string
    protected abstract getHost(): string
}
```

### 工厂类

Storage 工厂使用静态类模式，支持自定义适配器注册：

```typescript
// server/lib/storage/factory.ts

export class StorageFactory {
    private static adapters: Map<string, StorageAdapter> = new Map()
    private static customAdapters: Map<StorageProviderType, AdapterConstructor> = new Map()

    static getAdapter(config: StorageConfig): StorageAdapter {
        const key = this.generateConfigKey(config)
        const cached = this.adapters.get(key)
        if (cached) return cached

        const adapter = this.createAdapter(config)
        this.adapters.set(key, adapter)
        return adapter
    }

    private static createAdapter(config: StorageConfig): StorageAdapter {
        // 优先检查自定义适配器注册表
        const customConstructor = this.customAdapters.get(config.type)
        if (customConstructor) return new customConstructor(config)

        // 内置适配器（使用类型守卫分发）
        if (isAliyunOssConfig(config)) return new AliyunOssAdapter(config)
        if (isQiniuConfig(config))     return new QiniuAdapter(config)
        if (isTencentCosConfig(config)) return new TencentCosAdapter(config)
        throw new StorageConfigError(`不支持的存储类型: ${config.type}`)
    }

    // 扩展点：注册自定义适配器
    static registerAdapter(type: StorageProviderType, constructor: AdapterConstructor): void {
        this.customAdapters.set(type, constructor)
    }
}
```

### 配置联合类型与类型守卫

```typescript
// server/lib/storage/types.ts

export type StorageConfig = AliyunOssConfig | QiniuConfig | TencentCosConfig

export function isAliyunOssConfig(config: StorageConfig): config is AliyunOssConfig {
    return config.type === StorageProviderType.ALIYUN_OSS
}

export function isQiniuConfig(config: StorageConfig): config is QiniuConfig {
    return config.type === StorageProviderType.QINIU
}

export function isTencentCosConfig(config: StorageConfig): config is TencentCosConfig {
    return config.type === StorageProviderType.TENCENT_COS
}
```

### 签名结果差异化

不同服务商的客户端直传签名结果结构不同，使用联合类型和类型守卫区分：

```typescript
export type PostSignatureResult =
    | AliyunPostSignatureResult   // policy + signature + credential
    | QiniuPostSignatureResult    // uploadToken
    | TencentPostSignatureResult  // tmpSecretId + sessionToken
```

### 回调处理器

Storage 模块包含独立的回调处理子模块：

```typescript
// server/lib/storage/callback/handler.ts

const handlers: Map<StorageProviderType, CallbackHandler> = new Map()
handlers.set(StorageProviderType.ALIYUN_OSS, new AliyunCallbackValidator())

export async function verifyCallback(event: H3Event, config: StorageConfig): Promise<CallbackVerifyResult> {
    const handler = getHandler(config.type)
    return handler.verify(event, config)
}

export async function parseCallback(event: H3Event, type: StorageProviderType): Promise<CallbackData> {
    const handler = getHandler(type)
    return handler.parse(event)
}

// 扩展点：注册自定义回调处理器
export function registerCallbackHandler(type: StorageProviderType, handler: CallbackHandler): void {
    handlers.set(type, handler)
}
```

### 错误类层级

```typescript
StorageError (base, code: StorageErrorCode)
├── StorageConfigError           // 配置缺失或无效
├── StorageNotFoundError         // 文件不存在（含 path 属性）
├── StoragePermissionError       // 权限不足
├── StorageNetworkError          // 网络超时/连接失败
├── StorageUploadError           // 上传失败
├── StorageDownloadError         // 下载失败
├── StorageDeleteError           // 删除失败
├── StorageSignatureError        // 签名生成失败
└── StorageStsError              // STS 临时凭证获取失败
```

附带服务商错误码映射工具：

```typescript
export function convertAliyunError(error: any, defaultErrorClass): StorageError
export function convertQiniuError(error: any, defaultErrorClass): StorageError
export function convertTencentError(error: any, defaultErrorClass): StorageError
```

## 三、OSS 底层模块

`server/lib/oss/` 是阿里云 OSS 的底层实现，被 `AliyunOssAdapter` 复用：

```
server/lib/oss/
├── client.ts          # OSS 客户端创建（支持 AK/SK 和 STS 两种模式）
├── upload.ts          # 文件上传
├── download.ts        # 文件下载（Buffer / Stream）
├── delete.ts          # 文件删除（单/批量）
├── headFile.ts        # 对象元数据查询（head 兜底链路底层实现）
├── signedUrl.ts       # 签名 URL 生成
├── postSignature.ts   # 客户端直传签名（OSS4-HMAC-SHA256 V4 签名）
├── validator.ts       # 配置验证
├── utils.ts           # 工具函数（Base64、Region 标准化等）
├── errors.ts          # OSS 专用错误类
└── index.ts           # 统一导出
```

### 客户端创建

```typescript
// server/lib/oss/client.ts

export async function createOssClient(config: OssConfig, useCname = false): Promise<OssClientInstance> {
    validateConfig(config)

    if (config.sts) {
        // STS 模式：获取临时凭证
        const credentials = await getStsCredentials(config)
        return { client: new OSS({ stsToken: credentials.securityToken, ... }), credentials }
    }

    // AK/SK 直接模式
    return { client: new OSS({ accessKeyId, accessKeySecret, ... }) }
}
```

### 客户端直传签名

签名流程（OSS V4 签名算法）：

```
1. 创建 OSS 客户端（获取 STS 临时凭证如有配置）
2. 构建 Policy 条件：bucket、credential、signature-version、日期、文件大小/类型限制
3. 处理回调配置：自动添加 x: 前缀、构建 callbackBody 模板、Base64 编码
4. 使用 client.signPostObjectPolicyV4(policy, date) 生成签名
5. 返回前端所需的全部字段（host、policy、signature、callback、securityToken 等）
```

## 如何扩展新提供商

### 扩展 Payment（以支付宝为例）

1. 在 `server/lib/payment/adapters/alipay.ts` 创建适配器：

```typescript
export class AlipayAdapter extends BasePaymentAdapter<AlipayConfig> {
    protected validateConfig(): void { /* 验证 appId、privateKey、alipayPublicKey */ }
    getChannel(): PaymentChannel { return PaymentChannel.ALIPAY }
    getSupportedMethods(): PaymentMethod[] { return [PaymentMethod.SCAN_CODE, PaymentMethod.WAP] }
    async createPayment(params: CreatePaymentParams): Promise<PaymentResult> { /* ... */ }
    async verifyCallback(data: CallbackData): Promise<CallbackVerifyResult> { /* ... */ }
    async queryOrder(params: QueryOrderParams): Promise<QueryOrderResult> { /* ... */ }
    async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> { /* ... */ }
}
```

2. 在 `factory.ts` 的 switch 中添加 case
3. 在 `index.ts` 中导出

### 扩展 Storage（以 AWS S3 为例）

1. 在 `StorageProviderType` 枚举中添加 `AWS_S3 = 'aws_s3'`
2. 定义 `AwsS3Config extends BaseStorageConfig`
3. 创建 `server/lib/storage/adapters/aws-s3.ts`
4. 使用两种方式之一注册：
   - **内置**：在 `StorageFactory.createAdapter()` 添加类型守卫分支
   - **动态**：调用 `StorageFactory.registerAdapter(StorageProviderType.AWS_S3, AwsS3Adapter)`

## 对比三套实现

| 维度 | Payment | Storage | OSS |
|---|---|---|---|
| 抽象方式 | `interface` + `abstract class` | `interface` + `abstract class` | 纯函数导出 |
| 工厂模式 | 函数 + Map 缓存 | 静态类 + Map 缓存 | 无工厂（单供应商） |
| 缓存策略 | channel 维度 | `type:id` 或 `type:bucket:region` | 无缓存 |
| 扩展机制 | switch 分支 | 类型守卫 + 自定义注册表 | 不适用 |
| 错误处理 | 专用 Error 子类 | 专用 Error 子类 + 错误码映射 | 专用 Error 子类 |
| 回调处理 | 适配器内置 | 独立子模块 + 注册表 | 不适用 |

## 相关文档

- [tech-docs/patterns/service-dao.md](./service-dao.md) - Service + DAO 分层模式（调用 lib 层的上层架构）
- [tech-docs/patterns/sse-event-bridge.md](./sse-event-bridge.md) - SSE 事件管道（与支付回调通知的异曲同工）
