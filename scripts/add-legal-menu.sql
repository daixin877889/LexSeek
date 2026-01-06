-- 添加法律法规菜单项
-- 在案件分析（id=4）后面添加法律法规菜单

-- 插入法律法规主菜单
INSERT INTO "public"."routers" (
    "name", 
    "title", 
    "description", 
    "path", 
    "is_menu", 
    "parent_id", 
    "icon", 
    "group_id", 
    "sort", 
    "menu_group", 
    "menu_group_sort",
    "created_at", 
    "updated_at"
) VALUES (
    'legal', 
    '法律法规', 
    '法律法规搜索和浏览', 
    '/dashboard/legal', 
    't', 
    NULL, 
    'lucideIcons.Scale', 
    1, 
    5, 
    NULL, 
    0,
    NOW(), 
    NOW()
);

-- 为普通用户角色添加法律法规权限
INSERT INTO "public"."role_routers" (
    "role_id", 
    "router_id", 
    "created_at", 
    "updated_at"
) 
SELECT 
    1, -- 普通用户角色ID
    r.id,
    NOW(),
    NOW()
FROM "public"."routers" r 
WHERE r.name = 'legal';

-- 为管理员角色添加法律法规权限
INSERT INTO "public"."role_routers" (
    "role_id", 
    "router_id", 
    "created_at", 
    "updated_at"
) 
SELECT 
    2, -- 管理员角色ID
    r.id,
    NOW(),
    NOW()
FROM "public"."routers" r 
WHERE r.name = 'legal';

-- 为超级管理员角色添加法律法规权限
INSERT INTO "public"."role_routers" (
    "role_id", 
    "router_id", 
    "created_at", 
    "updated_at"
) 
SELECT 
    3, -- 超级管理员角色ID
    r.id,
    NOW(),
    NOW()
FROM "public"."routers" r 
WHERE r.name = 'legal';