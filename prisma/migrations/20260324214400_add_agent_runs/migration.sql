-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "worker_id" TEXT,
    "heartbeat_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_agent_runs_status_created_at" ON "agent_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_runs_session_id_created_at" ON "agent_runs"("session_id", "created_at");

-- CreateIndex
CREATE INDEX
"idx_agent_runs_user_id" ON "agent_runs"("user_id");

-- Partial unique index: 同一 session 同时只能有一个活跃 run
CREATE UNIQUE INDEX "agent_runs_session_active_uq"
ON "agent_runs" ("session_id")
WHERE "status" IN ('pending', 'running');
