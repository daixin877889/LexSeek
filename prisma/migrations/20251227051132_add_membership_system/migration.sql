-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" INTEGER NOT NULL,
    "level_id" INTEGER,
    "duration" INTEGER,
    "gift_point" INTEGER,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_levels" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "membership_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_memberships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "level_id" INTEGER NOT NULL,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "source_type" INTEGER NOT NULL,
    "source_id" INTEGER,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefits" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "type" VARCHAR(50) NOT NULL,
    "value" JSONB,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_benefits" (
    "id" SERIAL NOT NULL,
    "level_id" INTEGER NOT NULL,
    "benefit_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "membership_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "duration" INTEGER NOT NULL,
    "duration_unit" VARCHAR(10) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "expired_at" TIMESTAMPTZ(6) NOT NULL,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" SERIAL NOT NULL,
    "transaction_no" VARCHAR(32) NOT NULL,
    "order_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_channel" VARCHAR(20) NOT NULL,
    "payment_method" VARCHAR(20) NOT NULL,
    "out_trade_no" VARCHAR(64),
    "prepay_id" VARCHAR(64),
    "status" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "expired_at" TIMESTAMPTZ(6) NOT NULL,
    "callback_data" JSONB,
    "error_message" VARCHAR(255),
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_upgrade_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "from_membership_id" INTEGER NOT NULL,
    "to_membership_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "upgrade_price" DECIMAL(10,2) NOT NULL,
    "point_compensation" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "membership_upgrade_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" INTEGER NOT NULL,
    "level_id" INTEGER,
    "price_monthly" DECIMAL(10,2),
    "price_yearly" DECIMAL(10,2),
    "gift_point" INTEGER,
    "unit_price" DECIMAL(10,2),
    "point_amount" INTEGER,
    "purchase_limit" INTEGER DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_codes" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "type" INTEGER NOT NULL,
    "level_id" INTEGER,
    "duration" INTEGER,
    "point_amount" INTEGER,
    "expired_at" TIMESTAMPTZ(6),
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "redemption_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemption_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "redemption_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_campaigns_type" ON "campaigns"("type");

-- CreateIndex
CREATE INDEX "idx_campaigns_status" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "idx_campaigns_start_at" ON "campaigns"("start_at");

-- CreateIndex
CREATE INDEX "idx_campaigns_end_at" ON "campaigns"("end_at");

-- CreateIndex
CREATE INDEX "idx_campaigns_deleted_at" ON "campaigns"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_membership_levels_sort_order" ON "membership_levels"("sort_order");

-- CreateIndex
CREATE INDEX "idx_membership_levels_status" ON "membership_levels"("status");

-- CreateIndex
CREATE INDEX "idx_membership_levels_deleted_at" ON "membership_levels"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_user_memberships_user_id" ON "user_memberships"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_memberships_level_id" ON "user_memberships"("level_id");

-- CreateIndex
CREATE INDEX "idx_user_memberships_status" ON "user_memberships"("status");

-- CreateIndex
CREATE INDEX "idx_user_memberships_end_date" ON "user_memberships"("end_date");

-- CreateIndex
CREATE INDEX "idx_user_memberships_deleted_at" ON "user_memberships"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_benefits_type" ON "benefits"("type");

-- CreateIndex
CREATE INDEX "idx_benefits_status" ON "benefits"("status");

-- CreateIndex
CREATE INDEX "idx_benefits_deleted_at" ON "benefits"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_membership_benefits_level_id" ON "membership_benefits"("level_id");

-- CreateIndex
CREATE INDEX "idx_membership_benefits_benefit_id" ON "membership_benefits"("benefit_id");

-- CreateIndex
CREATE INDEX "idx_membership_benefits_deleted_at" ON "membership_benefits"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "membership_benefits_level_id_benefit_id_key" ON "membership_benefits"("level_id", "benefit_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "idx_orders_order_no" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "idx_orders_user_id" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "idx_orders_product_id" ON "orders"("product_id");

-- CreateIndex
CREATE INDEX "idx_orders_status" ON "orders"("status");

-- CreateIndex
CREATE INDEX "idx_orders_expired_at" ON "orders"("expired_at");

-- CreateIndex
CREATE INDEX "idx_orders_deleted_at" ON "orders"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_transaction_no_key" ON "payment_transactions"("transaction_no");

-- CreateIndex
CREATE INDEX "idx_payment_transactions_transaction_no" ON "payment_transactions"("transaction_no");

-- CreateIndex
CREATE INDEX "idx_payment_transactions_order_id" ON "payment_transactions"("order_id");

-- CreateIndex
CREATE INDEX "idx_payment_transactions_out_trade_no" ON "payment_transactions"("out_trade_no");

-- CreateIndex
CREATE INDEX "idx_payment_transactions_status" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "idx_payment_transactions_expired_at" ON "payment_transactions"("expired_at");

-- CreateIndex
CREATE INDEX "idx_payment_transactions_deleted_at" ON "payment_transactions"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_membership_upgrade_records_user_id" ON "membership_upgrade_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_membership_upgrade_records_from_membership_id" ON "membership_upgrade_records"("from_membership_id");

-- CreateIndex
CREATE INDEX "idx_membership_upgrade_records_to_membership_id" ON "membership_upgrade_records"("to_membership_id");

-- CreateIndex
CREATE INDEX "idx_membership_upgrade_records_deleted_at" ON "membership_upgrade_records"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_products_type" ON "products"("type");

-- CreateIndex
CREATE INDEX "idx_products_level_id" ON "products"("level_id");

-- CreateIndex
CREATE INDEX "idx_products_status" ON "products"("status");

-- CreateIndex
CREATE INDEX "idx_products_sort_order" ON "products"("sort_order");

-- CreateIndex
CREATE INDEX "idx_products_deleted_at" ON "products"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "redemption_codes_code_key" ON "redemption_codes"("code");

-- CreateIndex
CREATE INDEX "idx_redemption_codes_code" ON "redemption_codes"("code");

-- CreateIndex
CREATE INDEX "idx_redemption_codes_status" ON "redemption_codes"("status");

-- CreateIndex
CREATE INDEX "idx_redemption_codes_expired_at" ON "redemption_codes"("expired_at");

-- CreateIndex
CREATE INDEX "idx_redemption_codes_deleted_at" ON "redemption_codes"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_redemption_records_user_id" ON "redemption_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_redemption_records_code_id" ON "redemption_records"("code_id");

-- CreateIndex
CREATE INDEX "idx_redemption_records_deleted_at" ON "redemption_records"("deleted_at");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_benefits" ADD CONSTRAINT "membership_benefits_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_benefits" ADD CONSTRAINT "membership_benefits_benefit_id_fkey" FOREIGN KEY ("benefit_id") REFERENCES "benefits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_upgrade_records" ADD CONSTRAINT "membership_upgrade_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_upgrade_records" ADD CONSTRAINT "membership_upgrade_records_from_membership_id_fkey" FOREIGN KEY ("from_membership_id") REFERENCES "user_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_upgrade_records" ADD CONSTRAINT "membership_upgrade_records_to_membership_id_fkey" FOREIGN KEY ("to_membership_id") REFERENCES "user_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_upgrade_records" ADD CONSTRAINT "membership_upgrade_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_records" ADD CONSTRAINT "point_records_user_membership_id_fkey" FOREIGN KEY ("user_membership_id") REFERENCES "user_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "redemption_codes" ADD CONSTRAINT "redemption_codes_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "redemption_records" ADD CONSTRAINT "redemption_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "redemption_records" ADD CONSTRAINT "redemption_records_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "redemption_codes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
