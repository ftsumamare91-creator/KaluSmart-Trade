# PostgreSQL

Use PostgreSQL 16 or newer. Create a database and role, then set `DATABASE_URL` in `apps/api/.env`. Prisma migrations are the canonical schema source. `pgvector` is optional until semantic document search is enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Do not enable the extension unless it is installed on your PostgreSQL server.
