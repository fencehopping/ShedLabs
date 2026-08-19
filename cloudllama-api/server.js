const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");

const SOUNDCLOUD_API = "https://api.soundcloud.com";
const SOUNDCLOUD_AUTH = "https://secure.soundcloud.com";
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEDIA_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;

function loadEnv(filePath = path.join(__dirname, ".env")) {
  if (!fs.existsSync(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const renderExternalUrl = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

const config = {
  clientId: process.env.SOUNDCLOUD_CLIENT_ID || "",
  clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET || "",
  redirectUri: process.env.SOUNDCLOUD_REDIRECT_URI || (renderExternalUrl
    ? `${renderExternalUrl}/auth/soundcloud/callback`
    : "http://127.0.0.1:8787/auth/soundcloud/callback"),
  host: process.env.CHROMEAMP_SERVER_HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  port: Number(process.env.CHROMEAMP_SERVER_PORT || process.env.PORT || 8787)
};

const oauthAttempts = new Map();
const oauthClaims = new Map();
const sessions = new Map();
const mediaTickets = new Map();

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function createPkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function configured() {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

function allowedOrigin(origin) {
  if (!origin) return "";
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
  return "";
}

function applyCors(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Vary", "Origin");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function callbackPage(res, payload, success) {
  const heading = escapeHtml(success ? "Connected to SoundCloud" : "SoundCloud connection failed");
  const detail = escapeHtml(success ? "You can close this window and return to Cloud Llama." : payload.message);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10101b;color:#00f534;font:16px/1.6 ui-monospace,monospace}
main{max-width:560px;margin:24px;padding:28px;border:3px outset #7c7d96;background:#303149;box-shadow:12px 14px 0 #0008}
h1{margin:0 0 12px;color:#d8c692;font-size:20px}p{margin:0;color:#d6d6df}
</style></head><body><main><h1>${heading}</h1><p>${detail}</p></main></body></html>`;
  res.writeHead(success ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  res.end(html);
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return match?.[1] || "";
}

function requireSession(req, res) {
  const id = bearerToken(req);
  const session = sessions.get(id);
  if (!id || !session || session.sessionExpiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    sendError(res, 401, "Cloud Llama session is missing or expired");
    return null;
  }
  session.lastSeenAt = Date.now();
  return { id, session };
}

async function tokenRequest(parameters) {
  const response = await fetch(`${SOUNDCLOUD_AUTH}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(parameters)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("SoundCloud rejected the OAuth token request");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function applyTokens(session, payload) {
  session.accessToken = payload.access_token;
  session.refreshToken = payload.refresh_token || session.refreshToken || "";
  session.tokenExpiresAt = Date.now() + Number(payload.expires_in || 3600) * 1000;
  session.scope = payload.scope || session.scope || "";
}

async function refreshSession(session) {
  if (!session.refreshToken) throw new Error("SoundCloud refresh token is unavailable");
  const payload = await tokenRequest({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: session.refreshToken
  });
  applyTokens(session, payload);
}

async function soundCloudFetch(session, url, options = {}, retry = true) {
  if (session.tokenExpiresAt - Date.now() <= REFRESH_EARLY_MS) await refreshSession(session);
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json; charset=utf-8");
  headers.set("Authorization", `OAuth ${session.accessToken}`);
  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 && retry && session.refreshToken) {
    await refreshSession(session);
    return soundCloudFetch(session, url, options, false);
  }
  return response;
}

function validateSoundCloudUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (parsed.hostname === "soundcloud.com" || parsed.hostname.endsWith(".soundcloud.com"));
  } catch {
    return false;
  }
}

function validateMediaUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (
      parsed.hostname === "sndcdn.com"
      || parsed.hostname.endsWith(".sndcdn.com")
      || parsed.hostname === "soundcloud.com"
      || parsed.hostname.endsWith(".soundcloud.com")
      || parsed.hostname === "soundcloud.cloud"
      || parsed.hostname.endsWith(".soundcloud.cloud")
    );
  } catch {
    return false;
  }
}

function mediaProxyPath(value, ticket) {
  return `/media/${ticket}?url=${encodeURIComponent(value)}`;
}

function mediaRequestHeaders(value, baseHeaders, accessToken) {
  const headers = new Headers(baseHeaders);
  if (validateSoundCloudUrl(value)) {
    headers.set("Authorization", `OAuth ${accessToken}`);
  } else {
    // Never forward the user's OAuth token to a media CDN, even after a redirect.
    headers.delete("Authorization");
  }
  return headers;
}

function rewriteHlsManifest(source, sourceUrl, ticket) {
  const rewriteUri = (value) => mediaProxyPath(new URL(value, sourceUrl).toString(), ticket);
  return source.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith("#")) return rewriteUri(trimmed);
    return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewriteUri(uri)}"`);
  }).join("\n");
}

