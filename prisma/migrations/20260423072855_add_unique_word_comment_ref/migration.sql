/*
  Warnings:

  - A unique constraint covering the columns `[word_comment_ref]` on the table `contract_annotations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "contract_annotations_word_comment_ref_key" ON "contract_annotations"("word_comment_ref");
