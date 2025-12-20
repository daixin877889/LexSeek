-- AlterTable
ALTER TABLE "token_blacklist" ALTER COLUMN "token" DROP NOT NULL,
ALTER COLUMN "token" SET DATA TYPE TEXT;
