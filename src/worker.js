const SESSION_COOKIE = "ifis_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 1000 * 60 * 15;
const CSRF_TTL_MS = 1000 * 60 * 60 * 8;

const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function badRequest(message, status = 400) {
  return json({ error: message }, status);
}

function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function cookieHeader(name, value, { maxAge } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ];
  if (typeof maxAge === "number") parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getSecrets(env) {
  const password = env.ADMIN_PASSWORD;
  const sessionSecret = env.SESSION_SECRET || env.ADMIN_PASSWORD;
  if (!password || !sessionSecret) {
    throw new Error("Missing ADMIN_PASSWORD or SESSION_SECRET");
  }
  return { password, sessionSecret };
}

async function createSessionToken(sessionSecret) {
  const sessionId = crypto.randomUUID();
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${sessionId}.${exp}`;
  const sig = await hmacSign(sessionSecret, payload);
  return { token: `${payload}.${sig}`, sessionId, exp };
}

async function verifySessionToken(token, sessionSecret) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!sessionId || !sig || Number.isNaN(exp) || Date.now() > exp) return null;
  const expected = await hmacSign(sessionSecret, `${sessionId}.${exp}`);
  if (!timingSafeEqual(sig, expected)) return null;
  return { sessionId, exp };
}

function clientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function checkLoginAllowed(env, ip) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare("SELECT fail_count, window_start, locked_until FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first();
  if (!row) return { ok: true };
  if (row.locked_until && row.locked_until > now) {
    return { ok: false, retryAfter: row.locked_until };
  }
  return { ok: true, row };
}

async function registerLoginFailure(env, ip) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const row = await env.DB.prepare("SELECT fail_count, window_start, locked_until FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first();

  let failCount = 1;
  let windowStart = now;

  if (row) {
    const windowAge = nowMs - new Date(row.window_start).getTime();
    if (windowAge <= LOGIN_WINDOW_MS) {
      failCount = Number(row.fail_count || 0) + 1;
      windowStart = row.window_start;
    }
  }

  const lockedUntil =
    failCount >= LOGIN_MAX_FAILS ? new Date(nowMs + LOGIN_LOCK_MS).toISOString() : null;

  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, fail_count, window_start, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       fail_count = excluded.fail_count,
       window_start = excluded.window_start,
       locked_until = excluded.locked_until`
  )
    .bind(ip, failCount, windowStart, lockedUntil)
    .run();
}

async function clearLoginFailures(env, ip) {
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

async function issueCsrf(env, sessionId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CSRF_TTL_MS).toISOString();
  await env.DB.prepare(
    `INSERT INTO csrf_tokens (token, session_id, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET session_id = excluded.session_id, expires_at = excluded.expires_at`
  )
    .bind(token, sessionId, expiresAt)
    .run();
  return token;
}

async function consumeCsrf(env, sessionId, token) {
  if (!token) return false;
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    "SELECT token FROM csrf_tokens WHERE token = ? AND session_id = ? AND expires_at >= ?"
  )
    .bind(token, sessionId, now)
    .first();
  if (!row) return false;
  await env.DB.prepare("DELETE FROM csrf_tokens WHERE token = ?").bind(token).run();
  return true;
}

function sanitizeText(value, max = 500) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeFilename(name) {
  return String(name || "document.pdf")
    .replace(/[^\w.\- ()áéíóúÁÉÍÓÚñÑ]+/g, "_")
    .slice(0, 180);
}

async function requireAdmin(request, env) {
  const { sessionSecret } = getSecrets(env);
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const session = await verifySessionToken(cookies[SESSION_COOKIE], sessionSecret);
  if (!session) return { ok: false, response: json({ error: "No autorizado" }, 401) };
  return { ok: true, session };
}

