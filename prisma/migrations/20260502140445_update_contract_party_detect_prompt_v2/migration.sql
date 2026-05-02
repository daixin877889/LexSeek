-- AlterPrompt: contractPartyDetect_system 加正则提示段
UPDATE "prompts"
SET "content" = "content" || E'\n\n## 正则提示（可能存在）\n\n如果用户提示文本里出现"正则提示"段（甲方候选 / 乙方候选），表示服务端正则已识别到甲乙方，**优先采用正则识别的结果**填到 partyA / partyB 字段，除非正则结果明显是签章占位符（如"签字" / "盖章"）或者非合同主体名。contractType 必须由你独立从合同正文判断，不要因为正则提示就跳过类型识别。',
    "updated_at" = NOW()
WHERE "name" = 'contractPartyDetect_system';
