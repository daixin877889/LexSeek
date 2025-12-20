-- DropEnum
DROP TYPE "SmsType";

-- CreateTable
CREATE TABLE "token_blacklist" (
    "id" UUID NOT NULL,
    "token" VARCHAR(100) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expired_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_token_blacklist_user_id" ON "token_blacklist"("user_id");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_expired_at" ON "token_blacklist"("expired_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_token" ON "token_blacklist"("token");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_created_at" ON "token_blacklist"("created_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_updated_at" ON "token_blacklist"("updated_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_deleted_at" ON "token_blacklist"("deleted_at");
