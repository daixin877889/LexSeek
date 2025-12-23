-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "system_configs" (
    "id" SERIAL NOT NULL,
    "config_group" VARCHAR(50) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(255),
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_system_configs_config_group" ON "system_configs"("config_group");

-- CreateIndex
CREATE INDEX "idx_system_configs_key" ON "system_configs"("key");

-- CreateIndex
CREATE INDEX "idx_system_configs_status" ON "system_configs"("status");

-- CreateIndex
CREATE INDEX "idx_system_configs_deleted_at" ON "system_configs"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_config_group_key_key" ON "system_configs"("config_group", "key");
