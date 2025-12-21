-- CreateTable
CREATE TABLE "routers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" VARCHAR(200),
    "path" VARCHAR(200) NOT NULL,
    "permission" VARCHAR(100) NOT NULL DEFAULT 'user',
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

-- AddForeignKey
ALTER TABLE "routers" ADD CONSTRAINT "routers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "router_groups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "routers" ADD CONSTRAINT "routers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "routers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
