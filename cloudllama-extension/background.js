const BACKEND_ORIGIN = "https://shedlabs.onrender.com";
let oauthPromise = null;
let creatingOffscreenDocument = null;
let lastPlaybackSaveAt = 0;
let openingPlayerWindow = null;

const PLAYER_WINDOW_WIDTH = 515;
const PLAYER_WINDOW_HEIGHT = 640;

async function openPlayerWindow() {
  if (openingPlayerWindow) return openingPlayerWindow;
  openingPlayerWindow = (async () => {
    const saved = await chrome.storage.session.get({ chromeampPlayerWindowId: null });
    if (Number.isInteger(saved.chromeampPlayerWindowId)) {
      try {
        await chrome.windows.update(saved.chromeampPlayerWindowId, { focused: true, state: "normal" });
        return { ok: true, windowId: saved.chromeampPlayerWindowId, created: false };
      } catch {
        await chrome.storage.session.remove("chromeampPlayerWindowId");
      }
    }

    const playerUrl = new URL(chrome.runtime.getURL("player.html"));
    playerUrl.searchParams.set("playerWindow", "1");
    const playerWindow = await chrome.windows.create({
      url: playerUrl.href,
      type: "popup",
      width: PLAYER_WINDOW_WIDTH,
      height: PLAYER_WINDOW_HEIGHT,
      focused: true
    });
    if (playerWindow.id == null) throw new Error("Chrome did not return a player window");
    await chrome.storage.session.set({ chromeampPlayerWindowId: playerWindow.id });
    return { ok: true, windowId: playerWindow.id, created: true };
  })().finally(() => {
    openingPlayerWindow = null;
  });
  return openingPlayerWindow;
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Keep SoundCloud playback running after the toolbar popup closes"
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

async function forwardPlaybackCommand(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: "offscreen" });
}

async function savePlaybackState(playback) {
  const now = Date.now();
  if (playback.isPlaying && now - lastPlaybackSaveAt < 1000) return;
  lastPlaybackSaveAt = now;
  const saved = await chrome.storage.local.get({ chromeampPlayerState: {} });
  const persistedPlayback = { ...playback, frequencyData: [] };
  await chrome.storage.local.set({
    chromeampPlaybackState: persistedPlayback,
    chromeampPlayerState: {
      ...saved.chromeampPlayerState,
      trackId: playback.trackId || saved.chromeampPlayerState.trackId || "",
      positionMs: Math.max(0, Number(playback.positionMs) || 0),
      shuffle: Boolean(playback.shuffle),
      repeat: Boolean(playback.repeat),
      sourceMode: playback.sourceMode === "station" ? "station" : "likes",
      stationRevision: Number(playback.stationRevision) || 0,
      shuffleQueue: playback.shuffleQueue || [],
      shuffleHistory: playback.shuffleHistory || [],
      savedAt: Date.now()
    }
  });
}

async function claimOAuthSession(responseUrl) {
  const resultUrl = new URL(responseUrl);
  const oauthError = resultUrl.searchParams.get("error");
  const claimCode = resultUrl.searchParams.get("code");

  if (oauthError) throw new Error(oauthError);
  if (!claimCode) throw new Error("SoundCloud did not return an OAuth completion code");

  const response = await fetch(`${BACKEND_ORIGIN}/auth/claim?code=${encodeURIComponent(claimCode)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.sessionId) {
    throw new Error(payload.error || "Cloud Llama could not claim the SoundCloud session");
  }
  return payload;
}

async function runSoundCloudOAuth() {
  try {
    await chrome.storage.local.set({ chromeampOAuthStatus: { state: "pending", updatedAt: Date.now() } });
    await chrome.action.setBadgeBackgroundColor({ color: "#ac9b7e" });
    await chrome.action.setBadgeText({ text: "…" });
    const completeRedirect = chrome.identity.getRedirectURL("soundcloud");
    const startUrl = `${BACKEND_ORIGIN}/auth/soundcloud/start?complete_redirect=${encodeURIComponent(completeRedirect)}`;
    const responseUrl = await chrome.identity.launchWebAuthFlow({ url: startUrl, interactive: true });
    if (!responseUrl) throw new Error("SoundCloud authorization did not complete");
    const session = await claimOAuthSession(responseUrl);
    await chrome.storage.local.set({
      chromeampSessionId: session.sessionId,
      chromeampProfile: session.profile || null,
      chromeampOAuthStatus: { state: "connected", updatedAt: Date.now() }
    });
    await chrome.action.setBadgeBackgroundColor({ color: "#00a82d" });
    await chrome.action.setBadgeText({ text: "✓" });
  } catch (error) {
    await chrome.storage.local.set({
      chromeampOAuthStatus: { state: "error", message: error.message, updatedAt: Date.now() }
    });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    await chrome.action.setBadgeText({ text: "!" });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target === "background" && message?.type === "chromeamp:openPlayerWindow") {
    openPlayerWindow().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.type === "chromeamp:startSoundCloudOAuth") {
    if (!oauthPromise) {
      oauthPromise = runSoundCloudOAuth().finally(() => {
        oauthPromise = null;
      });
    }
    sendResponse({ started: true });
    return false;
  }

  if (message?.type === "chromeamp:clearBadge") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ cleared: true });
  }

  if (message?.target === "background" && message?.type === "chromeamp:playbackCommand") {
    forwardPlaybackCommand(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message?.target === "background" && message?.type === "chromeamp:getPlaybackState") {
    (async () => {
      if (await hasOffscreenDocument()) {
        const response = await chrome.runtime.sendMessage({ type: "chromeamp:getPlaybackState", target: "offscreen" });
        sendResponse(response);
        return;
      }
      const saved = await chrome.storage.local.get({ chromeampPlaybackState: null });
      sendResponse({
        ok: true,
        playback: saved.chromeampPlaybackState
          ? { ...saved.chromeampPlaybackState, isPlaying: false, isLoading: false, frequencyData: [] }
          : null
      });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.target === "background" && message?.type === "chromeamp:offscreenPlaybackState") {
    savePlaybackState(message.playback).then(() => {
      chrome.runtime.sendMessage({
        type: "chromeamp:playbackState",
        target: "popup",
        playback: message.playback
      }).catch(() => {});
    });
    sendResponse({ received: true });
  }

  if (message?.target === "background" && message?.type === "chromeamp:sessionUpdated") {
    chrome.storage.local.set({ chromeampSessionId: message.sessionId }).then(() => {
      chrome.runtime.sendMessage({
        type: "chromeamp:sessionUpdated",
        target: "popup",
        sessionId: message.sessionId
      }).catch(() => {});
    });
    sendResponse({ saved: true });
  }
  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.get({ chromeampPlayerWindowId: null }).then((saved) => {
    if (saved.chromeampPlayerWindowId === windowId) {
      return chrome.storage.session.remove("chromeampPlayerWindowId");
    }
  }).catch(() => {});
});
