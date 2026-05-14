-- CreateTable
CREATE TABLE "lpr_sync_logs" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "status" VARCHAR(16) NOT NULL,
    "triggered_by" VARCHAR(16) NOT NULL,
    "range_start" DATE NOT NULL,
    "range_end" DATE NOT NULL,
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "operator_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lpr_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lpr_sync_logs_started_at_idx" ON "lpr_sync_logs"("started_at" DESC);
