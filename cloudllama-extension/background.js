const BACKEND_ORIGIN = "https://shedlabs.onrender.com";
let oauthPromise = null;

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
  return false;
});
