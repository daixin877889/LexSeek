declare module '@alicloud/sms-sdk' {
    interface SMSClientOptions {
        accessKeyId?: string
        secretAccessKey?: string
    }

    interface SendSmsOptions {
        phoneNumbers: string
        templateCode?: string
        templateParam?: string
    }

    interface SendSmsResult {
        Code: string
        Message: string
        RequestId: string
        BizId?: string
    }

    export default class SMSClient {
        constructor(options: SMSClientOptions)
        sendSms(options: SendSmsOptions): Promise<SendSmsResult>
    }
}