async function fetchMedia(session, url, headers, redirects = 0, retryAuth = true) {
  if (!validateMediaUrl(url)) throw new Error("SoundCloud returned an invalid media URL");
  if (validateSoundCloudUrl(url) && session.tokenExpiresAt - Date.now() <= REFRESH_EARLY_MS) {
    await refreshSession(session);
  }
  const requestHeaders = mediaRequestHeaders(url, headers, session.accessToken);
  const response = await fetch(url, { headers: requestHeaders, redirect: "manual" });
  if (response.status === 401 && validateSoundCloudUrl(url) && retryAuth && session.refreshToken) {
    await refreshSession(session);
    return fetchMedia(session, url, headers, redirects, false);
  }
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    if (redirects >= 3) throw new Error("SoundCloud media redirected too many times");
    const nextUrl = new URL(response.headers.get("location"), url).toString();
    return fetchMedia(session, nextUrl, headers, redirects + 1, retryAuth);
  }
  return response;
}

async function proxyHlsMedia(req, res, target, ticketId, session) {
  if (!validateMediaUrl(target)) {
    sendError(res, 400, "Invalid SoundCloud media URL");
    return;
  }
  const headers = new Headers({ Accept: "*/*" });
  if (req.headers.range) headers.set("Range", req.headers.range);
  const response = await fetchMedia(session, target, headers);
  if (!response.ok) {
    sendError(res, response.status, `SoundCloud media returned ${response.status}`);
    return;
  }

  const contentType = response.headers.get("content-type") || "";
  const isManifest = contentType.includes("mpegurl") || /\.m3u8(?:$|\?)/i.test(response.url || target);
  if (isManifest) {
    const body = rewriteHlsManifest(await response.text(), response.url || target, ticketId);
    res.writeHead(200, {
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store"
    });
    res.end(body);
    return;
  }

  const responseHeaders = {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": "private, max-age=300"
  };
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  res.writeHead(response.status, responseHeaders);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(res);
}

function validateCompleteRedirect(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && /^[a-p]{32}\.chromiumapp\.org$/.test(parsed.hostname)
      && parsed.pathname === "/soundcloud";
  } catch {
    return false;
  }
}

function completeOAuthRedirect(location, parameters) {
  const target = new URL(location);
  for (const [key, value] of Object.entries(parameters)) target.searchParams.set(key, value);
  return target.toString();
}

async function proxyJson(res, response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    sendError(res, response.status, fallbackMessage);
    return;
  }
  sendJson(res, 200, payload);
}

