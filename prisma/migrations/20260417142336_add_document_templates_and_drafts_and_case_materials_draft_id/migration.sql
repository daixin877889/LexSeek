-- 新增文书模板表
CREATE TABLE "document_templates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "scope" VARCHAR(20) NOT NULL DEFAULT 'global',
    "user_id" INTEGER,
    "oss_file_id" INTEGER NOT NULL,
    "placeholders" JSONB NOT NULL DEFAULT '[]',
    "description" VARCHAR(500),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- 新增文书草稿表
CREATE TABLE "document_drafts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "session_id" VARCHAR(100) NOT NULL,
    "template_id" INTEGER NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "source_ref" JSONB,
    "metadata" JSONB,
    "output_file_id" INTEGER,
    "status" VARCHAR(30) NOT NULL DEFAULT 'drafting',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_drafts_pkey" PRIMARY KEY ("id")
);

-- document_templates 索引
CREATE INDEX "idx_doc_templates_scope_user" ON "document_templates"("scope", "user_id");
CREATE INDEX "idx_doc_templates_category" ON "document_templates"("category");
CREATE INDEX "idx_doc_templates_status" ON "document_templates"("status", "deleted_at");

-- document_drafts 索引
CREATE UNIQUE INDEX "idx_doc_drafts_session" ON "document_drafts"("session_id");
CREATE INDEX "idx_doc_drafts_user" ON "document_drafts"("user_id", "deleted_at");
CREATE INDEX "idx_doc_drafts_case" ON "document_drafts"("case_id");
CREATE INDEX "idx_doc_drafts_template" ON "document_drafts"("template_id");

-- caseMaterials: case_id 改为可空，新增 draft_id
ALTER TABLE "case_materials"
    ALTER COLUMN "case_id" DROP NOT NULL,
    ADD COLUMN "draft_id" INTEGER;

-- case_materials 新增 draft_id 索引
CREATE INDEX "idx_case_materials_draft" ON "case_materials"("draft_id");

-- 外键：document_templates -> users
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 外键：document_drafts -> users
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 外键：document_drafts -> cases
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 外键：document_drafts -> document_templates
ALTER TABLE "document_drafts" ADD CONSTRAINT "document_drafts_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 外键：case_materials -> document_drafts
ALTER TABLE "case_materials" ADD CONSTRAINT "case_materials_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "document_drafts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
