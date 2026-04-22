-- AlterTable: 合同审查主表新增版本字段
ALTER TABLE "contract_reviews" ADD COLUMN     "current_version_id" INTEGER,
ADD COLUMN     "max_version_no" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: 合同审查历史版本快照
CREATE TABLE "contract_review_versions" (
    "id" SERIAL NOT NULL,
    "review_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "system_label" VARCHAR(20) NOT NULL,
    "lawyer_note" TEXT,
    "snapshot_data" JSONB NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_review_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 合同审查风险（工作区实时态）
CREATE TABLE "contract_risks" (
    "id" SERIAL NOT NULL,
    "review_id" INTEGER NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "code" VARCHAR(30),
    "category" VARCHAR(50) NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "stance" VARCHAR(10) NOT NULL DEFAULT 'balanced',
    "problem" TEXT NOT NULL,
    "legal_basis" TEXT,
    "analysis" TEXT,
    "suggestion" TEXT,
    "archived_status" VARCHAR(20),
    "archived_at" TIMESTAMP(3),
    "anchor_quote" TEXT NOT NULL,
    "anchor_paragraph_index" INTEGER,
    "anchor_char_start" INTEGER,
    "anchor_char_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 合同审查批注（软删，永不物理删除）
CREATE TABLE "contract_annotations" (
    "id" SERIAL NOT NULL,
    "review_id" INTEGER NOT NULL,
    "risk_id" INTEGER NOT NULL,
    "parent_annotation_id" INTEGER,
    "author_type" VARCHAR(10) NOT NULL,
    "author_name" VARCHAR(100) NOT NULL,
    "author_user_id" INTEGER,
    "content" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_review_versions_review_id_created_at_idx" ON "contract_review_versions"("review_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uk_contract_review_version_number" ON "contract_review_versions"("review_id", "version_number");

-- CreateIndex
CREATE INDEX "contract_risks_review_id_source_idx" ON "contract_risks"("review_id", "source");

-- CreateIndex
CREATE INDEX "contract_risks_review_id_archived_status_idx" ON "contract_risks"("review_id", "archived_status");

-- CreateIndex
CREATE INDEX "contract_annotations_risk_id_created_at_idx" ON "contract_annotations"("risk_id", "created_at");

-- CreateIndex
CREATE INDEX "contract_reviews_current_version_id_idx" ON "contract_reviews"("current_version_id");

-- AddForeignKey
ALTER TABLE "contract_review_versions" ADD CONSTRAINT "contract_review_versions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "contract_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_review_versions" ADD CONSTRAINT "contract_review_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_risks" ADD CONSTRAINT "contract_risks_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "contract_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_annotations" ADD CONSTRAINT "contract_annotations_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "contract_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_annotations" ADD CONSTRAINT "contract_annotations_risk_id_fkey" FOREIGN KEY ("risk_id") REFERENCES "contract_risks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_annotations" ADD CONSTRAINT "contract_annotations_parent_annotation_id_fkey" FOREIGN KEY ("parent_annotation_id") REFERENCES "contract_annotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_annotations" ADD CONSTRAINT "contract_annotations_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
