-- AlterTable
ALTER TABLE "contract_risks" ADD COLUMN     "client_redline_decision" VARCHAR(12);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "contract_export_signature" VARCHAR(50);
