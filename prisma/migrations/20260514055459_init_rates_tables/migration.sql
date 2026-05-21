-- CreateTable
CREATE TABLE "lpr_rates" (
    "id" SERIAL NOT NULL,
    "effect_date" DATE NOT NULL,
    "one_year" DECIMAL(6,4) NOT NULL,
    "five_year" DECIMAL(6,4) NOT NULL,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lpr_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pboc_deposit_rates" (
    "id" SERIAL NOT NULL,
    "effect_date" DATE NOT NULL,
    "demand" DECIMAL(6,4) NOT NULL,
    "three_months" DECIMAL(6,4) NOT NULL,
    "six_months" DECIMAL(6,4) NOT NULL,
    "one_year" DECIMAL(6,4) NOT NULL,
    "two_year" DECIMAL(6,4) NOT NULL,
    "three_year" DECIMAL(6,4) NOT NULL,
    "five_year" DECIMAL(6,4) NOT NULL,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pboc_deposit_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pboc_loan_rates" (
    "id" SERIAL NOT NULL,
    "effect_date" DATE NOT NULL,
    "six_months" DECIMAL(6,4) NOT NULL,
    "one_year" DECIMAL(6,4) NOT NULL,
    "one_to_five" DECIMAL(6,4) NOT NULL,
    "five_year_plus" DECIMAL(6,4) NOT NULL,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pboc_loan_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lpr_rates_effect_date_key" ON "lpr_rates"("effect_date");

-- CreateIndex
CREATE INDEX "lpr_rates_effect_date_idx" ON "lpr_rates"("effect_date" DESC);

-- CreateIndex
CREATE INDEX "lpr_rates_deleted_at_idx" ON "lpr_rates"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pboc_deposit_rates_effect_date_key" ON "pboc_deposit_rates"("effect_date");

-- CreateIndex
CREATE INDEX "pboc_deposit_rates_effect_date_idx" ON "pboc_deposit_rates"("effect_date" DESC);

-- CreateIndex
CREATE INDEX "pboc_deposit_rates_deleted_at_idx" ON "pboc_deposit_rates"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "pboc_loan_rates_effect_date_key" ON "pboc_loan_rates"("effect_date");

-- CreateIndex
CREATE INDEX "pboc_loan_rates_effect_date_idx" ON "pboc_loan_rates"("effect_date" DESC);

-- CreateIndex
CREATE INDEX "pboc_loan_rates_deleted_at_idx" ON "pboc_loan_rates"("deleted_at");
