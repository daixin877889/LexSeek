/**
 * 材料模块测试数据生成器
 *
 * 复用案件模块的生成器，并添加材料模块特有的生成器
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 3.1, 4.1**
 */

// 从案件模块导出所有生成器
export {
    PBT_CONFIG,
    PBT_CONFIG_FAST,
    chineseNameArb,
    descriptionArb,
    positiveIntArb,
    statusArb,
    validDateArb,
    caseTypeStatusArb,
    caseTypeDataArbitrary,
    caseStatusArb,
    partyInfoArb,
    partyListArb,
    caseDataArbitrary,
    caseUpdateDataArb,
    sessionStatusArb,
    sessionDataArbitrary,
    materialTypeArb,
    materialStatusArb,
    materialDataArbitrary,
    materialUpdateDataArb,
    analysisStatusArb,
    analysisDataArbitrary,
    sseMessageTypeArb,
    sseMessageArbitrary,
    paginationArb,
    orderDirArb,
    caseListParamsArb,
    materialListParamsArb,
    generateTestId,
    filterUndefined,
} from '../case/test-generators'
