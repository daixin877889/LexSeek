-- 给 document_drafts 加版本计数器
ALTER TABLE "public"."document_drafts"
    ADD COLUMN "max_version_no" INTEGER NOT NULL DEFAULT 0;

-- 回填：已有记录的计数器对齐到当前 MAX(version_no)（没版本的为 0）
UPDATE "public"."document_drafts" d
   SET "max_version_no" = COALESCE((
        SELECT MAX("version_no") FROM "public"."document_draft_versions"
         WHERE "draft_id" = d."id"
   ), 0);
