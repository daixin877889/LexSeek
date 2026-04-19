-- M6.3：合同审查关联案件
-- 为 contract_reviews 增加可空 case_id，支持"案件下合同审查"复用场景。
-- null = 独立审查（assistant 入口）；非 null = 案件下合同审查（案件详情 Tab 入口）。

-- AlterTable
ALTER TABLE "contract_reviews" ADD COLUMN "case_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_contract_reviews_case" ON "contract_reviews"("case_id");

-- AddForeignKey
ALTER TABLE "contract_reviews"
    ADD CONSTRAINT "contract_reviews_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
