const SESSION_COOKIE = "ifis_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 1000 * 60 * 15;
const CSRF_TTL_MS = 1000 * 60 * 60 * 8;
const BUCKET = "publications";

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

function getConfig(env) {
  const password = env.ADMIN_PASSWORD;
  const sessionSecret = env.SESSION_SECRET || env.ADMIN_PASSWORD;
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!password || !sessionSecret) throw new Error("Missing ADMIN_PASSWORD or SESSION_SECRET");
  if (!supabaseUrl || !supabaseKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return { password, sessionSecret, supabaseUrl, supabaseKey };
}

function publicFileUrl(supabaseUrl, path) {
  if (!path) return "/media/pdf-placeholder.svg";
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function supabaseRest(env, path, { method = "GET", body, headers = {}, rawBody } = {}) {
  const { supabaseUrl, supabaseKey } = getConfig(env);
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      ...headers,
    },
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      (data && (data.message || data.error || data.error_description)) ||
      `Supabase error (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
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
  const rows = await supabaseRest(
    env,
    `/rest/v1/login_attempts?ip=eq.${encodeURIComponent(ip)}&select=fail_count,window_start,locked_until`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: true };
  if (row.locked_until && row.locked_until > now) {
    return { ok: false, retryAfter: row.locked_until };
  }
  return { ok: true, row };
}

async function registerLoginFailure(env, ip) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const rows = await supabaseRest(
    env,
    `/rest/v1/login_attempts?ip=eq.${encodeURIComponent(ip)}&select=fail_count,window_start`
  );
  const row = Array.isArray(rows) ? rows[0] : null;

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

  await supabaseRest(env, "/rest/v1/login_attempts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: {
      ip,
      fail_count: failCount,
      window_start: windowStart,
      locked_until: lockedUntil,
    },
  });
}

async function clearLoginFailures(env, ip) {
  await supabaseRest(env, `/rest/v1/login_attempts?ip=eq.${encodeURIComponent(ip)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function issueCsrf(env, sessionId) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CSRF_TTL_MS).toISOString();
  await supabaseRest(env, "/rest/v1/csrf_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: { token, session_id: sessionId, expires_at: expiresAt },
  });
  return token;
}

async function consumeCsrf(env, sessionId, token) {
  if (!token) return false;
  const now = new Date().toISOString();
  const rows = await supabaseRest(
    env,
    `/rest/v1/csrf_tokens?token=eq.${encodeURIComponent(token)}&session_id=eq.${encodeURIComponent(sessionId)}&expires_at=gte.${encodeURIComponent(now)}&select=token`
  );
  if (!Array.isArray(rows) || !rows.length) return false;
  await supabaseRest(env, `/rest/v1/csrf_tokens?token=eq.${encodeURIComponent(token)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
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
  const { sessionSecret } = getConfig(env);
  const cookies = parseCookies(request.headers.get("cookie") || "");
  const session = await verifySessionToken(cookies[SESSION_COOKIE], sessionSecret);
  if (!session) return { ok: false, response: json({ error: "No autorizado" }, 401) };
  return { ok: true, session };
}

function mapPublication(row, supabaseUrl) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pdfUrl: publicFileUrl(supabaseUrl, row.pdf_path),
    thumbUrl: row.thumb_path
      ? publicFileUrl(supabaseUrl, row.thumb_path)
      : "/media/pdf-placeholder.svg",
    pdfFilename: row.pdf_filename,
  };
}

async function listPublications(env) {
  const { supabaseUrl } = getConfig(env);
  const rows = await supabaseRest(
    env,
    "/rest/v1/publications?select=id,title,description,created_at,updated_at,pdf_path,thumb_path,pdf_filename&order=created_at.desc,title.asc"
  );
  return (rows || []).map((row) => mapPublication(row, supabaseUrl));
}

async function uploadToStorage(env, path, file, contentType) {
  const bytes = await file.arrayBuffer();
  await supabaseRest(env, `/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      "content-type": contentType || file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    rawBody: bytes,
  });
}

async function deleteFromStorage(env, path) {
  if (!path) return;
  await supabaseRest(env, `/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: { prefixes: [path] },
  }).catch(async () => {
    // fallback API shape
    await supabaseRest(env, `/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: [path],
    });
  });
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
  const { password: expected, sessionSecret } = getConfig(env);
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
  const pdfPath = `pdfs/${id}/${pdfName}`;
  await uploadToStorage(env, pdfPath, pdf, "application/pdf");

  let thumbPath = null;
  if (thumb && typeof thumb !== "string" && thumb.size) {
    const thumbName = safeFilename(thumb.name || `${id}-thumb.png`);
    thumbPath = `thumbs/${id}/${thumbName}`;
    await uploadToStorage(env, thumbPath, thumb, thumb.type || "image/png");
  }

  await supabaseRest(env, "/rest/v1/publications", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: {
      id,
      title,
      description,
      created_at: now,
      updated_at: now,
      pdf_path: pdfPath,
      thumb_path: thumbPath,
      pdf_filename: pdfName,
    },
  });

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

  const rows = await supabaseRest(
    env,
    `/rest/v1/publications?id=eq.${encodeURIComponent(id)}&select=id`
  );
  if (!Array.isArray(rows) || !rows.length) return badRequest("Publicación no encontrada", 404);

  await supabaseRest(env, `/rest/v1/publications?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: {
      title,
      description,
      updated_at: new Date().toISOString(),
    },
  });

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

  const rows = await supabaseRest(
    env,
    `/rest/v1/publications?id=eq.${encodeURIComponent(id)}&select=pdf_path,thumb_path`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return badRequest("Publicación no encontrada", 404);

  await supabaseRest(env, `/rest/v1/publications?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });

  await deleteFromStorage(env, row.pdf_path);
  if (row.thumb_path) await deleteFromStorage(env, row.thumb_path);

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
      return json({ error: error.message || "Error interno del servidor" }, error.status || 500);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Assets binding missing", { status: 500 });
  },
};
