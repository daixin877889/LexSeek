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

-- AddForeignKey
ALTER TABLE "role_routers" ADD CONSTRAINT "role_routers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_routers" ADD CONSTRAINT "role_routers_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
