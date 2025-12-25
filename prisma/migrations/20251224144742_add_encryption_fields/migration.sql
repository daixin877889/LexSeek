-- AlterTable
ALTER TABLE "oss_files" ADD COLUMN     "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_mime_type" VARCHAR(100);

-- CreateTable
CREATE TABLE "user_encryptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "encrypted_identity" TEXT NOT NULL,
    "encrypted_recovery_key" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_encryptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_encryptions_user_id_key" ON "user_encryptions"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_encryptions_user_id" ON "user_encryptions"("user_id");

-- CreateIndex
CREATE INDEX "idx_oss_files_encrypted" ON "oss_files"("encrypted");
