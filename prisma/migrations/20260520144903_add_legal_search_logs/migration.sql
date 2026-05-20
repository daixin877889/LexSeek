-- CreateTable
CREATE TABLE "legal_search_logs" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "userId" TEXT,
    "resultCount" INTEGER,
    "resultIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_search_logs_scope_createdAt_idx" ON "legal_search_logs"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "legal_search_logs_keyword_scope_idx" ON "legal_search_logs"("keyword", "scope");

-- CreateIndex
CREATE INDEX "legal_search_logs_userId_createdAt_idx" ON "legal_search_logs"("userId", "createdAt");
