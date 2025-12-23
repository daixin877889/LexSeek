-- CreateTable
CREATE TABLE "oss_files" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "bucket_name" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500),
    "file_size" DECIMAL(15,2) NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "file_md5" VARCHAR(32),
    "source" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "oss_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_oss_files_user_id" ON "oss_files"("user_id");

-- CreateIndex
CREATE INDEX "idx_oss_files_bucket_name" ON "oss_files"("bucket_name");

-- CreateIndex
CREATE INDEX "idx_oss_files_file_name" ON "oss_files"("file_name");

-- CreateIndex
CREATE INDEX "idx_oss_files_file_type" ON "oss_files"("file_type");

-- CreateIndex
CREATE INDEX "idx_oss_files_status" ON "oss_files"("status");

-- CreateIndex
CREATE INDEX "idx_oss_files_deleted_at" ON "oss_files"("deleted_at");