async function handleAuthStart(url, res) {
  if (!configured()) {
    sendError(res, 503, "SoundCloud credentials are not configured");
    return;
  }
  const completeRedirect = url.searchParams.get("complete_redirect") || "";
  if (!validateCompleteRedirect(completeRedirect)) {
    sendError(res, 400, "Cloud Llama OAuth requires a valid chromiumapp.org completion URL");
    return;
  }
  const state = randomToken(24);
  const verifier = randomToken(48);
  oauthAttempts.set(state, { verifier, completeRedirect, createdAt: Date.now() });
  const authorizeUrl = new URL(`${SOUNDCLOUD_AUTH}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    code_challenge: createPkceChallenge(verifier),
    code_challenge_method: "S256",
    state
  }).toString();
  redirect(res, authorizeUrl.toString());
}

async function handleAuthCallback(url, res) {
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const oauthError = url.searchParams.get("error");
  const attempt = oauthAttempts.get(state);
  oauthAttempts.delete(state);

  if (oauthError) {
    if (attempt?.completeRedirect) {
      redirect(res, completeOAuthRedirect(attempt.completeRedirect, { error: "SoundCloud authorization was cancelled" }));
    } else {
      callbackPage(res, { message: "SoundCloud authorization was cancelled" }, false);
    }
    return;
  }
  if (!code || !attempt || Date.now() - attempt.createdAt > OAUTH_ATTEMPT_TTL_MS) {
    callbackPage(res, { message: "The OAuth request expired or its state did not match" }, false);
    return;
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code_verifier: attempt.verifier,
      code
    });
    const session = {
      accessToken: "",
      refreshToken: "",
      tokenExpiresAt: 0,
      sessionExpiresAt: Date.now() + SESSION_TTL_MS,
      lastSeenAt: Date.now(),
      scope: "",
      profile: null
    };
    applyTokens(session, tokens);
    const profileResponse = await soundCloudFetch(session, `${SOUNDCLOUD_API}/me`);
    if (!profileResponse.ok) throw new Error("SoundCloud profile verification failed");
    session.profile = await profileResponse.json();
    const sessionId = randomToken(32);
    sessions.set(sessionId, session);
    const claimCode = randomToken(32);
    oauthClaims.set(claimCode, {
      sessionId,
      createdAt: Date.now(),
      profile: { id: session.profile.id, username: session.profile.username, permalink_url: session.profile.permalink_url }
    });
    redirect(res, completeOAuthRedirect(attempt.completeRedirect, { code: claimCode }));
  } catch (error) {
    redirect(res, completeOAuthRedirect(attempt.completeRedirect, { error: error.message }));
  }
}

async function handleLikes(session, res) {
  let nextUrl = `${SOUNDCLOUD_API}/me/likes/tracks?limit=200&linked_partitioning=true`;
  const collection = [];
  let page = 0;

  while (nextUrl && page < 5) {
    if (!validateSoundCloudUrl(nextUrl)) throw new Error("SoundCloud returned an invalid pagination URL");
    const response = await soundCloudFetch(session, nextUrl);
    if (!response.ok) {
      await proxyJson(res, response, "Could not load SoundCloud likes");
      return;
    }
    const payload = await response.json();
    collection.push(...(Array.isArray(payload) ? payload : payload.collection || []));
    nextUrl = Array.isArray(payload) ? "" : payload.next_href || "";
    page += 1;
  }
  sendJson(res, 200, { collection, next_href: nextUrl || null });
}

async function route(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, configured: configured(), redirectUri: config.redirectUri });
    return;
  }
  if (req.method === "GET" && url.pathname === "/auth/soundcloud/start") {
    await handleAuthStart(url, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/auth/soundcloud/callback") {
    await handleAuthCallback(url, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/auth/claim") {
    const code = url.searchParams.get("code") || "";
    const claim = oauthClaims.get(code);
    oauthClaims.delete(code);
    if (!claim || Date.now() - claim.createdAt > OAUTH_ATTEMPT_TTL_MS) {
      sendError(res, 400, "OAuth completion code is missing or expired");
      return;
    }
    sendJson(res, 200, { sessionId: claim.sessionId, profile: claim.profile });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    const ticketId = url.pathname.slice("/media/".length);
    const ticket = mediaTickets.get(ticketId);
    const session = ticket && sessions.get(ticket.sessionId);
    if (!ticket || Date.now() - ticket.createdAt > MEDIA_TICKET_TTL_MS || !session) {
      mediaTickets.delete(ticketId);
      sendError(res, 401, "Cloud Llama media ticket is missing or expired");
      return;
    }
    await proxyHlsMedia(req, res, url.searchParams.get("url") || "", ticketId, session);
    return;
  }

  const authenticated = requireSession(req, res);
  if (!authenticated) return;
  const { id, session } = authenticated;

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    sessions.delete(id);
    for (const [ticketId, ticket] of mediaTickets) {
      if (ticket.sessionId === id) mediaTickets.delete(ticketId);
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    const response = await soundCloudFetch(session, `${SOUNDCLOUD_API}/me`);
    await proxyJson(res, response, "Could not load the SoundCloud profile");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/likes") {
    await handleLikes(session, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/media-ticket") {
    const target = url.searchParams.get("url") || "";
    if (!validateMediaUrl(target)) {
      sendError(res, 400, "Invalid SoundCloud media URL");
      return;
    }
    const ticketId = randomToken(32);
    mediaTickets.set(ticketId, { sessionId: id, createdAt: Date.now() });
    sendJson(res, 200, { path: mediaProxyPath(target, ticketId) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/transcoding") {
    const target = url.searchParams.get("url") || "";
    if (!validateSoundCloudUrl(target)) {
      sendError(res, 400, "Invalid SoundCloud transcoding URL");
      return;
    }
    const response = await soundCloudFetch(session, target);
    await proxyJson(res, response, "Could not resolve the SoundCloud stream");
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/tracks/") && url.pathname.endsWith("/streams")) {
    const encodedId = url.pathname.slice("/api/tracks/".length, -"/streams".length);
    const trackId = decodeURIComponent(encodedId);
    if (!/^[\w:-]+$/.test(trackId)) {
      sendError(res, 400, "Invalid SoundCloud track identifier");
      return;
    }
    const response = await soundCloudFetch(session, `${SOUNDCLOUD_API}/tracks/${encodeURIComponent(trackId)}/streams`);
    await proxyJson(res, response, "Could not resolve the SoundCloud stream");
    return;
  }

  sendError(res, 404, "Not found");
}

function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (!res.headersSent) sendError(res, 500, error.message || "Internal server error");
      else res.end();
    });
  });
}

function cleanupExpiredState() {
  const now = Date.now();
  for (const [state, attempt] of oauthAttempts) {
    if (now - attempt.createdAt > OAUTH_ATTEMPT_TTL_MS) oauthAttempts.delete(state);
  }
  for (const [code, claim] of oauthClaims) {
    if (now - claim.createdAt > OAUTH_ATTEMPT_TTL_MS) oauthClaims.delete(code);
  }
  for (const [id, session] of sessions) {
    if (session.sessionExpiresAt <= now) sessions.delete(id);
  }
  for (const [id, ticket] of mediaTickets) {
    if (now - ticket.createdAt > MEDIA_TICKET_TTL_MS || !sessions.has(ticket.sessionId)) mediaTickets.delete(id);
  }
}

if (require.main === module) {
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`Cloud Llama OAuth server listening on http://${config.host}:${config.port}`);
    console.log(`SoundCloud redirect URI: ${config.redirectUri}`);
  });
  const cleanupTimer = setInterval(cleanupExpiredState, 60 * 1000);
  cleanupTimer.unref();
}

module.exports = {
  allowedOrigin,
  config,
  createPkceChallenge,
  createServer,
  mediaRequestHeaders,
  rewriteHlsManifest,
  validateCompleteRedirect,
  validateMediaUrl,
  validateSoundCloudUrl
};
