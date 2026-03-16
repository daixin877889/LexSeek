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
    "end_at" TIMESTAMPTZ(6),
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "icon" VARCHAR(100),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "case_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT,
    "user_id" INTEGER NOT NULL,
    "case_type_id" INTEGER NOT NULL,
    "plaintiff" JSONB,
    "defendant" JSONB,
    "status" INTEGER NOT NULL DEFAULT 1,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_sessions" (
    "id" SERIAL NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "case_id" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "case_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_materials" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" INTEGER NOT NULL,
    "content" TEXT,
    "original_content" TEXT,
    "oss_file_id" INTEGER,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "embedding_status" VARCHAR(20) DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "case_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_analyses" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "session_id" VARCHAR(100) NOT NULL,
    "node_id" INTEGER NOT NULL,
    "analysis_type" VARCHAR(100) NOT NULL,
    "analysis_result" TEXT,
    "original_result" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "case_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_cases" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "case_type_id" INTEGER NOT NULL,
    "materials" JSONB NOT NULL DEFAULT '[]',
    "cover_image" VARCHAR(500),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "demo_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_material_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,

    CONSTRAINT "case_material_embeddings_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "legal_main" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT NOT NULL,
    "issuing_authority" TEXT,
    "document_number" TEXT,
    "publish_date" DATE,
    "effective_date" DATE,
    "invalid_date" DATE,
    "last_edited_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "last_embedding_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "legal_main_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_articles" (
    "id" TEXT NOT NULL,
    "legal_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "l1" TEXT,
    "l1_i" INTEGER,
    "l2" TEXT,
    "l2_i" INTEGER,
    "l3" TEXT,
    "l3_i" INTEGER,
    "l4" TEXT,
    "l4_i" INTEGER,
    "l5" TEXT,
    "l5_i" INTEGER,
    "order" INTEGER,
    "content" TEXT,
    "publish_date" DATE,
    "effective_date" DATE,
    "invalid_date" DATE,
    "last_edited_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "last_embedding_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "legal_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "law_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,

    CONSTRAINT "law_embeddings_pkey" PRIMARY KEY ("id")
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
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "unit_type" VARCHAR(20) NOT NULL,
    "consumption_mode" VARCHAR(20) NOT NULL,
    "default_value" BIGINT NOT NULL DEFAULT 0,
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
    "benefit_value" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "membership_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_benefits" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "benefit_id" INTEGER NOT NULL,
    "benefit_value" BIGINT NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_id" INTEGER,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "expired_at" TIMESTAMPTZ(6) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_providers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "base_url" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_api_keys" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "daily_limit" INTEGER,
    "monthly_limit" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "model_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "model_type" VARCHAR(20) NOT NULL,
    "sdk_type" VARCHAR(20) NOT NULL DEFAULT 'openai',
    "model_version" VARCHAR(50),
    "context_window" INTEGER,
    "dimensions" INTEGER,
    "batch_size" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "input_cost_per_million_tokens" DECIMAL(12,4),
    "output_cost_per_million_tokens" DECIMAL(12,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "node_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "title" VARCHAR(100),
    "description" VARCHAR(255),
    "type" VARCHAR(100) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "model_id" INTEGER NOT NULL,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "group_id" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "title" VARCHAR(100),
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "version" VARCHAR(100) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "node_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "level_node_access" (
    "id" SERIAL NOT NULL,
    "level_id" INTEGER NOT NULL,
    "node_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "level_node_access_pkey" PRIMARY KEY ("id")
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
    "key" VARCHAR(50),
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
    "batch_id" VARCHAR(36),
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
CREATE TABLE "doc_recognition_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "oss_file_id" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "html_content" TEXT,
    "markdown_content" TEXT,
    "keywords" JSONB DEFAULT '[]',
    "summary" TEXT,
    "vector_ids" JSONB DEFAULT '[]',
    "last_embedding_at" TIMESTAMPTZ(6),
    "last_edit_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "doc_recognition_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_recognition_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "oss_file_id" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "image_type" VARCHAR(50),
    "html_content" TEXT,
    "markdown_content" TEXT,
    "keywords" JSONB DEFAULT '[]',
    "summary" TEXT,
    "vector_ids" JSONB DEFAULT '[]',
    "last_embedding_at" TIMESTAMPTZ(6),
    "last_edit_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "image_recognition_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_tasks" (
    "id" SERIAL NOT NULL,
    "task_id" VARCHAR(100),
    "status" INTEGER NOT NULL DEFAULT 0,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "task_raw_data" JSONB DEFAULT '{}',
    "result" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "asr_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asr_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "oss_file_id" INTEGER NOT NULL,
    "asr_tasks_id" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 0,
    "audio_url" TEXT,
    "audio_duration" INTEGER,
    "result" JSONB DEFAULT '{}',
    "json_oss_file_id" INTEGER,
    "temp_file_path" VARCHAR(500),
    "speakers" JSONB DEFAULT '[]',
    "keywords" JSONB DEFAULT '[]',
    "summary" TEXT,
    "vector_ids" JSONB DEFAULT '[]',
    "last_embedding_at" TIMESTAMPTZ(6),
    "last_edit_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "asr_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mineru_tokens" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "remark" VARCHAR(255),
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mineru_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mineru_tasks" (
    "id" SERIAL NOT NULL,
    "task_id" VARCHAR(100),
    "oss_file_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "is_encrypted" BOOLEAN NOT NULL DEFAULT false,
    "task_raw_data" JSONB DEFAULT '{}',
    "result" JSONB DEFAULT '{}',
    "error_msg" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "mineru_tasks_pkey" PRIMARY KEY ("id")
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
    "menu_group" VARCHAR(100),
    "menu_group_sort" INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX "idx_case_types_priority" ON "case_types"("priority");

-- CreateIndex
CREATE INDEX "idx_case_types_status" ON "case_types"("status");

-- CreateIndex
CREATE INDEX "idx_case_types_deleted_at" ON "case_types"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_cases_user_id" ON "cases"("user_id");

-- CreateIndex
CREATE INDEX "idx_cases_case_type_id" ON "cases"("case_type_id");

-- CreateIndex
CREATE INDEX "idx_cases_status" ON "cases"("status");

-- CreateIndex
CREATE INDEX "idx_cases_is_demo" ON "cases"("is_demo");

-- CreateIndex
CREATE INDEX "idx_cases_deleted_at" ON "cases"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "case_sessions_session_id_key" ON "case_sessions"("session_id");

-- CreateIndex
CREATE INDEX "idx_case_sessions_case_id" ON "case_sessions"("case_id");

-- CreateIndex
CREATE INDEX "idx_case_sessions_status" ON "case_sessions"("status");

-- CreateIndex
CREATE INDEX "idx_case_sessions_deleted_at" ON "case_sessions"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_case_materials_case_id" ON "case_materials"("case_id");

-- CreateIndex
CREATE INDEX "idx_case_materials_type" ON "case_materials"("type");

-- CreateIndex
CREATE INDEX "idx_case_materials_status" ON "case_materials"("status");

-- CreateIndex
CREATE INDEX "idx_case_materials_deleted_at" ON "case_materials"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_case_analyses_case_id" ON "case_analyses"("case_id");

-- CreateIndex
CREATE INDEX "idx_case_analyses_session_id" ON "case_analyses"("session_id");

-- CreateIndex
CREATE INDEX "idx_case_analyses_node_id" ON "case_analyses"("node_id");

-- CreateIndex
CREATE INDEX "idx_case_analyses_analysis_type" ON "case_analyses"("analysis_type");

-- CreateIndex
CREATE INDEX "idx_case_analyses_status" ON "case_analyses"("status");

-- CreateIndex
CREATE INDEX "idx_case_analyses_deleted_at" ON "case_analyses"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_demo_cases_case_type_id" ON "demo_cases"("case_type_id");

-- CreateIndex
CREATE INDEX "idx_demo_cases_priority" ON "demo_cases"("priority");

-- CreateIndex
CREATE INDEX "idx_demo_cases_status" ON "demo_cases"("status");

-- CreateIndex
CREATE INDEX "idx_demo_cases_deleted_at" ON "demo_cases"("deleted_at");

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
CREATE INDEX "idx_legal_main_type" ON "legal_main"("type");

-- CreateIndex
CREATE INDEX "idx_legal_main_code" ON "legal_main"("code");

-- CreateIndex
CREATE INDEX "idx_legal_main_issuing_authority" ON "legal_main"("issuing_authority");

-- CreateIndex
CREATE INDEX "idx_legal_main_deleted_at" ON "legal_main"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_legal_articles_legal_id" ON "legal_articles"("legal_id");

-- CreateIndex
CREATE INDEX "idx_legal_articles_deleted_at" ON "legal_articles"("deleted_at");

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
CREATE UNIQUE INDEX "benefits_code_key" ON "benefits"("code");

-- CreateIndex
CREATE INDEX "idx_benefits_code" ON "benefits"("code");

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
CREATE INDEX "idx_user_benefits_user_id" ON "user_benefits"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_benefits_benefit_id" ON "user_benefits"("benefit_id");

-- CreateIndex
CREATE INDEX "idx_user_benefits_source_type" ON "user_benefits"("source_type");

-- CreateIndex
CREATE INDEX "idx_user_benefits_effective_at" ON "user_benefits"("effective_at");

-- CreateIndex
CREATE INDEX "idx_user_benefits_expired_at" ON "user_benefits"("expired_at");

-- CreateIndex
CREATE INDEX "idx_user_benefits_status" ON "user_benefits"("status");

-- CreateIndex
CREATE INDEX "idx_user_benefits_deleted_at" ON "user_benefits"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_providers_name_key" ON "model_providers"("name");

-- CreateIndex
CREATE INDEX "idx_model_providers_deleted_at" ON "model_providers"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_model_providers_name" ON "model_providers"("name");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_provider_id" ON "model_api_keys"("provider_id");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_is_default" ON "model_api_keys"("is_default");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_status" ON "model_api_keys"("status");

-- CreateIndex
CREATE INDEX "idx_model_api_keys_deleted_at" ON "model_api_keys"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_api_keys_provider_id_name_key" ON "model_api_keys"("provider_id", "name");

-- CreateIndex
CREATE INDEX "idx_models_provider_id" ON "models"("provider_id");

-- CreateIndex
CREATE INDEX "idx_models_model_type" ON "models"("model_type");

-- CreateIndex
CREATE INDEX "idx_models_is_default" ON "models"("is_default");

-- CreateIndex
CREATE INDEX "idx_models_status" ON "models"("status");

-- CreateIndex
CREATE INDEX "idx_models_priority" ON "models"("priority");

-- CreateIndex
CREATE INDEX "idx_models_deleted_at" ON "models"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "models_provider_id_name_key" ON "models"("provider_id", "name");

-- CreateIndex
CREATE INDEX "idx_node_groups_priority" ON "node_groups"("priority");

-- CreateIndex
CREATE INDEX "idx_node_groups_deleted_at" ON "node_groups"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "nodes_name_key" ON "nodes"("name");

-- CreateIndex
CREATE INDEX "idx_nodes_name" ON "nodes"("name");

-- CreateIndex
CREATE INDEX "idx_nodes_type" ON "nodes"("type");

-- CreateIndex
CREATE INDEX "idx_nodes_priority" ON "nodes"("priority");

-- CreateIndex
CREATE INDEX "idx_nodes_group_id" ON "nodes"("group_id");

-- CreateIndex
CREATE INDEX "idx_nodes_model_id" ON "nodes"("model_id");

-- CreateIndex
CREATE INDEX "idx_nodes_status" ON "nodes"("status");

-- CreateIndex
CREATE INDEX "idx_nodes_deleted_at" ON "nodes"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_prompts_name" ON "prompts"("name");

-- CreateIndex
CREATE INDEX "idx_prompts_node_id" ON "prompts"("node_id");

-- CreateIndex
CREATE INDEX "idx_prompts_type" ON "prompts"("type");

-- CreateIndex
CREATE INDEX "idx_prompts_status" ON "prompts"("status");

-- CreateIndex
CREATE INDEX "idx_prompts_deleted_at" ON "prompts"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_level_node_access_level_id" ON "level_node_access"("level_id");

-- CreateIndex
CREATE INDEX "idx_level_node_access_node_id" ON "level_node_access"("node_id");

-- CreateIndex
CREATE INDEX "idx_level_node_access_deleted_at" ON "level_node_access"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "level_node_access_level_id_node_id_key" ON "level_node_access"("level_id", "node_id");

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
CREATE UNIQUE INDEX "point_consumption_items_key_key" ON "point_consumption_items"("key");

-- CreateIndex
CREATE INDEX "idx_point_consumption_items_key" ON "point_consumption_items"("key");

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
CREATE INDEX "idx_point_consumption_records_batch_id" ON "point_consumption_records"("batch_id");

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
CREATE INDEX "idx_doc_recognition_records_user_id" ON "doc_recognition_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_doc_recognition_records_oss_file_id" ON "doc_recognition_records"("oss_file_id");

-- CreateIndex
CREATE INDEX "idx_doc_recognition_records_status" ON "doc_recognition_records"("status");

-- CreateIndex
CREATE INDEX "idx_doc_recognition_records_deleted_at" ON "doc_recognition_records"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_image_recognition_records_user_id" ON "image_recognition_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_image_recognition_records_oss_file_id" ON "image_recognition_records"("oss_file_id");

-- CreateIndex
CREATE INDEX "idx_image_recognition_records_status" ON "image_recognition_records"("status");

-- CreateIndex
CREATE INDEX "idx_image_recognition_records_image_type" ON "image_recognition_records"("image_type");

-- CreateIndex
CREATE INDEX "idx_image_recognition_records_deleted_at" ON "image_recognition_records"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_asr_tasks_task_id" ON "asr_tasks"("task_id");

-- CreateIndex
CREATE INDEX "idx_asr_tasks_status" ON "asr_tasks"("status");

-- CreateIndex
CREATE INDEX "idx_asr_tasks_deleted_at" ON "asr_tasks"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_asr_records_user_id" ON "asr_records"("user_id");

-- CreateIndex
CREATE INDEX "idx_asr_records_oss_file_id" ON "asr_records"("oss_file_id");

-- CreateIndex
CREATE INDEX "idx_asr_records_asr_tasks_id" ON "asr_records"("asr_tasks_id");

-- CreateIndex
CREATE INDEX "idx_asr_records_status" ON "asr_records"("status");

-- CreateIndex
CREATE INDEX "idx_asr_records_deleted_at" ON "asr_records"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_mineru_tokens_status" ON "mineru_tokens"("status");

-- CreateIndex
CREATE INDEX "idx_mineru_tokens_deleted_at" ON "mineru_tokens"("deleted_at");

-- CreateIndex
CREATE INDEX "idx_mineru_tasks_task_id" ON "mineru_tasks"("task_id");

-- CreateIndex
CREATE INDEX "idx_mineru_tasks_oss_file_id" ON "mineru_tasks"("oss_file_id");

-- CreateIndex
CREATE INDEX "idx_mineru_tasks_user_id" ON "mineru_tasks"("user_id");

-- CreateIndex
CREATE INDEX "idx_mineru_tasks_status" ON "mineru_tasks"("status");

-- CreateIndex
CREATE INDEX "idx_mineru_tasks_deleted_at" ON "mineru_tasks"("deleted_at");

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
CREATE INDEX "idx_routers_menu_group" ON "routers"("menu_group");

-- CreateIndex
CREATE INDEX "idx_routers_menu_group_sort" ON "routers"("menu_group_sort");

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
ALTER TABLE "cases" ADD CONSTRAINT "cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_case_type_id_fkey" FOREIGN KEY ("case_type_id") REFERENCES "case_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_sessions" ADD CONSTRAINT "case_sessions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_materials" ADD CONSTRAINT "case_materials_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_analyses" ADD CONSTRAINT "case_analyses_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_analyses" ADD CONSTRAINT "case_analyses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "case_sessions"("session_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_analyses" ADD CONSTRAINT "case_analyses_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "demo_cases" ADD CONSTRAINT "demo_cases_case_type_id_fkey" FOREIGN KEY ("case_type_id") REFERENCES "case_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "legal_articles" ADD CONSTRAINT "legal_articles_legal_id_fkey" FOREIGN KEY ("legal_id") REFERENCES "legal_main"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_benefits" ADD CONSTRAINT "membership_benefits_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "membership_benefits" ADD CONSTRAINT "membership_benefits_benefit_id_fkey" FOREIGN KEY ("benefit_id") REFERENCES "benefits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_benefits" ADD CONSTRAINT "user_benefits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_benefits" ADD CONSTRAINT "user_benefits_benefit_id_fkey" FOREIGN KEY ("benefit_id") REFERENCES "benefits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_api_keys" ADD CONSTRAINT "model_api_keys_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "node_groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "level_node_access" ADD CONSTRAINT "level_node_access_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "level_node_access" ADD CONSTRAINT "level_node_access_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

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
ALTER TABLE "doc_recognition_records" ADD CONSTRAINT "doc_recognition_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "image_recognition_records" ADD CONSTRAINT "image_recognition_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asr_records" ADD CONSTRAINT "asr_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "asr_records" ADD CONSTRAINT "asr_records_asr_tasks_id_fkey" FOREIGN KEY ("asr_tasks_id") REFERENCES "asr_tasks"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "mineru_tasks" ADD CONSTRAINT "mineru_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

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
