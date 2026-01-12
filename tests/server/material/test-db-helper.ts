/**
 * 材料模块测试数据库辅助模块
 *
 * 复用案件模块的测试辅助函数，并添加材料模块特有的功能
 *
 * **Feature: server-test-coverage**
 * **Validates: Requirements 3.1, 4.1**
 */

// 从案件模块导出所有辅助函数
export {
    getTestPrisma,
    testPrisma,
    TEST_USER_PHONE_PREFIX,
    TEST_CASE_TITLE_PREFIX,
    TEST_CASE_TYPE_PREFIX,
    TEST_MATERIAL_PREFIX,
    createEmptyTestIds,
    resetTestIds,
    createTestUser,
    createTestCaseType,
    createTestCase,
    createTestSession,
    createTestMaterial,
    createTestOssFile,
    createTestNode,
    createTestAnalysis,
    createTestModelProvider,
    createTestModel,
    cleanupTestData,
    cleanupAllTestData,
    connectTestDb,
    disconnectTestDb,
    isTestDbAvailable,
    resetDatabaseSequences,
    type CaseTestIds,
    type TestUserInput,
    type TestCaseTypeInput,
    type TestCaseInput,
    type TestSessionInput,
    type TestMaterialInput,
    type TestOssFileInput,
    type TestNodeInput,
    type TestAnalysisInput,
    type TestModelProviderInput,
    type TestModelInput,
} from '../case/test-db-helper'
