/*
  Warnings:

  - A unique constraint covering the columns `[name,type,version]` on the table `prompts` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "uk_prompts_name_type_version" ON "prompts"("name", "type", "version");
