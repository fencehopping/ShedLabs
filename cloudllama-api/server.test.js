const assert = require("node:assert/strict");
const test = require("node:test");

process.env.SOUNDCLOUD_CLIENT_ID ||= "test-client-id";
process.env.SOUNDCLOUD_CLIENT_SECRET ||= "test-client-secret";
process.env.SOUNDCLOUD_REDIRECT_URI ||= "http://127.0.0.1:8787/auth/soundcloud/callback";

const {
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
} = require("./server");

test("station URLs are canonicalized without query strings or trailing slashes", () => {
  assert.equal(canonicalSoundCloudUrl("https://soundcloud.com/JGilla-1/?utm_source=test"), "https://soundcloud.com/jgilla-1");
  assert.equal(canonicalSoundCloudUrl("https://soundcloud.com/TheSoundOfTrees/likes/"), "https://soundcloud.com/thesoundoftrees/likes");
  assert.equal(canonicalSoundCloudUrl("https://attacker.example/jgilla-1"), "");
});

test("automatic station rotation maps a shared clock to a track and position", () => {
  const epoch = Date.UTC(2026, 0, 1);
  const tracks = [{ duration: 1000 }, { duration: 2000 }];
  assert.deepEqual(automaticStationPosition(tracks, epoch), { index: 0, positionMs: 0 });
  assert.deepEqual(automaticStationPosition(tracks, epoch + 999), { index: 0, positionMs: 999 });
  assert.deepEqual(automaticStationPosition(tracks, epoch + 1000), { index: 1, positionMs: 0 });
  assert.deepEqual(automaticStationPosition(tracks, epoch + 3000), { index: 0, positionMs: 0 });
});

test("sealed sessions survive process-memory loss and reject tampering", () => {
  const session = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: Date.now() + 60_000,
    sessionExpiresAt: Date.now() + 86_400_000,
    lastSeenAt: Date.now(),
    scope: "non-expiring",
    profile: { id: 123, username: "listener" }
  };
  const token = sealSession(session);

  assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(openSession(token), session);

  const parts = token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.equal(openSession(parts.join(".")), null);
});

test("sealed sessions still enforce their expiry", () => {
  const token = sealSession({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: Date.now() + 60_000,
    sessionExpiresAt: Date.now() - 1,
    lastSeenAt: Date.now(),
    scope: "",
    profile: null
  });
  assert.equal(openSession(token), null);
});

test("PKCE challenge uses SHA-256 base64url encoding", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(createPkceChallenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("CORS only accepts the extension and loopback development origins", () => {
  assert.equal(allowedOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop"), "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  assert.equal(allowedOrigin("http://127.0.0.1:4173"), "http://127.0.0.1:4173");
  assert.equal(allowedOrigin("https://attacker.example"), "");
});

test("transcoding proxy only accepts HTTPS SoundCloud hosts", () => {
  assert.equal(validateSoundCloudUrl("https://api-v2.soundcloud.com/media/example"), true);
  assert.equal(validateSoundCloudUrl("http://api.soundcloud.com/media/example"), false);
  assert.equal(validateSoundCloudUrl("https://soundcloud.com.attacker.example/media"), false);
});

test("OAuth completion only accepts this extension's chromiumapp URL shape", () => {
  assert.equal(validateCompleteRedirect("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/soundcloud"), true);
  assert.equal(validateCompleteRedirect("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/other"), false);
  assert.equal(validateCompleteRedirect("https://attacker.example/soundcloud"), false);
});

test("HLS proxy only accepts SoundCloud media hosts", () => {
  assert.equal(validateMediaUrl("https://cf-hls-media.sndcdn.com/media/track.m3u8"), true);
  assert.equal(validateMediaUrl("https://api-v2.soundcloud.com/media/track"), true);
  assert.equal(validateMediaUrl("https://playback.media-streaming.soundcloud.cloud/track/aac_160k/playlist.m3u8"), true);
  assert.equal(validateMediaUrl("https://sndcdn.com.attacker.example/track.m3u8"), false);
  assert.equal(validateMediaUrl("https://soundcloud.cloud.attacker.example/track.m3u8"), false);
  assert.equal(validateMediaUrl("http://cf-hls-media.sndcdn.com/media/track.m3u8"), false);
});

test("media proxy authenticates only SoundCloud API hops", () => {
  const apiHeaders = mediaRequestHeaders("https://api.soundcloud.com/tracks/example/streams/id/hls", { Accept: "*/*" }, "test-token");
  assert.equal(apiHeaders.get("Authorization"), "OAuth test-token");

  const cdnHeaders = mediaRequestHeaders("https://playback.media-streaming.soundcloud.cloud/example/playlist.m3u8", { Authorization: "OAuth should-not-leak" }, "test-token");
  assert.equal(cdnHeaders.has("Authorization"), false);

  const legacyCdnHeaders = mediaRequestHeaders("https://cf-hls-media.sndcdn.com/example/playlist.m3u8", {}, "test-token");
  assert.equal(legacyCdnHeaders.has("Authorization"), false);
});

test("HLS manifests route playlists, segments, maps, and keys through localhost", () => {
  const source = [
    "#EXTM3U",
    "#EXT-X-MAP:URI=\"init.mp4\"",
    "#EXT-X-KEY:METHOD=AES-128,URI=\"https://cf-hls-media.sndcdn.com/key\"",
    "segment-1.m4s"
  ].join("\n");
  const rewritten = rewriteHlsManifest(source, "https://cf-hls-media.sndcdn.com/media/playlist.m3u8", "test-ticket");
  assert.match(rewritten, /\/media\/test-ticket\?url=/);
  assert.match(rewritten, /%2Fmedia%2Finit\.mp4/);
  assert.match(rewritten, /%2Fkey/);
  assert.match(rewritten, /%2Fmedia%2Fsegment-1\.m4s/);
  assert.equal(rewritten.includes("https://cf-hls-media.sndcdn.com/media/segment-1.m4s\n"), false);
});

test("health is public while API routes require an opaque session", async (context) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${origin}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    configured: Boolean(config.clientId && config.clientSecret && config.redirectUri),
    redirectUri: config.redirectUri
  });

  const unauthorizedResponse = await fetch(`${origin}/api/me`);
  assert.equal(unauthorizedResponse.status, 401);

  const unauthorizedTicket = await fetch(`${origin}/api/media-ticket?url=${encodeURIComponent("https://cf-hls-media.sndcdn.com/media/track.m3u8")}`);
  assert.equal(unauthorizedTicket.status, 401);

  const invalidMediaTicket = await fetch(`${origin}/media/not-a-ticket?url=${encodeURIComponent("https://cf-hls-media.sndcdn.com/media/track.m3u8")}`);
  assert.equal(invalidMediaTicket.status, 401);

  const untrustedStart = await fetch(`${origin}/auth/soundcloud/start`, { redirect: "manual" });
  assert.equal(untrustedStart.status, 400);

  const trustedStart = await fetch(
    `${origin}/auth/soundcloud/start?complete_redirect=${encodeURIComponent("https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/soundcloud")}`,
    { redirect: "manual" }
  );
  assert.equal(trustedStart.status, 302);
  const authorizeUrl = new URL(trustedStart.headers.get("location"));
  assert.equal(authorizeUrl.origin, "https://secure.soundcloud.com");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), config.redirectUri);
});

