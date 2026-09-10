const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { Readable } = require("node:stream");

const SOUNDCLOUD_API = "https://api.soundcloud.com";
const SOUNDCLOUD_AUTH = "https://secure.soundcloud.com";
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MEDIA_TICKET_TTL_MS = 2 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;
const SESSION_TOKEN_VERSION = "v1";
const SESSION_TOKEN_CONTEXT = "cloud-llama-session-v1";
const STATION_EPOCH_MS = Date.UTC(2026, 0, 1);
const STATION_FALLBACK_CACHE_MS = 5 * 60 * 1000;

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
  djProfileUrl: process.env.CLOUD_LLAMA_DJ_PROFILE_URL || "https://soundcloud.com/jgilla-1",
  stationFallbackUrl: process.env.CLOUD_LLAMA_STATION_FALLBACK_URL || "https://soundcloud.com/thesoundoftrees/likes",
  host: process.env.CHROMEAMP_SERVER_HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  port: Number(process.env.CHROMEAMP_SERVER_PORT || process.env.PORT || 8787)
};

const oauthAttempts = new Map();
const oauthClaims = new Map();
const mediaTickets = new Map();
let applicationSession = null;
let applicationSessionRefresh = null;
const station = {
  fallbackTracks: [],
  fallbackLoad: null,
  fallbackLoadedAt: 0,
  liveTrack: null,
  liveStartedAt: 0,
  liveDj: null,
  revision: 0
};

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sessionEncryptionKey() {
  if (!config.clientSecret) throw new Error("SoundCloud credentials are not configured");
  return crypto.createHash("sha256").update(`${SESSION_TOKEN_CONTEXT}\0${config.clientSecret}`).digest();
}

function sealSession(session) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(SESSION_TOKEN_CONTEXT));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [SESSION_TOKEN_VERSION, iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

function openSession(token) {
  try {
    const [version, encodedIv, encodedPayload, encodedTag, extra] = String(token || "").split(".");
    if (version !== SESSION_TOKEN_VERSION || !encodedIv || !encodedPayload || !encodedTag || extra) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionEncryptionKey(), Buffer.from(encodedIv, "base64url"));
    decipher.setAAD(Buffer.from(SESSION_TOKEN_CONTEXT));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const payload = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final()
    ]).toString("utf8");
    const session = JSON.parse(payload);
    if (!session || typeof session.accessToken !== "string" || typeof session.tokenExpiresAt !== "number"
      || typeof session.sessionExpiresAt !== "number" || session.sessionExpiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
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
  res.setHeader("Access-Control-Expose-Headers", "X-Cloud-Llama-Session");
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
  const session = openSession(id);
  if (!id || !session) {
    sendError(res, 401, "Cloud Llama session is missing or expired");
    return null;
  }
  session.lastSeenAt = Date.now();
  session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  return { session };
}

function attachUpdatedSession(res, session) {
  if (session?.application) return;
  res.setHeader("X-Cloud-Llama-Session", sealSession(session));
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

async function clientCredentialsTokenRequest() {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${SOUNDCLOUD_AUTH}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const error = new Error("SoundCloud rejected the public radio connection");
    error.status = response.status || 503;
    throw error;
  }
  return payload;
}

async function getApplicationSession(forceRefresh = false) {
  const reusable = applicationSession
    && applicationSession.tokenExpiresAt - Date.now() > REFRESH_EARLY_MS;
  if (reusable && !forceRefresh) return applicationSession;
  if (applicationSessionRefresh) return applicationSessionRefresh;

  applicationSessionRefresh = (async () => {
    let payload;
    if (applicationSession?.refreshToken) {
      try {
        payload = await tokenRequest({
          grant_type: "refresh_token",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: applicationSession.refreshToken
        });
      } catch {
        payload = await clientCredentialsTokenRequest();
      }
    } else {
      payload = await clientCredentialsTokenRequest();
    }
    if (!applicationSession) {
      applicationSession = {
        application: true,
        sessionId: "cloud-llama-public-radio",
        accessToken: "",
        refreshToken: "",
        tokenExpiresAt: 0,
        sessionExpiresAt: Number.MAX_SAFE_INTEGER,
        lastSeenAt: Date.now(),
        scope: "",
        profile: null
      };
    }
    applyTokens(applicationSession, payload);
    applicationSession.lastSeenAt = Date.now();
    return applicationSession;
  })().finally(() => {
    applicationSessionRefresh = null;
  });
  return applicationSessionRefresh;
}

