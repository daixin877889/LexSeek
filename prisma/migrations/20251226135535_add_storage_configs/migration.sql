-- CreateTable
CREATE TABLE "storage_configs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "storage_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_storage_configs_user_id" ON "storage_configs"("user_id");

-- CreateIndex
CREATE INDEX "idx_storage_configs_type" ON "storage_configs"("type");

-- CreateIndex
CREATE INDEX "idx_storage_configs_is_default" ON "storage_configs"("is_default");

-- CreateIndex
CREATE INDEX "idx_storage_configs_enabled" ON "storage_configs"("enabled");

-- CreateIndex
CREATE INDEX "idx_storage_configs_deleted_at" ON "storage_configs"("deleted_at");
