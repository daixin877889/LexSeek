// @ts-ignore
import Dysmsapi, * as $Dysmsapi from '@alicloud/dysmsapi20170525'
// @ts-ignore
import * as $OpenApi from '@alicloud/openapi-client'

let client: any = null

function getClient() {
    if (!client) {
        const config = useRuntimeConfig()
        const openApiConfig = new $OpenApi.Config({
            accessKeyId: config.aliyun.accessKeyId,
            accessKeySecret: config.aliyun.accessKeySecret,
        })
        openApiConfig.endpoint = 'dysmsapi.aliyuncs.com'
        // 处理 ESM default export
        const Client = Dysmsapi.default || Dysmsapi
        client = new Client(openApiConfig)
    }
    return client
}

export const sendSms = async (phone: string, code: string) => {
    try {
        const config = useRuntimeConfig()
        const smsClient = getClient()

        const SendSmsRequest = $Dysmsapi.SendSmsRequest
        const request = new SendSmsRequest({
            phoneNumbers: phone,
            signName: config.aliyun.sms.signName || '阿里云短信测试',
            templateCode: config.aliyun.sms.templateCode,
            templateParam: JSON.stringify({ code }),
        })

        const result = await smsClient.sendSms(request)
        return result.body
    } catch (error) {
        console.error('Ali SMS send error:', error)
        throw error
    }
}
