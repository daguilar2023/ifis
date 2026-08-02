# IFIS publications admin setup

## Local development

```bash
cp .dev.vars.example .dev.vars
# edit ADMIN_PASSWORD and SESSION_SECRET
npm install
npm run db:migrate:local
npm run seed:local
npm run dev
```

- Public site: http://localhost:8787
- Hidden admin: http://localhost:8787/admin/
- Publicaciones loads from D1 (newest first) with dates

## Remote Cloudflare (one-time)

1. `npx wrangler login`
2. `npx wrangler d1 create ifis-publications`  
   Copy the `database_id` into `wrangler.jsonc`
3. `npx wrangler r2 bucket create ifis-docs`
4. `npm run db:migrate:remote`
5. `npm run seed:remote`
6. Set secrets (do not commit):
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```
7. Deploy when ready: `npm run deploy`  
   (or merge to `main` if Git auto-deploy is connected)

## Admin features

- Login with shared password (HttpOnly Secure cookie + CSRF)
- Upload PDF + optional preview image
- Edit title/description
- Delete with confirmation
- `/admin` is not linked in the public navigation
