-- AlterTable
ALTER TABLE "contract_playbooks" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "models" ADD COLUMN     "max_output_tokens" INTEGER;
