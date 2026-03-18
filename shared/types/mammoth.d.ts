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
        /** Converted markdown content */
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

    export default {
        convertToMarkdown,
    }
}
