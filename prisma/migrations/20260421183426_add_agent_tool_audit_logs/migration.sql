-- CreateTable
CREATE TABLE "agent_tool_audit_logs" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "session_id" VARCHAR(128) NOT NULL,
    "case_id" INTEGER,
    "run_id" VARCHAR(64),
    "tool_name" VARCHAR(64) NOT NULL,
    "verdict" VARCHAR(16) NOT NULL,
    "deny_reason" VARCHAR(256),
    "args_digest" JSONB NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_agent_tool_audit_logs_user_id_created_at" ON "agent_tool_audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_tool_audit_logs_verdict_created_at" ON "agent_tool_audit_logs"("verdict", "created_at");

-- CreateIndex
CREATE INDEX "idx_agent_tool_audit_logs_created_at" ON "agent_tool_audit_logs"("created_at");
