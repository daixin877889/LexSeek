-- CreateTable
CREATE TABLE "contract_playbooks" (
    "id" SERIAL NOT NULL,
    "contract_type" VARCHAR(50) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(30) NOT NULL,
    "default_level" VARCHAR(10) NOT NULL,
    "stance_preference" VARCHAR(10) NOT NULL DEFAULT 'balanced',
    "check_content" TEXT NOT NULL,
    "legal_basis" TEXT,
    "suggestion" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contract_playbooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_contract_playbooks_lookup" ON "contract_playbooks"("contract_type", "enabled", "code");

-- CreateIndex
CREATE UNIQUE INDEX "idx_contract_playbooks_type_code" ON "contract_playbooks"("contract_type", "code");

-- AlterTable
ALTER TABLE "contract_reviews" ADD COLUMN "playbook_snapshot" JSONB;
