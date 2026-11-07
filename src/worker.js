const JSON_HEADERS = { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[4-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

    try {
      if (request.method === "POST" && url.pathname === "/api/submissions") return await createSubmission(request, env);
      if (request.method === "POST" && url.pathname === "/api/admin/login") return await login(request, env);
      if (request.method === "POST" && url.pathname === "/api/admin/logout") return logout();
      if (!(await isAdmin(request, env))) return json({ error: "Authentication required." }, 401);
      if (request.method === "GET" && url.pathname === "/api/admin/records") return await records(url, env);
      if (request.method === "GET" && url.pathname === "/api/admin/export") return await exportRecords(url, env);
      if (request.method === "DELETE" && /^\/api\/admin\/records\/\d+$/.test(url.pathname)) return await deleteRecord(url, env);
      if (request.method === "DELETE" && url.pathname === "/api/admin/records") return await clearRecords(env);
      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "The server could not complete this request." }, 500);
    }
  }
};

async function createSubmission(request, env) {
  const body = await readJson(request);
  if (!body || body.consent !== true || typeof body.browserUuid !== "string" || !UUID_RE.test(body.browserUuid)) {
    return json({ error: "A valid browser UUID and explicit consent are required." }, 400);
  }
  const status = ["granted", "denied", "unavailable", "timeout", "skipped"].includes(body.locationStatus) ? body.locationStatus : "skipped";
  const latitude = validCoordinate(body.latitude, -90, 90);
  const longitude = validCoordinate(body.longitude, -180, 180);
  if (status === "granted" && (latitude === null || longitude === null)) return json({ error: "Location coordinates are invalid." }, 400);
  if (status !== "granted" && (body.latitude !== null && body.latitude !== undefined || body.longitude !== null && body.longitude !== undefined)) return json({ error: "Coordinates require granted location permission." }, 400);

  const now = new Date().toISOString();
  const ip = clientIp(request);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO research_profiles (browser_uuid, first_seen_at) VALUES (?, ?)").bind(body.browserUuid, now),
    env.DB.prepare("INSERT INTO research_submissions (browser_uuid, latitude, longitude, location_status, ip_address, consent_status, submitted_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
      .bind(body.browserUuid, latitude, longitude, status, ip, now)
  ]);
  return json({ ok: true });
}

async function login(request, env) {
  const body = await readJson(request);
  const password = typeof body?.password === "string" ? body.password : "";
  const hostname = new URL(request.url).hostname;
  const localDevelopmentHost = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const configured = env.ADMIN_PASSWORD || (localDevelopmentHost ? "1256" : "");
  if (!configured || !timingSafeEqual(password, configured)) return json({ error: "Invalid password." }, 401);
  if (!env.SESSION_SECRET) return json({ error: "SESSION_SECRET is required." }, 500);
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const token = await signSession(String(expires), env.SESSION_SECRET);
  return json({ ok: true }, 200, { "set-cookie": `research_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` });
}

function logout() { return json({ ok: true }, 200, { "set-cookie": "research_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" }); }

async function records(url, env) {
  const date = url.searchParams.get("date") || "";
  const search = (url.searchParams.get("search") || "").trim().slice(0, 100);
  const where = [], binds = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) { where.push("substr(s.submitted_at, 1, 10) = ?"); binds.push(date); }
  if (search) { where.push("(s.browser_uuid LIKE ? OR s.ip_address LIKE ?)"); binds.push(`%${search}%`, `%${search}%`); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const list = await env.DB.prepare(`SELECT s.*, p.first_seen_at, (SELECT COUNT(*) FROM research_submissions x WHERE x.browser_uuid = s.browser_uuid) AS visit_count FROM research_submissions s JOIN research_profiles p ON p.browser_uuid = s.browser_uuid ${clause} ORDER BY s.submitted_at DESC`).bind(...binds).all();
  const totals = await env.DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT browser_uuid) AS uniqueBrowsers FROM research_submissions").first();
  return json({ records: list.results, totals });
}

async function deleteRecord(url, env) {
  const id = Number(url.pathname.split("/").pop());
  if (!Number.isSafeInteger(id)) return json({ error: "Invalid record." }, 400);
  await env.DB.prepare("DELETE FROM research_submissions WHERE id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM research_profiles WHERE browser_uuid NOT IN (SELECT DISTINCT browser_uuid FROM research_submissions)").run();
  return json({ ok: true });
}

async function clearRecords(env) {
  await env.DB.batch([env.DB.prepare("DELETE FROM research_submissions"), env.DB.prepare("DELETE FROM research_profiles")]);
  return json({ ok: true });
}

async function exportRecords(url, env) {
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const result = await env.DB.prepare("SELECT s.*, p.first_seen_at FROM research_submissions s JOIN research_profiles p ON p.browser_uuid = s.browser_uuid ORDER BY s.submitted_at DESC").all();
  if (format === "json") return new Response(JSON.stringify(result.results, null, 2), { headers: { "content-type": "application/json; charset=UTF-8", "content-disposition": "attachment; filename=research-records.json", "cache-control": "no-store" } });
  const headings = ["id", "browser_uuid", "latitude", "longitude", "location_status", "ip_address", "consent_status", "first_seen_at", "submitted_at"];
  const csv = [headings.join(","), ...result.results.map(row => headings.map(key => csvCell(row[key])).join(","))].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=UTF-8", "content-disposition": "attachment; filename=research-records.csv", "cache-control": "no-store" } });
}

async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const token = cookie(request.headers.get("cookie"), "research_admin");
  if (!token) return false;
  const [expires, signature] = token.split(".");
  return /^\d+$/.test(expires) && Number(expires) > Date.now() && signature && timingSafeEqual(signature, await hmac(expires, env.SESSION_SECRET));
}

async function signSession(expires, secret) { return `${expires}.${await hmac(expires, secret)}`; }
async function hmac(value, secret) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))); return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function timingSafeEqual(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function validCoordinate(value, min, max) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null; }
function clientIp(request) { const value = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || null; return value && value.length <= 64 ? value : null; }
function cookie(header, name) { return header?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1); }
async function readJson(request) { try { return await request.json(); } catch { return null; } }
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } }); }
function csvCell(value) { const valueText = value === null || value === undefined ? "" : String(value); return /[",\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText; }
