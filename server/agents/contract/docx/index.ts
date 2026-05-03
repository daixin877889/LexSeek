export { parseContractDocx } from './parser'
export type { ParsedContract } from './parser'
export { detectParties } from './partyDetector'
export type { PartyDetectionResult } from './partyDetector'
export { injectComments, injectAnnotations } from './commentInjector'
export type {
    InjectCommentsResult,
    ContractAnnotationForExport,
    InjectAnnotationsResult,
    InjectAnnotationsOptions,
} from './commentInjector'
export {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from './zipRewriter'
export { escapeXml, findMaxSharedId, collectNonEmptyParagraphs } from './xmlAst'
export { injectRedlineMarks } from './redlineInjector'
export type { RedlineRisk, InjectRedlineResult, RedlineWrapTarget } from './redlineInjector'
