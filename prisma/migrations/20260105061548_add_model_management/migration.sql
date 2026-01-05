-- CreateTable
CREATE TABLE "model_providers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "base_url" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_api_keys" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "daily_limit" INTEGER,
    "monthly_limit" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "model_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "model_type" VARCHAR(20) NOT NULL,
    "model_version" VARCHAR(50),
    "context_window" INTEGER,
    "dimensions" INTEGER,
    "batch_size" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "input_cost_per_million_tokens" DECIMAL(12,4),
    "output_cost_per_million_tokens" DECIMAL(12,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_providers_name_key" ON "model_providers"("name");

-- CreateIndex
CREATE INDEX "idx_model_providers_deleted_at" ON "model_providers"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_model_providers_name" ON "model_providers"("name");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_provider_id" ON "model_api_keys"("provider_id");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_is_default" ON "model_api_keys"("is_default");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_status" ON "model_api_keys"("status");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_deleted_at" ON "model_api_keys"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_api_keys_provider_id_name_key" ON "model_api_keys"("provider_id", "name");

-- CreateIndex
CREATE INDEX "idx_models_provider_id" ON "models"("provider_id");

-- CreateIndex
CREATE INDEX "idx_models_model_type" ON "models"("model_type");

-- CreateIndex
CREATE INDEX "idx_models_is_default" ON "models"("is_default");

-- CreateIndex
CREATE INDEX "idx_models_status" ON "models"("status");

-- CreateIndex
CREATE INDEX "idx_models_priority" ON "models"("priority");

-- CreateIndex
CREATE INDEX "idx_models_deleted_at" ON "models"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "models_provider_id_name_key" ON "models"("provider_id", "name");

-- AddForeignKey
ALTER TABLE "model_api_keys" ADD CONSTRAINT "model_api_keys_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
