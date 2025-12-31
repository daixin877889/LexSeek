-- CreateTable
CREATE TABLE "api_permission_groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "api_permission_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_permissions" (
    "id" SERIAL NOT NULL,
    "path" VARCHAR(200) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "group_id" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "api_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_api_permissions" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "role_api_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_audit_logs" (
    "id" SERIAL NOT NULL,
    "operator_id" INTEGER NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target_type" VARCHAR(50) NOT NULL,
    "target_id" INTEGER,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" VARCHAR(50),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "user_encryptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "encrypted_identity" TEXT NOT NULL,
    "encrypted_recovery_key" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_encryptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oss_files" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "bucket_name" VARCHAR(100) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500),
    "file_size" DECIMAL(15,2) NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "file_md5" VARCHAR(32),
    "source" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "original_mime_type" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "oss_files_pkey" PRIMARY KEY ("id")
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
    "settlement_at" TIMESTAMPTZ(6),
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
    "order_type" VARCHAR(20) NOT NULL DEFAULT 'purchase',
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
    "transfer_points" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "membership_upgrade_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "used" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "source_type" INTEGER NOT NULL,
    "source_id" INTEGER,
    "user_membership_id" INTEGER,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "expired_at" TIMESTAMPTZ(6) NOT NULL,
    "settlement_at" TIMESTAMPTZ(6),
    "status" INTEGER NOT NULL DEFAULT 1,
    "transfer_out" INTEGER DEFAULT 0,
    "transfer_to_record_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "point_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_consumption_items" (
    "id" SERIAL NOT NULL,
    "group" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "unit" VARCHAR(10) NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "discount" DECIMAL(3,2) DEFAULT 1,

    CONSTRAINT "point_consumption_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_consumption_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "point_record_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "point_amount" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "source_id" INTEGER,
    "remark" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "point_consumption_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "type" INTEGER NOT NULL,
    "category" VARCHAR(50),
    "level_id" INTEGER,
    "price_monthly" DECIMAL(10,2),
    "price_yearly" DECIMAL(10,2),
    "default_duration" INTEGER,
    "unit_price" DECIMAL(10,2),
    "original_price_monthly" DECIMAL(10,2),
    "original_price_yearly" DECIMAL(10,2),
    "original_unit_price" DECIMAL(10,2),
    "min_quantity" INTEGER DEFAULT 1,
    "max_quantity" INTEGER,
    "purchase_limit" INTEGER DEFAULT 0,
    "point_amount" INTEGER,
    "gift_point" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_routers" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "router_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "role_routers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "routers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "path" VARCHAR(200) NOT NULL,
    "is_menu" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" INTEGER,
    "icon" VARCHAR(100),
    "group_id" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "routers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "router_groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "router_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_records" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(11) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "expired_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "sms_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_configs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "storage_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" SERIAL NOT NULL,
    "config_group" VARCHAR(50) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(255),
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "username" VARCHAR(100),
    "email" VARCHAR(100),
    "phone" VARCHAR(11) NOT NULL,
    "password" VARCHAR(100),
    "status" INTEGER NOT NULL DEFAULT 1,
    "company" VARCHAR(100),
    "profile" TEXT,
    "invite_code" VARCHAR(10),
    "invited_by" INTEGER,
    "openid" VARCHAR(100),
    "unionid" VARCHAR(100),
    "register_channel" VARCHAR(100),
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_blacklist" (
    "id" UUID NOT NULL,
    "token" TEXT,
    "user_id" INTEGER NOT NULL,
    "expired_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_permission_groups_name_key" ON "api_permission_groups"("name");

-- CreateIndex
CREATE INDEX "idx_api_permission_groups_name" ON "api_permission_groups"("name");

-- CreateIndex
CREATE INDEX "idx_api_permission_groups_sort" ON "api_permission_groups"("sort");

-- CreateIndex
CREATE INDEX "idx_api_permission_groups_status" ON "api_permission_groups"("status");

-- CreateIndex
CREATE INDEX "idx_api_permission_groups_created_at" ON "api_permission_groups"("created_at");

-- CreateIndex
CREATE INDEX "idx_api_permission_groups_deleted_at" ON "api_permission_groups"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_api_permissions_path" ON "api_permissions"("path");

-- CreateIndex
CREATE INDEX "idx_api_permissions_method" ON "api_permissions"("method");

-- CreateIndex
CREATE INDEX "idx_api_permissions_is_public" ON "api_permissions"("is_public");

-- CreateIndex
CREATE INDEX "idx_api_permissions_group_id" ON "api_permissions"("group_id");

-- CreateIndex
CREATE INDEX "idx_api_permissions_status" ON "api_permissions"("status");

-- CreateIndex
CREATE INDEX "idx_api_permissions_created_at" ON "api_permissions"("created_at");

-- CreateIndex
CREATE INDEX "idx_api_permissions_deleted_at" ON "api_permissions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_permissions_path_method_key" ON "api_permissions"("path", "method");

-- CreateIndex
CREATE INDEX "idx_role_api_permissions_role_id" ON "role_api_permissions"("role_id");

-- CreateIndex
CREATE INDEX "idx_role_api_permissions_permission_id" ON "role_api_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "idx_role_api_permissions_created_at" ON "role_api_permissions"("created_at");

-- CreateIndex
CREATE INDEX "idx_role_api_permissions_deleted_at" ON "role_api_permissions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "role_api_permissions_role_id_permission_id_key" ON "role_api_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "idx_permission_audit_logs_operator_id" ON "permission_audit_logs"("operator_id");

-- CreateIndex
CREATE INDEX "idx_permission_audit_logs_action" ON "permission_audit_logs"("action");

-- CreateIndex
CREATE INDEX "idx_permission_audit_logs_target_type" ON "permission_audit_logs"("target_type");

-- CreateIndex
CREATE INDEX "idx_permission_audit_logs_target_id" ON "permission_audit_logs"("target_id");

-- CreateIndex
CREATE INDEX "idx_permission_audit_logs_created_at" ON "permission_audit_logs"("created_at");

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
CREATE UNIQUE INDEX "user_encryptions_user_id_key" ON "user_encryptions"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_encryptions_user_id" ON "user_encryptions"("user_id");

-- CreateIndex
CREATE INDEX "idx_oss_files_user_id" ON "oss_files"("user_id");

-- CreateIndex
CREATE INDEX "idx_oss_files_bucket_name" ON "oss_files"("bucket_name");

-- CreateIndex
CREATE INDEX "idx_oss_files_file_name" ON "oss_files"("file_name");

-- CreateIndex
CREATE INDEX "idx_oss_files_file_type" ON "oss_files"("file_type");

-- CreateIndex
CREATE INDEX "idx_oss_files_status" ON "oss_files"("status");

-- CreateIndex
CREATE INDEX "idx_oss_files_deleted_at" ON "oss_files"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_oss_files_encrypted" ON "oss_files"("encrypted");

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
CREATE INDEX "idx_point_records_user_id" ON "point_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_point_records_source_type" ON "point_records"("source_type");

-- CreateIndex
CREATE INDEX "idx_point_records_source_id" ON "point_records"("source_id");

-- CreateIndex
CREATE INDEX "idx_point_records_effective_at" ON "point_records"("effective_at");

-- CreateIndex
CREATE INDEX "idx_point_records_expired_at" ON "point_records"("expired_at");

-- CreateIndex
CREATE INDEX "idx_point_records_settlement_at" ON "point_records"("settlement_at");

-- CreateIndex
CREATE INDEX "idx_point_records_deleted_at" ON "point_records"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_name" ON "point_consumption_items"("name");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_status" ON "point_consumption_items"("status");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_deleted_at" ON "point_consumption_items"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_user_id" ON "point_consumption_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_item_id" ON "point_consumption_records"("item_id");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_status" ON "point_consumption_records"("status");

-- CreateIndex
CREATE INDEX "idx_point_consumption_records_deleted_at" ON "point_consumption_records"("deleted_at");

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
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "idx_roles_id" ON "roles"("id");

-- CreateIndex
CREATE INDEX "idx_roles_name" ON "roles"("name");

-- CreateIndex
CREATE INDEX "idx_roles_code" ON "roles"("code");

-- CreateIndex
CREATE INDEX "idx_roles_description" ON "roles"("description");

-- CreateIndex
CREATE INDEX "idx_roles_status" ON "roles"("status");

-- CreateIndex
CREATE INDEX "idx_roles_created_at" ON "roles"("created_at");

-- CreateIndex
CREATE INDEX "idx_roles_updated_at" ON "roles"("updated_at");

-- CreateIndex
CREATE INDEX "idx_roles_deleted_at" ON "roles"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_role_routers_id" ON "role_routers"("id");

-- CreateIndex
CREATE INDEX "idx_role_routers_role_id" ON "role_routers"("role_id");

-- CreateIndex
CREATE INDEX "idx_role_routers_router_id" ON "role_routers"("router_id");

-- CreateIndex
CREATE INDEX "idx_role_routers_created_at" ON "role_routers"("created_at");

-- CreateIndex
CREATE INDEX "idx_role_routers_updated_at" ON "role_routers"("updated_at");

-- CreateIndex
CREATE INDEX "idx_role_routers_deleted_at" ON "role_routers"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "role_routers_role_id_router_id_key" ON "role_routers"("role_id", "router_id");

-- CreateIndex
CREATE INDEX "idx_user_roles_user_id" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_roles_role_id" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "idx_user_roles_created_at" ON "user_roles"("created_at");

-- CreateIndex
CREATE INDEX "idx_user_roles_updated_at" ON "user_roles"("updated_at");

-- CreateIndex
CREATE INDEX "idx_user_roles_deleted_at" ON "user_roles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

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

-- CreateIndex
CREATE UNIQUE INDEX "routers_name_key" ON "routers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "routers_path_key" ON "routers"("path");

-- CreateIndex
CREATE INDEX "idx_routers_group_id" ON "routers"("group_id");

-- CreateIndex
CREATE INDEX "idx_routers_parent_id" ON "routers"("parent_id");

-- CreateIndex
CREATE INDEX "idx_routers_created_at" ON "routers"("created_at");

-- CreateIndex
CREATE INDEX "idx_routers_updated_at" ON "routers"("updated_at");

-- CreateIndex
CREATE INDEX "idx_routers_deleted_at" ON "routers"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "router_groups_name_key" ON "router_groups"("name");

-- CreateIndex
CREATE INDEX "idx_router_groups_id" ON "router_groups"("id");

-- CreateIndex
CREATE INDEX "idx_router_groups_name" ON "router_groups"("name");

-- CreateIndex
CREATE INDEX "idx_router_groups_description" ON "router_groups"("description");

-- CreateIndex
CREATE INDEX "idx_router_groups_sort" ON "router_groups"("sort");

-- CreateIndex
CREATE INDEX "idx_router_groups_status" ON "router_groups"("status");

-- CreateIndex
CREATE INDEX "idx_router_groups_created_at" ON "router_groups"("created_at");

-- CreateIndex
CREATE INDEX "idx_router_groups_updated_at" ON "router_groups"("updated_at");

-- CreateIndex
CREATE INDEX "idx_router_groups_deleted_at" ON "router_groups"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_sms_id" ON "sms_records"("id");

-- CreateIndex
CREATE INDEX "idx_sms_phone" ON "sms_records"("phone");

-- CreateIndex
CREATE INDEX "idx_sms_expired_at" ON "sms_records"("expired_at");

-- CreateIndex
CREATE INDEX "idx_sms_type" ON "sms_records"("type");

-- CreateIndex
CREATE INDEX "idx_sms_updated_at" ON "sms_records"("updated_at");

-- CreateIndex
CREATE INDEX "idx_sms_created_at" ON "sms_records"("created_at");

-- CreateIndex
CREATE INDEX "idx_sms_deleted_at" ON "sms_records"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "sms_records_phone_type_key" ON "sms_records"("phone", "type");

-- CreateIndex
CREATE INDEX "idx_storage_configs_user_id" ON "storage_configs"("user_id");

-- CreateIndex
CREATE INDEX "idx_storage_configs_type" ON "storage_configs"("type");

-- CreateIndex
CREATE INDEX "idx_storage_configs_is_default" ON "storage_configs"("is_default");

-- CreateIndex
CREATE INDEX "idx_storage_configs_enabled" ON "storage_configs"("enabled");

-- CreateIndex
CREATE INDEX "idx_storage_configs_deleted_at" ON "storage_configs"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_system_configs_config_group" ON "system_configs"("config_group");

-- CreateIndex
CREATE INDEX "idx_system_configs_key" ON "system_configs"("key");

-- CreateIndex
CREATE INDEX "idx_system_configs_status" ON "system_configs"("status");

-- CreateIndex
CREATE INDEX "idx_system_configs_deleted_at" ON "system_configs"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_config_group_key_key" ON "system_configs"("config_group", "key");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_invite_code_key" ON "users"("invite_code");

-- CreateIndex
CREATE INDEX "idx_users_id" ON "users"("id");

-- CreateIndex
CREATE INDEX "idx_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "idx_users_deleted_at" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_user_id" ON "token_blacklist"("user_id");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_expired_at" ON "token_blacklist"("expired_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_token" ON "token_blacklist"("token");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_created_at" ON "token_blacklist"("created_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_updated_at" ON "token_blacklist"("updated_at");

-- CreateIndex
CREATE INDEX "idx_token_blacklist_deleted_at" ON "token_blacklist"("deleted_at");

-- AddForeignKey
ALTER TABLE "api_permissions" ADD CONSTRAINT "api_permissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "api_permission_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_api_permissions" ADD CONSTRAINT "role_api_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_api_permissions" ADD CONSTRAINT "role_api_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "api_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "point_records" ADD CONSTRAINT "point_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_records" ADD CONSTRAINT "point_records_user_membership_id_fkey" FOREIGN KEY ("user_membership_id") REFERENCES "user_memberships"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_consumption_records" ADD CONSTRAINT "point_consumption_records_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "point_consumption_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_consumption_records" ADD CONSTRAINT "point_consumption_records_point_record_id_fkey" FOREIGN KEY ("point_record_id") REFERENCES "point_records"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "point_consumption_records" ADD CONSTRAINT "point_consumption_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_routers" ADD CONSTRAINT "role_routers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_routers" ADD CONSTRAINT "role_routers_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemption_codes" ADD CONSTRAINT "redemption_codes_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "redemption_records" ADD CONSTRAINT "redemption_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "redemption_records" ADD CONSTRAINT "redemption_records_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "redemption_codes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "routers" ADD CONSTRAINT "routers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "router_groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "routers" ADD CONSTRAINT "routers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "routers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