test("station authorizes JGilla, rotates fallback tracks, and accepts live selections", async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/resolve") {
      const resourceUrl = url.searchParams.get("url");
      if (resourceUrl === "https://soundcloud.com/thesoundoftrees") {
        return Response.json({ kind: "user", urn: "soundcloud:users:100", id: 100 });
      }
      return Response.json({
        kind: "track",
        urn: "soundcloud:tracks:live",
        id: 999,
        title: "Live selection",
        duration: 180_000,
        access: "playable",
        permalink_url: resourceUrl,
        user: { username: "Live artist" }
      });
    }
    if (url.pathname.includes("/users/") && url.pathname.endsWith("/tracks")) {
      return Response.json({
        collection: [{
          kind: "track",
          urn: "soundcloud:tracks:fallback",
          id: 101,
          title: "Fallback track",
          duration: 240_000,
          access: "playable",
          permalink_url: "https://soundcloud.com/thesoundoftrees/fallback",
          user: { username: "The Sound of Trees" }
        }]
      });
    }
    throw new Error(`Unexpected SoundCloud test request: ${url}`);
  };
  context.after(() => { global.fetch = originalFetch; });

  const token = sealSession({
    sessionId: "dj-session",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: Date.now() + 60 * 60 * 1000,
    sessionExpiresAt: Date.now() + 86_400_000,
    lastSeenAt: Date.now(),
    scope: "",
    profile: { id: 200, username: "JGilla", permalink_url: "https://soundcloud.com/jgilla-1" }
  });
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}` };

  const automaticResponse = await originalFetch(`${origin}/api/station`, { headers });
  assert.equal(automaticResponse.status, 200);
  const automatic = await automaticResponse.json();
  assert.equal(automatic.canDj, true);
  assert.equal(automatic.mode, "automatic");
  assert.equal(automatic.tracks[0].title, "Fallback track");

  const liveResponse = await originalFetch(`${origin}/api/station/dj`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "play", trackUrl: "https://soundcloud.com/live-artist/live-selection" })
  });
  assert.equal(liveResponse.status, 200);
  const live = await liveResponse.json();
  assert.equal(live.mode, "live");
  assert.equal(live.currentTrackId, "soundcloud:tracks:live");
  assert.equal(live.dj.username, "JGilla");

  const endResponse = await originalFetch(`${origin}/api/station/dj`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "end" })
  });
  assert.equal(endResponse.status, 200);
  assert.equal((await endResponse.json()).mode, "automatic");
});