async function refreshSession(session) {
  if (session.application) {
    await getApplicationSession(true);
    return;
  }
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

function canonicalSoundCloudUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || (parsed.hostname !== "soundcloud.com" && !parsed.hostname.endsWith(".soundcloud.com"))) return "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `https://soundcloud.com${pathname}`.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeStationTrack(raw) {
  const track = raw?.track || raw || {};
  const id = String(track.urn || track.id || "");
  if (!id) return null;
  return {
    ...track,
    id,
    artist: track.metadata_artist || track.publisher_metadata?.artist || track.user?.username || "Unknown artist",
    title: track.title || "Untitled",
    duration: Math.max(0, Number(track.duration || track.full_duration || 0)),
    permalink_url: track.permalink_url || "https://soundcloud.com",
    access: track.access || (track.streamable === false ? "blocked" : "playable")
  };
}

async function readJsonBody(req, limit = 16_384) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

async function soundCloudJson(session, url, fallbackMessage) {
  const response = await soundCloudFetch(session, url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.errors?.[0]?.error_message || payload.error || fallbackMessage);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function fetchSoundCloudCollection(session, firstUrl) {
  const collection = [];
  let nextUrl = firstUrl;
  let page = 0;
  while (nextUrl && page < 5) {
    if (!validateSoundCloudUrl(nextUrl)) throw new Error("SoundCloud returned an invalid pagination URL");
    const payload = await soundCloudJson(session, nextUrl, "Could not load the SoundCloud collection");
    collection.push(...(Array.isArray(payload) ? payload : payload.collection || []));
    nextUrl = Array.isArray(payload) ? "" : payload.next_href || "";
    page += 1;
  }
  return collection;
}

async function resolveSoundCloudResource(session, resourceUrl) {
  const canonicalUrl = canonicalSoundCloudUrl(resourceUrl);
  if (!canonicalUrl) {
    const error = new Error("A valid SoundCloud URL is required");
    error.status = 400;
    throw error;
  }
  // SoundCloud's resolver expects the owning profile for a public /likes page.
  // The collection itself is fetched explicitly from /users/{id}/likes/tracks.
  const resolvableUrl = canonicalUrl.replace(/\/likes$/, "");
  return soundCloudJson(
    session,
    `${SOUNDCLOUD_API}/resolve?url=${encodeURIComponent(resolvableUrl)}`,
    "Could not resolve the SoundCloud URL"
  );
}

async function loadStationFallback(session) {
  if (station.fallbackTracks.length && Date.now() - station.fallbackLoadedAt < STATION_FALLBACK_CACHE_MS) {
    return station.fallbackTracks;
  }
  if (!station.fallbackLoad) {
    station.fallbackLoad = (async () => {
      const resource = await resolveSoundCloudResource(session, config.stationFallbackUrl);
      const identifier = encodeURIComponent(resource.urn || resource.id || "");
      let rawTracks;
      if (resource.kind === "playlist" || resource.kind === "system-playlist") {
        rawTracks = await fetchSoundCloudCollection(
          session,
          `${SOUNDCLOUD_API}/playlists/${identifier}/tracks?limit=200&linked_partitioning=true`
        );
      } else if (resource.kind === "user") {
        rawTracks = await fetchSoundCloudCollection(
          session,
          `${SOUNDCLOUD_API}/users/${identifier}/likes/tracks?access=playable&limit=200&linked_partitioning=true`
        );
        if (!rawTracks.length) {
          rawTracks = await fetchSoundCloudCollection(
            session,
            `${SOUNDCLOUD_API}/users/${identifier}/tracks?access=playable&limit=200&linked_partitioning=true`
          );
        }
      } else {
        rawTracks = [resource];
      }
      const tracks = rawTracks
        .map(normalizeStationTrack)
        .filter((track) => track && track.access !== "blocked" && track.duration > 0);
      if (!tracks.length) throw new Error("The default SoundCloud source has no playable public tracks");
      station.fallbackTracks = tracks;
      station.fallbackLoadedAt = Date.now();
      station.revision += 1;
      return tracks;
    })().finally(() => {
      station.fallbackLoad = null;
    });
  }
  return station.fallbackLoad;
}

function automaticStationPosition(tracks, now = Date.now()) {
  const durations = tracks.map((track) => Math.max(1, Number(track.duration) || 0));
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  if (!tracks.length || !totalDuration) return { index: -1, positionMs: 0 };
  let cursor = ((now - STATION_EPOCH_MS) % totalDuration + totalDuration) % totalDuration;
  for (let index = 0; index < tracks.length; index += 1) {
    if (cursor < durations[index]) return { index, positionMs: cursor };
    cursor -= durations[index];
  }
  return { index: 0, positionMs: 0 };
}

function isStationDj(session) {
  return canonicalSoundCloudUrl(session?.profile?.permalink_url) === canonicalSoundCloudUrl(config.djProfileUrl);
}

async function stationSnapshot(session, now = Date.now()) {
  const fallbackTracks = await loadStationFallback(session);
  const liveElapsed = Math.max(0, now - station.liveStartedAt);
  const liveActive = Boolean(station.liveTrack) && liveElapsed < Math.max(1, station.liveTrack.duration);
  if (!liveActive && station.liveTrack) {
    station.liveTrack = null;
    station.liveStartedAt = 0;
    station.liveDj = null;
    station.revision += 1;
  }
  const automatic = automaticStationPosition(fallbackTracks, now);
  const currentTrack = liveActive ? station.liveTrack : fallbackTracks[automatic.index] || null;
  const tracks = liveActive && !fallbackTracks.some((track) => track.id === station.liveTrack.id)
    ? [station.liveTrack, ...fallbackTracks]
    : fallbackTracks;
  return {
    configured: Boolean(config.stationFallbackUrl),
    canDj: isStationDj(session),
    mode: liveActive ? "live" : "automatic",
    dj: liveActive ? station.liveDj : null,
    fallbackUrl: config.stationFallbackUrl,
    currentTrackId: currentTrack?.id || "",
    positionMs: liveActive ? liveElapsed : automatic.positionMs,
    serverTimeMs: now,
    revision: station.revision,
    tracks
  };
}

async function controlStation(req, res, session) {
  if (!isStationDj(session)) {
    sendError(res, 403, "This SoundCloud account is not authorized to DJ the station");
    return;
  }
  const body = await readJsonBody(req);
  if (body.action === "end") {
    station.liveTrack = null;
    station.liveStartedAt = 0;
    station.liveDj = null;
    station.revision += 1;
  } else if (body.action === "play") {
    const resource = await resolveSoundCloudResource(session, body.trackUrl || "");
    const track = normalizeStationTrack(resource);
    if (!track || resource.kind !== "track") {
      sendError(res, 400, "Choose a SoundCloud track, not a profile or playlist");
      return;
    }
    if (track.access === "blocked" || !track.duration) {
      sendError(res, 400, "That track is unavailable for off-platform playback");
      return;
    }
    station.liveTrack = track;
    station.liveStartedAt = Date.now();
    station.liveDj = {
      username: session.profile?.username || "JGilla",
      permalink_url: session.profile?.permalink_url || config.djProfileUrl
    };
    station.revision += 1;
  } else {
    sendError(res, 400, "Unknown station action");
    return;
  }
  attachUpdatedSession(res, session);
  sendJson(res, 200, await stationSnapshot(session));
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

async function proxyJson(res, response, fallbackMessage, session) {
  const payload = await response.json().catch(() => ({}));
  if (session) attachUpdatedSession(res, session);
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
      sessionId: randomToken(16),
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
    const profile = await profileResponse.json();
    session.profile = { id: profile.id, username: profile.username, permalink_url: profile.permalink_url };
    const sessionId = sealSession(session);
    const claimCode = randomToken(32);
    oauthClaims.set(claimCode, {
      sessionId,
      createdAt: Date.now(),
      profile: session.profile
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
      await proxyJson(res, response, "Could not load SoundCloud likes", session);
      return;
    }
    const payload = await response.json();
    collection.push(...(Array.isArray(payload) ? payload : payload.collection || []));
    nextUrl = Array.isArray(payload) ? "" : payload.next_href || "";
    page += 1;
  }
  attachUpdatedSession(res, session);
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
    const session = ticket?.session;
    if (!ticket || Date.now() - ticket.createdAt > MEDIA_TICKET_TTL_MS || !session) {
      mediaTickets.delete(ticketId);
      sendError(res, 401, "Cloud Llama media ticket is missing or expired");
      return;
    }
    await proxyHlsMedia(req, res, url.searchParams.get("url") || "", ticketId, session);
    return;
  }

  const publicPlaybackRoute = req.method === "GET" && (
    url.pathname === "/api/station"
    || url.pathname === "/api/media-ticket"
    || url.pathname === "/api/transcoding"
    || (url.pathname.startsWith("/api/tracks/") && url.pathname.endsWith("/streams"))
  );
  const listenerSession = openSession(bearerToken(req));
  let session = listenerSession;
  if (session) {
    session.lastSeenAt = Date.now();
    session.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  } else if (publicPlaybackRoute) {
    session = await getApplicationSession();
  } else {
    sendError(res, 401, "Cloud Llama session is missing or expired");
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    for (const [ticketId, ticket] of mediaTickets) {
      if (ticket.sessionId === session.sessionId) mediaTickets.delete(ticketId);
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/me") {
    const response = await soundCloudFetch(session, `${SOUNDCLOUD_API}/me`);
    await proxyJson(res, response, "Could not load the SoundCloud profile", session);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/likes") {
    await handleLikes(session, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/station") {
    const snapshot = await stationSnapshot(session);
    attachUpdatedSession(res, session);
    sendJson(res, 200, snapshot);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/station/dj") {
    await controlStation(req, res, session);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/media-ticket") {
    const target = url.searchParams.get("url") || "";
    if (!validateMediaUrl(target)) {
      sendError(res, 400, "Invalid SoundCloud media URL");
      return;
    }
    const ticketId = randomToken(32);
    mediaTickets.set(ticketId, { sessionId: session.sessionId, session, createdAt: Date.now() });
    attachUpdatedSession(res, session);
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
    await proxyJson(res, response, "Could not resolve the SoundCloud stream", session);
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
    await proxyJson(res, response, "Could not resolve the SoundCloud stream", session);
    return;
  }

  sendError(res, 404, "Not found");
}

function createServer() {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (!res.headersSent) sendError(res, Number(error.status) || 500, error.message || "Internal server error");
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
  for (const [id, ticket] of mediaTickets) {
    if (now - ticket.createdAt > MEDIA_TICKET_TTL_MS) mediaTickets.delete(id);
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
  automaticStationPosition,
  canonicalSoundCloudUrl,
  config,
  createPkceChallenge,
  createServer,
  mediaRequestHeaders,
  openSession,
  rewriteHlsManifest,
  sealSession,
  validateCompleteRedirect,
  validateMediaUrl,
  validateSoundCloudUrl
};
