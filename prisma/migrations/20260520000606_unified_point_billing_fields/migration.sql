-- AlterTable
ALTER TABLE "point_consumption_items" ADD COLUMN     "billing_mode" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "display_name" VARCHAR(100);

-- AlterTable
ALTER TABLE "point_consumption_records" ADD COLUMN     "context_label" VARCHAR(255),
ADD COLUMN     "operation_id" VARCHAR(64),
ADD COLUMN     "usage_amount" INTEGER;

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_operation_id" ON "point_consumption_records"("operation_id");
