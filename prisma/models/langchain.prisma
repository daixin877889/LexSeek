model checkpoint_blobs {
  thread_id     String
  checkpoint_ns String @default("")
  channel       String
  version       String
  type          String
  blob          Bytes?

  @@id([thread_id, checkpoint_ns, channel, version])
}

model checkpoint_migrations {
  v Int @id
}

model checkpoint_writes {
  thread_id     String
  checkpoint_ns String  @default("")
  checkpoint_id String
  task_id       String
  idx           Int
  channel       String
  type          String?
  blob          Bytes

  @@id([thread_id, checkpoint_ns, checkpoint_id, task_id, idx])
}

model checkpoints {
  thread_id            String
  checkpoint_ns        String  @default("")
  checkpoint_id        String
  parent_checkpoint_id String?
  type                 String?
  checkpoint           Json
  metadata             Json    @default("{}")

  @@id([thread_id, checkpoint_ns, checkpoint_id])
}

model store {
  namespace_path String
  key            String
  value          Json
  created_at     DateTime? @default(now()) @db.Timestamptz(6)
  updated_at     DateTime? @default(now()) @db.Timestamptz(6)
  expires_at     DateTime? @db.Timestamptz(6)

  @@id([namespace_path, key])
  @@index([expires_at], map: "idx_store_expires_at", where: raw("(expires_at IS NOT NULL)"))
  @@index([namespace_path], map: "idx_store_namespace_path")
  @@index([value], map: "idx_store_value_gin", type: Gin)
}

model store_migrations {
  v Int @id
}
