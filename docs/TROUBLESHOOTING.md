# Troubleshooting API errors

Errors now come back with a clear message. The API terminal shows the cause (code and stack trace) for server errors.

| Response | Meaning | What to do |
|---|---|---|
| 500 `Database error.` with `code: P2021` or `P2022` | A table or column does not exist yet | `npx prisma migrate dev --name init` |
| 503 `The database is not reachable` | PostgreSQL is not running or `DATABASE_URL` is wrong | Start PostgreSQL and check `DATABASE_URL` |
| 500 `Internal server error` | Unexpected failure | Read the terminal stack trace and report it |
| 400 `Invalid request data.` | Input had the wrong shape | Check the request body and types |
| 503 `AI assistant is not configured` | `AI_SERVICE_TOKEN` missing | Set the same token in both `.env` files |
| 503 `The AI service is not running` | AI service is down | `uvicorn main:app --port 8000` in `apps/ai-service` |
| Server does not start: `Missing or unsafe configuration` | Names listed are missing or unsafe | Fix only those variables in `.env` |
| Signup works but no email arrives | Email provider not reachable or not verified | Check `EMAIL_PROVIDER`, `RESEND_API_KEY`, domain verification |

After `npm install`, `prisma generate` runs automatically (`postinstall`). If you see errors about `@prisma/client` not initialised, run `npx prisma generate` once.
