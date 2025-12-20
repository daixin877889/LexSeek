-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('LOGIN', 'REGISTER', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "username" VARCHAR(100),
    "email" VARCHAR(100),
    "phone" VARCHAR(11) NOT NULL,
    "password" VARCHAR(100),
    "role" "UserRole" NOT NULL DEFAULT 'user',
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
CREATE INDEX "idx_users_role" ON "users"("role");

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