async function listPublications(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, description, created_at, updated_at, pdf_key, thumb_key, pdf_filename
     FROM publications
     ORDER BY created_at DESC, title ASC`
  ).all();
  return (results || []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pdfUrl: `/api/files/${encodeURIComponent(row.pdf_key)}`,
    thumbUrl: row.thumb_key
      ? `/api/files/${encodeURIComponent(row.thumb_key)}`
      : "/media/pdf-placeholder.svg",
    pdfFilename: row.pdf_filename,
  }));
}

async function handleFile(request, env, key) {
  if (!key) return badRequest("Archivo no encontrado", 404);
  const object = await env.DOCS.get(key);
  if (!object) return badRequest("Archivo no encontrado", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  if (!headers.has("content-type")) {
    headers.set("content-type", key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  }
  if (key.endsWith(".pdf")) {
    headers.set("content-disposition", `inline; filename="${safeFilename(key.split("/").pop())}"`);
  }
  return new Response(object.body, { headers });
}

async function handleLogin(request, env) {
  const ip = clientIp(request);
  const allowed = await checkLoginAllowed(env, ip);
  if (!allowed.ok) {
    return json({ error: "Demasiados intentos. Intente más tarde." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Solicitud inválida");
  }

  const password = String(body.password || "");
  const { password: expected, sessionSecret } = getSecrets(env);
  const [gotHash, expectedHash] = await Promise.all([sha256Hex(password), sha256Hex(expected)]);

  if (!timingSafeEqual(gotHash, expectedHash)) {
    await registerLoginFailure(env, ip);
    return json({ error: "Contraseña incorrecta" }, 401);
  }

  await clearLoginFailures(env, ip);
  const session = await createSessionToken(sessionSecret);
  const csrf = await issueCsrf(env, session.sessionId);

  return json(
    { ok: true, csrf },
    200,
    {
      "set-cookie": cookieHeader(SESSION_COOKIE, session.token, {
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      }),
    }
  );
}

async function handleLogout() {
  return json({ ok: true }, 200, { "set-cookie": clearCookie(SESSION_COOKIE) });
}

async function handleSession(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;
  const csrf = await issueCsrf(env, auth.session.sessionId);
  return json({ ok: true, csrf });
}

async function handleCreate(request, env) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const csrf = String(form.get("csrf") || "");
  if (!(await consumeCsrf(env, auth.session.sessionId, csrf))) {
    return json({ error: "Token CSRF inválido" }, 403);
  }

  const title = sanitizeText(form.get("title"), 200);
  const description = sanitizeText(form.get("description"), 800);
  const pdf = form.get("pdf");
  const thumb = form.get("thumb");

  if (!title) return badRequest("El título es obligatorio");
  if (!pdf || typeof pdf === "string" || !pdf.size) return badRequest("Debe adjuntar un PDF");
  if (pdf.type && pdf.type !== "application/pdf") return badRequest("El archivo debe ser PDF");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const pdfName = safeFilename(pdf.name || `${id}.pdf`);
  const pdfKey = `pdfs/${id}/${pdfName}`;
  await env.DOCS.put(pdfKey, pdf.stream(), {
    httpMetadata: { contentType: "application/pdf" },
  });

  let thumbKey = null;
  if (thumb && typeof thumb !== "string" && thumb.size) {
    const thumbName = safeFilename(thumb.name || `${id}-thumb.png`);
    thumbKey = `thumbs/${id}/${thumbName}`;
    await env.DOCS.put(thumbKey, thumb.stream(), {
      httpMetadata: { contentType: thumb.type || "image/png" },
    });
  }

  await env.DB.prepare(
    `INSERT INTO publications
      (id, title, description, created_at, updated_at, pdf_key, thumb_key, pdf_filename)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, title, description, now, now, pdfKey, thumbKey, pdfName)
    .run();

  const csrfNext = await issueCsrf(env, auth.session.sessionId);
  return json({ ok: true, id, csrf: csrfNext });
}

async function handleUpdate(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Solicitud inválida");
  }

  if (!(await consumeCsrf(env, auth.session.sessionId, body.csrf))) {
    return json({ error: "Token CSRF inválido" }, 403);
  }

  const title = sanitizeText(body.title, 200);
  const description = sanitizeText(body.description, 800);
  if (!title) return badRequest("El título es obligatorio");

  const existing = await env.DB.prepare("SELECT id FROM publications WHERE id = ?").bind(id).first();
  if (!existing) return badRequest("Publicación no encontrada", 404);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE publications
     SET title = ?, description = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(title, description, now, id)
    .run();

  const csrfNext = await issueCsrf(env, auth.session.sessionId);
  return json({ ok: true, csrf: csrfNext });
}

async function handleDelete(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth.response;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (!(await consumeCsrf(env, auth.session.sessionId, body.csrf))) {
    return json({ error: "Token CSRF inválido" }, 403);
  }

  const row = await env.DB.prepare(
    "SELECT pdf_key, thumb_key FROM publications WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!row) return badRequest("Publicación no encontrada", 404);

  await env.DB.prepare("DELETE FROM publications WHERE id = ?").bind(id).run();
  const deletes = [env.DOCS.delete(row.pdf_key)];
  if (row.thumb_key) deletes.push(env.DOCS.delete(row.thumb_key));
  await Promise.all(deletes);

  const csrfNext = await issueCsrf(env, auth.session.sessionId);
  return json({ ok: true, csrf: csrfNext });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (pathname === "/api/publications" && method === "GET") {
    const items = await listPublications(env);
    return json({ items });
  }

  if (pathname.startsWith("/api/files/")) {
    const key = decodeURIComponent(pathname.slice("/api/files/".length));
    return handleFile(request, env, key);
  }

  if (pathname === "/api/admin/login" && method === "POST") {
    return handleLogin(request, env);
  }

  if (pathname === "/api/admin/logout" && method === "POST") {
    return handleLogout();
  }

  if (pathname === "/api/admin/session" && method === "GET") {
    return handleSession(request, env);
  }

  if (pathname === "/api/admin/publications" && method === "GET") {
    const auth = await requireAdmin(request, env);
    if (!auth.ok) return auth.response;
    const items = await listPublications(env);
    const csrf = await issueCsrf(env, auth.session.sessionId);
    return json({ items, csrf });
  }

  if (pathname === "/api/admin/publications" && method === "POST") {
    return handleCreate(request, env);
  }

  const updateMatch = pathname.match(/^\/api\/admin\/publications\/([^/]+)$/);
  if (updateMatch && method === "PATCH") {
    return handleUpdate(request, env, decodeURIComponent(updateMatch[1]));
  }
  if (updateMatch && method === "DELETE") {
    return handleDelete(request, env, decodeURIComponent(updateMatch[1]));
  }

  return badRequest("Ruta no encontrada", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env);
      }
    } catch (error) {
      console.error(error);
      return json({ error: "Error interno del servidor" }, 500);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Assets binding missing", { status: 500 });
  },
};
