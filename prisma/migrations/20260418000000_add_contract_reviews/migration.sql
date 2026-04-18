-- CreateTable
CREATE TABLE "contract_reviews" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "original_file_id" INTEGER NOT NULL,
    "reviewed_file_id" INTEGER,
    "contract_type" VARCHAR(50),
    "party_a" VARCHAR(200),
    "party_b" VARCHAR(200),
    "stance" VARCHAR(20),
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "risks" JSONB,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contract_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_contract_reviews_session" ON "contract_reviews"("session_id");

-- CreateIndex
CREATE INDEX "idx_contract_reviews_user" ON "contract_reviews"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_contract_reviews_status" ON "contract_reviews"("status");

-- AddForeignKey
ALTER TABLE "contract_reviews" ADD CONSTRAINT "contract_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
