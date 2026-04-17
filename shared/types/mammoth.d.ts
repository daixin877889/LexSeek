declare module 'mammoth' {
    interface ConvertOptions {
        /** File buffer */
        buffer?: ArrayBuffer | Buffer
        /** Array buffer */
        arrayBuffer?: ArrayBuffer
        /** File URL */
        fileUrl?: string
    }

    interface ConvertResult {
        /** Converted markdown/raw text content */
        value: string
        /** Messages/warnings from conversion */
        messages: Array<{
            type: string
            message: string
        }>
    }

    /**
     * Convert a DOCX file to markdown
     */
    function convertToMarkdown(options: ConvertOptions): Promise<ConvertResult>

    /**
     * Extract plain text from a DOCX file (no formatting)
     */
    function extractRawText(options: ConvertOptions): Promise<ConvertResult>

    export default {
        convertToMarkdown,
        extractRawText,
    }
}
