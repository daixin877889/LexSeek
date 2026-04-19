-- 给 document_drafts 加 title / title_overridden
ALTER TABLE "public"."document_drafts"
    ADD COLUMN "title" VARCHAR(200) NOT NULL DEFAULT '',
    ADD COLUMN "title_overridden" BOOLEAN NOT NULL DEFAULT false;

-- 回填老记录的 title：模板名 + YYMMDD（用数据库时区 Asia/Shanghai 保证本地日期）
UPDATE "public"."document_drafts" d
   SET "title" = COALESCE(t."name", '文书')
                 || '-' || to_char(d."created_at" AT TIME ZONE 'Asia/Shanghai', 'YYMMDD')
  FROM "public"."document_templates" t
 WHERE d."template_id" = t."id" AND d."title" = '';

-- 文书快照表
CREATE TABLE "document_draft_snapshots" (
    "id" SERIAL NOT NULL,
    "draft_id" INTEGER NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "ai_title" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_draft_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_doc_snapshots_draft_time" ON "document_draft_snapshots"("draft_id", "created_at" DESC);
ALTER TABLE "document_draft_snapshots"
    ADD CONSTRAINT "document_draft_snapshots_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "document_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 文书版本表
CREATE TABLE "document_draft_versions" (
    "id" SERIAL NOT NULL,
    "draft_id" INTEGER NOT NULL,
    "version_no" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "title_at" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_draft_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idx_doc_versions_draft_no" ON "document_draft_versions"("draft_id", "version_no");
CREATE INDEX "idx_doc_versions_draft_time" ON "document_draft_versions"("draft_id", "created_at" DESC);
ALTER TABLE "document_draft_versions"
    ADD CONSTRAINT "document_draft_versions_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "document_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
