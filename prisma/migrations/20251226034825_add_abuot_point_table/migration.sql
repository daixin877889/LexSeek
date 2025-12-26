-- CreateTable
CREATE TABLE "point_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "used" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "source_type" INTEGER NOT NULL,
    "source_id" INTEGER,
    "user_membership_id" INTEGER,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "expired_at" TIMESTAMPTZ(6) NOT NULL,
    "settlement_at" TIMESTAMPTZ(6),
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "point_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_consumption_items" (
    "id" SERIAL NOT NULL,
    "group" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "unit" VARCHAR(10) NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "discount" DECIMAL(3,2) DEFAULT 1,

    CONSTRAINT "point_consumption_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_consumption_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "point_record_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "source_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "point_consumption_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_point_records_user_id" ON "point_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_point_records_source_type" ON "point_records"("source_type");

-- CreateIndex
CREATE INDEX "idx_point_records_source_id" ON "point_records"("source_id");

-- CreateIndex
CREATE INDEX "idx_point_records_effective_at" ON "point_records"("effective_at");

-- CreateIndex
CREATE INDEX "idx_point_records_expired_at" ON "point_records"("expired_at");

-- CreateIndex
CREATE INDEX "idx_point_records_settlement_at" ON "point_records"("settlement_at");

-- CreateIndex
CREATE INDEX "idx_point_records_deleted_at" ON "point_records"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_name" ON "point_consumption_items"("name");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_status" ON "point_consumption_items"("status");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_deleted_at" ON "point_consumption_items"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_user_id" ON "point_consumption_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_item_id" ON "point_consumption_records"("item_id");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_status" ON "point_consumption_records"("status");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_deleted_at" ON "point_consumption_records"("deleted_at");

-- AddForeignKey
ALTER TABLE "point_records" ADD CONSTRAINT "point_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_consumption_records" ADD CONSTRAINT "point_consumption_records_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "point_consumption_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_consumption_records" ADD CONSTRAINT "point_consumption_records_point_record_id_fkey" FOREIGN KEY ("point_record_id") REFERENCES "point_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_consumption_records" ADD CONSTRAINT "point_consumption_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
