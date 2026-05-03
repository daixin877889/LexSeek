import { describe, it, expect } from 'vitest'
import { buildNumberingPrefixMap } from '~~/server/agents/contract/docx/numbering'

describe('numbering · buildNumberingPrefixMap', () => {
    it('numbering.xml 缺失返回空 Map', () => {
        const docXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>'
        const result = buildNumberingPrefixMap(docXml, null)
        expect(result.size).toBe(0)
    })
})
