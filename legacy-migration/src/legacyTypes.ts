// legacy-client 的 prisma-client 生成器把每个模型导出为 `<model>Model` 类型。
import type * as Legacy from '../legacy-client/models'

export type LUser = Legacy.usersModel
export type LCase = Legacy.casesModel
export type LCaseSession = Legacy.caseSessionsModel
export type LCaseMaterial = Legacy.caseMaterialsModel
export type LCaseAnalysis = Legacy.caseAnalysesModel
export type LUserMembership = Legacy.userMembershipsModel
export type LMembershipUpgradeRecord = Legacy.membershipUpgradeRecordsModel
export type LPointRecord = Legacy.pointRecordsModel
export type LPointConsumptionRecord = Legacy.pointConsumptionRecordsModel
export type LUserBenefit = Legacy.userBenefitsModel
export type LRedemptionCode = Legacy.redemptionCodesModel
export type LRedemptionRecord = Legacy.redemptionRecordsModel
export type LOssFile = Legacy.ossFilesModel
export type LAsrTask = Legacy.asrTasksModel
export type LAsrRecord = Legacy.asrRecordsModel
export type LDocRecognition = Legacy.docRecognitionRecordsModel
export type LImageRecognition = Legacy.imageRecognitionRecordsModel
export type LSystemConfig = Legacy.systemConfigsModel
export type LPaymentOrder = Legacy.paymentOrdersModel
export type LPaymentTransaction = Legacy.paymentTransactionsModel
