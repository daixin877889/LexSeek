/*
  Warnings:

  - You are about to drop the column `anchor_char_end` on the `contract_risks` table. All the data in the column will be lost.
  - You are about to drop the column `anchor_char_start` on the `contract_risks` table. All the data in the column will be lost.
  - You are about to drop the column `anchor_paragraph_index` on the `contract_risks` table. All the data in the column will be lost.
  - You are about to drop the column `anchor_quote` on the `contract_risks` table. All the data in the column will be lost.
  - You are about to drop the column `original_anchor_quote` on the `contract_risks` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "contract_risks" DROP COLUMN "anchor_char_end",
DROP COLUMN "anchor_char_start",
DROP COLUMN "anchor_paragraph_index",
DROP COLUMN "anchor_quote",
DROP COLUMN "original_anchor_quote",
ADD COLUMN     "clause_char_end" INTEGER,
ADD COLUMN     "clause_char_start" INTEGER,
ADD COLUMN     "clause_index" INTEGER,
ADD COLUMN     "clause_paragraph_index" INTEGER,
ADD COLUMN     "clause_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "original_clause_text" TEXT,
ADD COLUMN     "problematic_quote" TEXT,
ADD COLUMN     "quote_char_end" INTEGER,
ADD COLUMN     "quote_char_start" INTEGER,
ADD COLUMN     "quote_match_source" VARCHAR(20);
