# IFIS website + publications admin (Supabase)

Cloudflare hosts the website.  
Supabase stores publication metadata + PDF files (**no Cloudflare R2 / no credit card needed for R2**).

## What you need to do in Supabase (click-by-click)

### 1) Create free project
1. Go to [https://supabase.com](https://supabase.com)
2. Click **Start your project** / **Sign in**
3. Click **New project**
4. Choose organization (or create one)
5. Fill:
   - **Name:** `ifis`
   - **Database password:** create a strong password and save it
   - **Region:** closest to Chile/LatAm if available
6. Click **Create new project**
7. Wait until project is ready

> If Supabase asks for a credit card, stop and tell me — we’ll use another free option.

### 2) Create database tables
1. Left sidebar → **SQL** → **SQL Editor**
2. Click **New query**
3. Open this file from the repo: `supabase/schema.sql`
4. Copy all SQL and paste into the editor
5. Click **Run**

### 3) Create storage bucket
1. Left sidebar → **Storage**
2. Click **New bucket**
3. Name: `publications`
4. Turn **Public bucket** ON (so PDFs can be opened on the website)
5. Click **Create bucket**

### 4) Copy API keys
1. Left sidebar → **Project Settings** (gear)
2. Click **API**
3. Copy:
   - **Project URL**
   - **service_role** key (secret — never share publicly)

### 5) Put keys in local `.dev.vars`
In the project folder, create/edit `.dev.vars`:

```bash
ADMIN_PASSWORD=choose-a-strong-password-for-Ilis
SESSION_SECRET=another-long-random-string
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=paste-service-role-key-here
```

### 6) Seed existing PDFs
```bash
npm install
npm run seed
```

### 7) Run locally
```bash
npm run dev
```

- Website: http://localhost:8787  
- Admin: http://localhost:8787/admin/

## Production secrets (Cloudflare Worker)
When deploying later:

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm run deploy
```

## Notes
- `/admin` is hidden (not in public nav)
- Publicaciones sorts newest → oldest and shows date added
- Existing PDFs are seeded with today’s date; new uploads get the real upload date
