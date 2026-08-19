const BACKEND_ORIGIN = "https://shedlabs.onrender.com";

const els = {
  audio: document.querySelector("#audio"),
  elapsedTime: document.querySelector("#elapsedTime"),
  trackLink: document.querySelector("#trackLink"),
  bitrate: document.querySelector("#bitrate"),
  sampleRate: document.querySelector("#sampleRate"),
  playIndicator: document.querySelector("#playIndicator"),
  visualizer: document.querySelector("#visualizer"),
  volume: document.querySelector("#volume"),
  balance: document.querySelector("#balance"),
  seek: document.querySelector("#seek"),
  play: document.querySelector("#playButton"),
  pause: document.querySelector("#pauseButton"),
  stop: document.querySelector("#stopButton"),
  previous: document.querySelector("#previousButton"),
  next: document.querySelector("#nextButton"),
  shuffle: document.querySelector("#shuffleButton"),
  repeat: document.querySelector("#repeatButton"),
  eq: document.querySelector("#eqButton"),
  eqWindow: document.querySelector("#equalizerWindow"),
  eqClose: document.querySelector("#closeEqualizerButton"),
  eqOn: document.querySelector("#eqOnButton"),
  eqAuto: document.querySelector("#eqAutoButton"),
  eqPresets: document.querySelector("#eqPresetsButton"),
  eqFaders: document.querySelector("#eqFaders"),
  eqCurveLine: document.querySelector("#eqCurveLine"),
  viz: document.querySelector("#visualizerButton"),
  geissWindow: document.querySelector("#geissWindow"),
  geissCanvas: document.querySelector("#geissCanvas"),
  geissStage: document.querySelector("#geissStage"),
  geissClose: document.querySelector("#closeGeissButton"),
  geissFullscreen: document.querySelector("#geissFullscreenButton"),
  geissPreset: document.querySelector("#geissPreset"),
  geissFps: document.querySelector("#geissFps"),
  geissTrack: document.querySelector("#geissTrack"),
  trackList: document.querySelector("#trackList"),
  scrollThumb: document.querySelector("#scrollThumb"),
  playlistEmpty: document.querySelector("#playlistEmpty"),
  playlistEmptyMessage: document.querySelector("#playlistEmptyMessage"),
  playlistCount: document.querySelector("#playlistCount"),
  totalDuration: document.querySelector("#totalDuration"),
  refresh: document.querySelector("#refreshButton"),
  clear: document.querySelector("#clearButton"),
  select: document.querySelector("#selectButton"),
  more: document.querySelector("#moreButton"),
  settings: document.querySelector("#settingsButton"),
  settingsFooter: document.querySelector("#settingsFooterButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  connect: document.querySelector("#connectButton"),
  syncSoundCloud: document.querySelector("#syncSoundCloudButton"),
  disconnect: document.querySelector("#disconnectButton"),
  connectionState: document.querySelector("#connectionState"),
  toast: document.querySelector("#toast")
};

const state = {
  tracks: [],
  currentIndex: -1,
  sessionId: "",
  profile: null,
  isLoading: false,
  isPlaying: false,
  isSeeking: false,
  shuffle: true,
  repeat: false,
  visualizerEnabled: true,
  eqEnabled: false,
  eqAuto: false,
  eqPresetIndex: 0,
  eqValues: Array(11).fill(0),
  hls: null,
  geissOpen: false,
  geissFrame: 0,
  geissFeedback: null,
  geissLastPreset: -1,
  geissFrameCount: 0,
  geissFpsStartedAt: 0,
  audioContext: null,
  audioSource: null,
  preampNode: null,
  eqFilters: [],
  analyser: null,
  frequencyData: null
};

const EQ_FREQUENCIES = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_LABELS = ["PREAMP", "70", "180", "320", "600", "1K", "3K", "6K", "12K", "14K", "16K"];
const EQ_PRESETS = [
  { name: "FLAT", values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "BASS", values: [-1, 7, 6, 4, 2, 0, -1, -2, -2, -2, -2] },
  { name: "ROCK", values: [-1, 5, 3, -2, -4, -2, 3, 5, 6, 6, 6] },
  { name: "VOCAL", values: [-2, -3, -2, 1, 4, 6, 5, 2, 0, -1, -2] },
  { name: "TREBLE", values: [-2, -4, -3, -2, 0, 2, 4, 6, 7, 7, 7] }
];

const GEISS_PRESETS = [
  "VORTEX BLOOM",
  "RIBBON TUNNEL",
  "CHROMA WELL",
  "LIQUID MESH",
  "NEON APERTURE",
  "GRAVITY VEIL"
];

const storage = {
  async get(defaults) {
    if (globalThis.chrome?.storage?.local) {
      return chrome.storage.local.get(defaults);
    }
    const saved = JSON.parse(localStorage.getItem("chromeamp-settings") || "{}");
    return { ...defaults, ...saved };
  },
  async set(values) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set(values);
      return;
    }
    const current = JSON.parse(localStorage.getItem("chromeamp-settings") || "{}");
    localStorage.setItem("chromeamp-settings", JSON.stringify({ ...current, ...values }));
  },
  async remove(keys) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.remove(keys);
      return;
    }
    const current = JSON.parse(localStorage.getItem("chromeamp-settings") || "{}");
    keys.forEach((key) => delete current[key]);
    localStorage.setItem("chromeamp-settings", JSON.stringify(current));
  }
};

function formatClock(milliseconds, includeHours = false) {
  const totalSeconds = Math.max(0, Math.floor((milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (includeHours || hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function showToast(message, timeout = 2800) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("visible"), timeout);
}

function setButtonState(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
}

function updateRangeVisual(input, min = Number(input.min), max = Number(input.max)) {
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  const target = input.closest(".slider-track, .seek-row");
  target?.style.setProperty("--position", `${Math.max(0, Math.min(100, percent))}%`);
}

function normalizeTrack(raw) {
  const track = raw?.track || raw;
  const artist = track.metadata_artist || track.publisher_metadata?.artist || track.user?.username || "Unknown artist";
  const id = String(track.urn || track.id || crypto.randomUUID());

  return {
    ...track,
    id,
    artist,
    title: track.title || "Untitled",
    duration: Number(track.duration || track.full_duration || 0),
    permalink_url: track.permalink_url || "https://soundcloud.com",
    access: track.access || (track.streamable === false ? "blocked" : "playable")
  };
}

function renderTracks() {
  els.trackList.replaceChildren();
  const fragment = document.createDocumentFragment();

  state.tracks.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = "track-item";
    item.tabIndex = 0;
    item.dataset.index = String(index);
    item.classList.toggle("selected", index === state.currentIndex);
    item.classList.toggle("unavailable", track.access === "blocked");
    item.setAttribute("aria-label", `${index + 1}. ${track.artist} — ${track.title}, ${formatClock(track.duration)}`);

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `${track.artist} - ${track.title}`;

    const duration = document.createElement("span");
    duration.className = "duration";
    duration.textContent = formatClock(track.duration);

    item.append(label, duration);
    item.addEventListener("dblclick", () => selectTrack(index, true));
    item.addEventListener("click", () => selectTrack(index, false));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectTrack(index, true);
      }
    });
    fragment.append(item);
  });

  els.trackList.append(fragment);
  const total = state.tracks.reduce((sum, track) => sum + track.duration, 0);
  const hasTracks = state.tracks.length > 0;
  els.playlistEmpty.hidden = hasTracks;
  els.playlistEmptyMessage.textContent = state.sessionId ? "NO LIKES LOADED" : "CONNECT YOUR SOUNDCLOUD LIKES";
  els.syncSoundCloud.textContent = state.sessionId ? "SYNC SOUNDCLOUD LIKES" : "SYNC WITH SOUNDCLOUD";
  els.scrollThumb.parentElement.hidden = !hasTracks;
  els.playlistCount.textContent = state.sessionId ? `${state.tracks.length} LIKES` : "NOT CONNECTED";
  els.totalDuration.textContent = state.sessionId ? formatClock(total, true) : "--:--:--";
  syncSelectedRow();
}

function syncSelectedRow() {
  els.trackList.querySelectorAll(".track-item").forEach((item, index) => {
    item.classList.toggle("selected", index === state.currentIndex);
  });
}

function updateNowPlaying(track) {
  if (!track) {
    els.trackLink.textContent = "CLOUD LLAMA READY — CONNECT SOUNDCLOUD";
    els.trackLink.href = "https://soundcloud.com";
    els.elapsedTime.textContent = "00:00";
    els.geissTrack.textContent = "CLOUD LLAMA READY";
    return;
  }

  els.trackLink.textContent = `${state.currentIndex + 1}. ${track.artist} - ${track.title}`.toUpperCase();
  els.trackLink.href = track.permalink_url || "https://soundcloud.com";
  els.bitrate.textContent = track.media?.transcodings?.some((item) => item.format?.mime_type?.includes("mp4")) ? "256" : "128";
  els.sampleRate.textContent = "44";
  document.title = `${track.artist} — ${track.title} · Cloud Llama`;
  els.geissTrack.textContent = `${track.artist} — ${track.title}`.toUpperCase();
  applyAutomaticEq(track);
}

function currentTrack() {
  return state.tracks[state.currentIndex] || null;
}

async function backendFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json; charset=utf-8");
  if (state.sessionId) headers.set("Authorization", `Bearer ${state.sessionId}`);
  const response = await fetch(`${BACKEND_ORIGIN}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || `Cloud Llama server returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function fetchLikes() {
  if (!state.sessionId || state.isLoading) return;
  state.isLoading = true;
  els.connectionState.textContent = "Connecting to SoundCloud…";

  try {
    const [profile, payload] = await Promise.all([
      backendFetch("/api/me"),
      backendFetch("/api/likes")
    ]);
    state.profile = profile;
    state.tracks = (payload.collection || []).map(normalizeTrack).filter((track) => track.kind !== "playlist");
    state.currentIndex = state.tracks.length ? 0 : -1;
    renderTracks();
    updateNowPlaying(currentTrack());
    els.connectionState.textContent = `Connected as ${state.profile.username} · ${state.tracks.length} likes loaded`;
    showToast(`Synced ${state.tracks.length} SoundCloud likes`);
  } catch (error) {
    const expired = error.status === 401;
    if (expired) {
      state.sessionId = "";
      state.profile = null;
      await storage.remove(["chromeampSessionId"]);
    }
    els.connectionState.textContent = expired ? "Local session expired · Reconnect SoundCloud" : error.message;
    showToast(expired ? "Cloud Llama session expired — reconnect SoundCloud" : error.message, 4200);
    state.tracks = [];
    state.currentIndex = -1;
    renderTracks();
    updateNowPlaying(null);
  } finally {
    state.isLoading = false;
  }
}

function transcodingRank(transcoding) {
  const protocol = transcoding.format?.protocol || "";
  const mimeType = transcoding.format?.mime_type || "";
  const preset = transcoding.preset || "";
  if (protocol === "hls" && mimeType.includes("mp4") && preset.includes("aac_160")) return 0;
  if (protocol === "hls" && mimeType.includes("mp4")) return 1;
  if (protocol === "progressive" && mimeType.includes("mpeg")) return 2;
  if (protocol === "hls") return 3;
  if (protocol === "progressive") return 4;
  return 5;
}

async function resolveStream(track) {
  const identifier = track.urn || track.id;
  const stream = await backendFetch(`/api/tracks/${encodeURIComponent(identifier)}/streams`);
  const candidates = [
    [stream.hls_aac_160_url, "hls", "audio/mp4"],
    [stream.hls_aac_96_url, "hls", "audio/mp4"],
    [stream.http_mp3_128_url || stream.http_mp3_128, "progressive", "audio/mpeg"],
    [stream.hls_mp3_128_url, "hls", "audio/mpeg"]
  ];
  const [streamUrl, protocol, mimeType] = candidates.find(([candidate]) => typeof candidate === "string" && candidate.startsWith("https://")) || [];
  if (streamUrl) return { url: streamUrl, protocol, mimeType };

  const transcodings = track.media?.transcodings || [];
  const preferred = [...transcodings]
    .filter((item) => item?.url)
    .sort((left, right) => transcodingRank(left) - transcodingRank(right))[0];

  if (preferred) {
    const target = encodeURIComponent(preferred.url);
    const stream = await backendFetch(`/api/transcoding?url=${target}`);
    if (stream.url) {
      return {
        url: stream.url,
        protocol: preferred.format?.protocol || "",
        mimeType: preferred.format?.mime_type || ""
      };
    }
  }

  throw new Error("This track has no SoundCloud stream available for off-platform playback");
}

function destroyHls() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
}

function clearAudioSource() {
  destroyHls();
  els.audio.pause();
  els.audio.removeAttribute("src");
  delete els.audio.dataset.trackId;
  els.audio.load();
}

async function attachStream(stream) {
  destroyHls();
  els.audio.pause();
  els.audio.removeAttribute("src");
  els.audio.load();

  const isHls = stream.protocol === "hls" || /\.m3u8(?:$|\?)/i.test(stream.url);
  if (!isHls) {
    els.audio.src = stream.url;
    return;
  }

  if (globalThis.Hls?.isSupported()) {
    const ticket = await backendFetch(`/api/media-ticket?url=${encodeURIComponent(stream.url)}`);
    if (!ticket.path) throw new Error("Cloud Llama could not create a SoundCloud media ticket");
    const sourceUrl = `${BACKEND_ORIGIN}${ticket.path}`;
    const hls = new Hls({
      enableWorker: false,
      lowLatencyMode: false
    });
    state.hls = hls;
    await new Promise((resolve, reject) => {
      let settled = false;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        settled = true;
        resolve();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        const status = data.response?.code || data.response?.status;
        const detail = data.error?.message || data.details || data.type;
        const error = new Error(`SoundCloud stream failed: ${detail}${status ? ` (${status})` : ""}`);
        if (!settled) reject(error);
        else showToast(error.message, 5000);
        setPlaying(false);
      });
      hls.attachMedia(els.audio);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(sourceUrl);
      });
    });
    return;
  }

  if (els.audio.canPlayType("application/vnd.apple.mpegurl")) {
    els.audio.src = stream.url;
    return;
  }

  throw new Error("This Chrome version cannot play SoundCloud's AAC stream");
}

async function selectTrack(index, autoplay = false) {
  if (!state.tracks.length) return;
  const bounded = ((index % state.tracks.length) + state.tracks.length) % state.tracks.length;
  const changing = bounded !== state.currentIndex;

  if (changing) stopPlayback(true);
  state.currentIndex = bounded;
  syncSelectedRow();
  updateNowPlaying(currentTrack());
  els.seek.value = "0";
  updateRangeVisual(els.seek);
  els.elapsedTime.textContent = "00:00";

  const row = els.trackList.querySelector(`[data-index="${bounded}"]`);
  row?.scrollIntoView({ block: "nearest" });
  if (autoplay) await playCurrent();
}

async function playCurrent() {
  const track = currentTrack();
  if (!track) return;

  if (track.access === "blocked") {
    showToast("This track is blocked from off-platform playback");
    return;
  }

  if (!state.sessionId) {
    openSettings();
    return;
  }

  try {
    if (!els.audio.src || els.audio.dataset.trackId !== track.id) {
      els.trackLink.textContent = `BUFFERING — ${track.artist} - ${track.title}`.toUpperCase();
      const stream = await resolveStream(track);
      await attachStream(stream);
      els.audio.dataset.trackId = track.id;
      updateNowPlaying(track);
    }
    await ensureAudioAnalyser();
    await els.audio.play();
    setPlaying(true);
  } catch (error) {
    setPlaying(false);
    showToast(error.message || "Could not play this track", 4200);
    updateNowPlaying(track);
  }
}

function pausePlayback() {
  els.audio.pause();
  setPlaying(false);
}

function stopPlayback(reset = true) {
  pausePlayback();
  if (reset) {
    els.audio.currentTime = 0;
  }
  if (reset) updateProgress(0, currentTrack()?.duration || 0);
}

function setPlaying(playing) {
  state.isPlaying = playing;
  els.playIndicator.classList.toggle("paused", !playing);
  els.play.setAttribute("aria-label", playing ? "Playing" : "Play");
}

function updateProgress(positionMs, durationMs) {
  if (!state.isSeeking) {
    const ratio = durationMs ? positionMs / durationMs : 0;
    els.seek.value = String(Math.round(Math.max(0, Math.min(1, ratio)) * 1000));
    updateRangeVisual(els.seek);
  }
  els.elapsedTime.textContent = formatClock(positionMs);
}

function handleTrackEnd() {
  if (state.repeat) {
    stopPlayback();
    playCurrent();
    return;
  }
  goNext();
}

function goNext() {
  if (!state.tracks.length) return;
  const nextIndex = state.shuffle && state.tracks.length > 1
    ? pickRandomIndex()
    : (state.currentIndex + 1) % state.tracks.length;
  selectTrack(nextIndex, true);
}

function pickRandomIndex() {
  let index = state.currentIndex;
  while (index === state.currentIndex) index = Math.floor(Math.random() * state.tracks.length);
  return index;
}

function openSettings() {
  els.connectionState.textContent = state.profile
    ? `Connected as ${state.profile.username}`
    : state.sessionId
      ? "Local session saved — sync to verify"
      : "Not connected";
  els.connect.disabled = false;
  els.connect.textContent = state.sessionId ? "Reconnect SoundCloud" : "Connect to SoundCloud";
  els.settingsDialog.showModal();
  setTimeout(() => els.connect.focus(), 40);
}

async function saveSettings(event) {
  event.preventDefault();
  els.settingsDialog.close();
}

async function connectSoundCloud() {
  els.connect.disabled = true;
  els.connect.textContent = "Opening SoundCloud…";
  els.connectionState.textContent = "Checking the Cloud Llama service…";

  try {
    const health = await backendFetch("/health");
    if (!health.configured) throw new Error("Cloud Llama's SoundCloud connection is temporarily unavailable");
    if (!globalThis.chrome?.runtime?.sendMessage) throw new Error("Reload Cloud Llama from chrome://extensions first");
    const response = await chrome.runtime.sendMessage({ type: "chromeamp:startSoundCloudOAuth" });
    if (!response?.started) throw new Error("Chrome could not start the SoundCloud authorization flow");
    els.connectionState.textContent = "Finish authorizing Cloud Llama in the SoundCloud window…";
  } catch (error) {
    els.connect.disabled = false;
    els.connect.textContent = "Connect to SoundCloud";
    els.connectionState.textContent = error.message;
    showToast(error.message, 5000);
  }
}

async function disconnect() {
  stopPlayback();
  clearAudioSource();
  if (state.sessionId) {
    await backendFetch("/auth/logout", { method: "POST" }).catch(() => {});
  }
  state.sessionId = "";
  state.profile = null;
  await storage.remove(["chromeampSessionId", "chromeampProfile", "chromeampOAuthStatus", "soundcloudAccessToken"]);
  state.tracks = [];
  state.currentIndex = -1;
  renderTracks();
  updateNowPlaying(null);
  els.connect.textContent = "Connect to SoundCloud";
  els.connectionState.textContent = "Not connected";
  showToast("Disconnected from SoundCloud");
}

function updateEqDisplay() {
  const faders = els.eqFaders.querySelectorAll(".eq-fader");
  faders.forEach((fader, index) => {
    const input = fader.querySelector("input");
    const value = Number(state.eqValues[index] || 0);
    input.value = String(value);
    const percent = ((value + 12) / 24) * 100;
    fader.style.setProperty("--eq-position", `${percent}%`);
    fader.style.setProperty("--eq-top", `${92 - percent * 0.92}px`);
    input.setAttribute("aria-valuetext", `${value > 0 ? "+" : ""}${value} dB`);
  });

  const points = state.eqValues.slice(1).map((gain, index) => {
    const x = (index / (EQ_FREQUENCIES.length - 1)) * 280;
    const y = 19 - (Number(gain) / 12) * 15;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  els.eqCurveLine.setAttribute("points", points.join(" "));
}

function applyEqSettings() {
  if (state.preampNode) {
    const preampDb = state.eqEnabled ? Number(state.eqValues[0] || 0) : 0;
    state.preampNode.gain.setTargetAtTime(Math.pow(10, preampDb / 20), state.audioContext.currentTime, 0.018);
  }
  state.eqFilters.forEach((filter, index) => {
    const gain = state.eqEnabled ? Number(state.eqValues[index + 1] || 0) : 0;
    filter.gain.setTargetAtTime(gain, state.audioContext.currentTime, 0.018);
  });
  setButtonState(els.eqOn, state.eqEnabled);
  setButtonState(els.eqAuto, state.eqAuto);
  updateEqDisplay();
}

function persistEqSettings() {
  storage.set({
    eqEnabled: state.eqEnabled,
    eqAuto: state.eqAuto,
    eqValues: state.eqValues
  });
}

function setEqPreset(preset) {
  state.eqValues = [...preset.values];
  state.eqEnabled = true;
  els.eqPresets.textContent = preset.name;
  applyEqSettings();
  persistEqSettings();
}

function applyAutomaticEq(track = currentTrack()) {
  if (!state.eqAuto) return;
  const genre = `${track?.genre || ""} ${track?.tag_list || ""}`.toLowerCase();
  let preset = EQ_PRESETS[0];
  if (/hip.?hop|rap|house|electro|bass|dance|dub/.test(genre)) preset = EQ_PRESETS[1];
  else if (/rock|metal|punk|indie/.test(genre)) preset = EQ_PRESETS[2];
  else if (/vocal|singer|spoken|podcast|soul|r&b/.test(genre)) preset = EQ_PRESETS[3];
  else if (/classical|acoustic|folk|jazz/.test(genre)) preset = EQ_PRESETS[4];
  setEqPreset(preset);
}

function buildEqualizer() {
  const fragment = document.createDocumentFragment();
  EQ_LABELS.forEach((label, index) => {
    const fader = document.createElement("label");
    fader.className = "eq-fader";
    const input = document.createElement("input");
    input.type = "range";
    input.min = "-12";
    input.max = "12";
    input.step = "1";
    input.value = String(state.eqValues[index]);
    input.setAttribute("aria-label", `${label} equalizer gain`);
    input.addEventListener("input", () => {
      state.eqValues[index] = Number(input.value);
      state.eqAuto = false;
      applyEqSettings();
      persistEqSettings();
    });
    const caption = document.createElement("span");
    caption.textContent = label;
    fader.append(input, caption);
    fragment.append(fader);
  });
  els.eqFaders.append(fragment);
  updateEqDisplay();
}

function toggleEqualizerPanel(force) {
  const opening = typeof force === "boolean" ? force : els.eqWindow.hidden;
  els.eqWindow.hidden = !opening;
  setButtonState(els.eq, opening);
  if (opening) els.eqOn.focus();
  else els.eq.focus();
}

function buildVisualizer() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 24; index += 1) {
    const bar = document.createElement("span");
    bar.style.setProperty("--bar", "5%");
    fragment.append(bar);
  }
  els.visualizer.append(fragment);
}

function animateVisualizer() {
  const bars = els.visualizer.children;
  if (state.visualizerEnabled && state.isPlaying && state.analyser && state.frequencyData) {
    state.analyser.getByteFrequencyData(state.frequencyData);
    const firstBin = 1;
    const lastBin = Math.min(128, state.frequencyData.length - 1);

    for (let barIndex = 0; barIndex < bars.length; barIndex += 1) {
      const startRatio = barIndex / bars.length;
      const endRatio = (barIndex + 1) / bars.length;
      const start = Math.floor(firstBin + Math.pow(startRatio, 1.7) * (lastBin - firstBin));
      const end = Math.max(start + 1, Math.ceil(firstBin + Math.pow(endRatio, 1.7) * (lastBin - firstBin)));
      let sum = 0;
      let peak = 0;

      for (let bin = start; bin < end; bin += 1) {
        const level = state.frequencyData[bin];
        sum += level;
        peak = Math.max(peak, level);
      }

      const average = sum / Math.max(1, end - start);
      const compensated = (average * 0.72 + peak * 0.28) * (1 + barIndex / bars.length * 0.52);
      const normalized = Math.max(0, Math.min(1, (compensated - 10) / 176));
      const height = 5 + Math.pow(normalized, 0.72) * 95;
      bars[barIndex].style.setProperty("--bar", `${height.toFixed(1)}%`);
    }
  } else {
    for (const bar of bars) bar.style.setProperty("--bar", "5%");
  }
  requestAnimationFrame(animateVisualizer);
}

async function ensureAudioAnalyser() {
  if (!state.audioContext) {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable in this Chrome version");
    state.audioContext = new AudioContextClass();
    state.audioSource = state.audioContext.createMediaElementSource(els.audio);
    state.preampNode = state.audioContext.createGain();
    state.eqFilters = EQ_FREQUENCIES.map((frequency) => {
      const filter = state.audioContext.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.15;
      return filter;
    });
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 512;
    state.analyser.smoothingTimeConstant = 0.87;
    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
    state.audioSource.connect(state.preampNode);
    let output = state.preampNode;
    state.eqFilters.forEach((filter) => {
      output.connect(filter);
      output = filter;
    });
    output.connect(state.analyser);
    state.analyser.connect(state.audioContext.destination);
    applyEqSettings();
  }
  if (state.audioContext.state === "suspended") await state.audioContext.resume();
}

function geissEnergy() {
  if (!state.analyser || !state.frequencyData) {
    const idle = state.isPlaying ? 0.3 : 0.08;
    return { bass: idle, mid: idle * 0.72, high: idle * 0.48 };
  }
  state.analyser.getByteFrequencyData(state.frequencyData);
  const average = (start, end) => {
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += state.frequencyData[index];
    return sum / Math.max(1, end - start) / 255;
  };
  return {
    bass: average(1, 18),
    mid: average(18, 80),
    high: average(80, 180)
  };
}

function resizeGeissCanvas() {
  const rect = els.geissCanvas.getBoundingClientRect();
  const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.round(rect.width * pixelRatio));
  const height = Math.max(240, Math.round(rect.height * pixelRatio));
  if (els.geissCanvas.width === width && els.geissCanvas.height === height) return false;
  els.geissCanvas.width = width;
  els.geissCanvas.height = height;
  state.geissFeedback ||= document.createElement("canvas");
  state.geissFeedback.width = width;
  state.geissFeedback.height = height;
  const context = els.geissCanvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  return true;
}

function drawGeissFrame(now) {
  if (!state.geissOpen) {
    state.geissFrame = 0;
    return;
  }
  state.geissFrame = requestAnimationFrame(drawGeissFrame);
  resizeGeissCanvas();

  const canvas = els.geissCanvas;
  const context = canvas.getContext("2d");
  const feedback = state.geissFeedback;
  const feedbackContext = feedback.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const time = now / 1000;
  const energy = geissEnergy();
  const presetIndex = Math.floor(time / 12) % GEISS_PRESETS.length;
  const presetPhase = (time % 12) / 12;
  const centerX = width * (0.5 + Math.sin(time * 0.19 + presetIndex) * 0.13);
  const centerY = height * (0.5 + Math.cos(time * 0.16 + presetIndex * 0.7) * 0.11);
  const hue = (time * 14 + presetIndex * 57 + energy.mid * 90) % 360;

  if (presetIndex !== state.geissLastPreset) {
    state.geissLastPreset = presetIndex;
    els.geissPreset.textContent = `PRESET ${String(presetIndex + 1).padStart(2, "0")} · ${GEISS_PRESETS[presetIndex]}`;
  }

  feedbackContext.setTransform(1, 0, 0, 1, 0, 0);
  feedbackContext.globalCompositeOperation = "source-over";
  feedbackContext.globalAlpha = 1;
  feedbackContext.clearRect(0, 0, width, height);
  feedbackContext.drawImage(canvas, 0, 0);

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.fillStyle = `rgba(0, 0, 0, ${0.075 + energy.high * 0.07})`;
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(centerX, centerY);
  context.rotate(Math.sin(time * 0.12 + presetIndex) * 0.012 + (presetIndex % 2 ? -1 : 1) * 0.0018);
  const feedbackScale = 1.008 + energy.bass * 0.018 + Math.sin(presetPhase * Math.PI) * 0.004;
  context.scale(feedbackScale, feedbackScale);
  context.translate(-centerX, -centerY);
  context.globalAlpha = 0.91;
  context.drawImage(feedback, 0, 0);
  context.restore();

  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  const shortest = Math.min(width, height);
  const aspect = width / height;

  for (let ring = 0; ring < 19; ring += 1) {
    const progress = (ring + presetPhase * 2.4) / 19;
    const radius = shortest * (0.045 + progress * 0.71) * (1 + energy.bass * 0.13);
    const segments = 88;
    context.beginPath();
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const ripple = 1
        + Math.sin(angle * (3 + presetIndex % 4) + time * (0.7 + energy.mid) + ring * 0.56) * (0.035 + energy.mid * 0.08)
        + Math.sin(angle * 9 - time * 0.43 + ring) * 0.018;
      const twist = angle + Math.sin(time * 0.21 + ring * 0.17) * 0.16;
      const x = centerX + Math.cos(twist) * radius * ripple * Math.min(1.48, aspect);
      const y = centerY + Math.sin(angle) * radius * ripple;
      if (segment === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = `hsla(${(hue + ring * 4.8) % 360}, 88%, ${38 + energy.high * 36}%, ${0.075 + (1 - progress) * 0.17})`;
    context.lineWidth = 0.6 + energy.bass * 1.8;
    context.stroke();
  }

  const bandCount = 17;
  for (let band = -bandCount; band <= bandCount; band += 1) {
    context.beginPath();
    for (let step = 0; step <= 72; step += 1) {
      const progress = step / 72;
      const x = progress * width;
      const centeredX = (x - centerX) / width;
      const wave = Math.sin(progress * Math.PI * (3 + presetIndex % 3) + time * 0.82 + band * 0.31);
      const fold = Math.sin(centeredX * 12 - time * 0.34 + band * 0.18);
      const y = centerY + band * shortest * 0.022 + wave * shortest * (0.055 + energy.mid * 0.08) + fold * shortest * 0.018;
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    const distance = Math.abs(band) / bandCount;
    context.strokeStyle = `hsla(${(hue + 115 + band * 2.5) % 360}, 92%, ${44 + energy.high * 28}%, ${0.035 + (1 - distance) * 0.12})`;
    context.lineWidth = 0.45 + energy.high * 1.2;
    context.stroke();
  }

  for (let particle = 0; particle < 92; particle += 1) {
    const spiral = particle * 0.73 + time * (0.17 + energy.high * 0.45);
    const orbit = shortest * (0.04 + ((particle * 37) % 89) / 89 * 0.78);
    const pulse = 1 + Math.sin(time * 1.1 + particle) * (0.05 + energy.bass * 0.16);
    const x = centerX + Math.cos(spiral) * orbit * pulse * Math.min(1.4, aspect);
    const y = centerY + Math.sin(spiral * 1.07) * orbit * pulse;
    const size = 0.5 + energy.high * 2.2 + (particle % 7 === 0 ? energy.bass * 2 : 0);
    context.fillStyle = `hsla(${(hue + particle * 2.9) % 360}, 100%, 65%, ${0.09 + energy.high * 0.24})`;
    context.fillRect(x, y, size, size);
  }

  context.globalCompositeOperation = "source-over";
  const well = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, shortest * 0.32);
  well.addColorStop(0, `rgba(0, 0, 0, ${0.8 - energy.bass * 0.28})`);
  well.addColorStop(0.24, `hsla(${hue}, 90%, 20%, ${0.12 + energy.bass * 0.1})`);
  well.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = well;
  context.fillRect(0, 0, width, height);

  state.geissFrameCount += 1;
  if (!state.geissFpsStartedAt) state.geissFpsStartedAt = now;
  if (now - state.geissFpsStartedAt >= 750) {
    const fps = Math.round((state.geissFrameCount * 1000) / (now - state.geissFpsStartedAt));
    els.geissFps.textContent = `${fps} FPS`;
    state.geissFrameCount = 0;
    state.geissFpsStartedAt = now;
  }
}

async function openGeissVisualizer() {
  state.geissOpen = true;
  els.geissWindow.hidden = false;
  setButtonState(els.viz, true);
  els.geissTrack.textContent = currentTrack()
    ? `${currentTrack().artist} — ${currentTrack().title}`.toUpperCase()
    : "CLOUD LLAMA READY";
  try {
    await ensureAudioAnalyser();
  } catch (error) {
    showToast(`${error.message} — running ambient mode`, 4200);
  }
  if (!state.geissFrame) state.geissFrame = requestAnimationFrame(drawGeissFrame);
  els.geissFullscreen.focus();
}

async function closeGeissVisualizer() {
  if (document.fullscreenElement === els.geissWindow) await document.exitFullscreen().catch(() => {});
  state.geissOpen = false;
  els.geissWindow.hidden = true;
  setButtonState(els.viz, false);
  if (state.geissFrame) cancelAnimationFrame(state.geissFrame);
  state.geissFrame = 0;
  els.viz.focus();
}

async function toggleGeissFullscreen() {
  try {
    if (document.fullscreenElement === els.geissWindow) {
      await document.exitFullscreen();
    } else {
      await els.geissWindow.requestFullscreen({ navigationUI: "hide" });
    }
  } catch {
    showToast("Chrome blocked fullscreen — click FULLSCREEN again", 4200);
  }
}

function syncGeissFullscreenState() {
  const fullscreen = document.fullscreenElement === els.geissWindow;
  els.geissFullscreen.textContent = fullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN";
  resizeGeissCanvas();
}

function bindEvents() {
  els.play.addEventListener("click", playCurrent);
  els.pause.addEventListener("click", pausePlayback);
  els.stop.addEventListener("click", () => stopPlayback());
  els.previous.addEventListener("click", () => selectTrack(state.currentIndex - 1, true));
  els.next.addEventListener("click", goNext);

  els.volume.addEventListener("input", () => {
    els.audio.volume = Number(els.volume.value) / 100;
    updateRangeVisual(els.volume);
    storage.set({ volume: Number(els.volume.value) });
  });

  els.balance.addEventListener("input", () => {
    updateRangeVisual(els.balance);
  });

  els.seek.addEventListener("pointerdown", () => { state.isSeeking = true; });
  els.seek.addEventListener("input", () => {
    updateRangeVisual(els.seek);
    const position = (Number(els.seek.value) / 1000) * (currentTrack()?.duration || 0);
    els.elapsedTime.textContent = formatClock(position);
  });
  els.seek.addEventListener("change", () => {
    const position = (Number(els.seek.value) / 1000) * (currentTrack()?.duration || 0);
    if (Number.isFinite(els.audio.duration)) {
      els.audio.currentTime = position / 1000;
    }
    state.isSeeking = false;
  });

  els.shuffle.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    setButtonState(els.shuffle, state.shuffle);
  });
  els.repeat.addEventListener("click", () => {
    state.repeat = !state.repeat;
    setButtonState(els.repeat, state.repeat);
  });
  els.eq.addEventListener("click", () => toggleEqualizerPanel());
  els.eqClose.addEventListener("click", () => toggleEqualizerPanel(false));
  els.eqOn.addEventListener("click", () => {
    state.eqEnabled = !state.eqEnabled;
    applyEqSettings();
    persistEqSettings();
  });
  els.eqAuto.addEventListener("click", () => {
    state.eqAuto = !state.eqAuto;
    if (state.eqAuto) applyAutomaticEq();
    else {
      applyEqSettings();
      persistEqSettings();
    }
  });
  els.eqPresets.addEventListener("click", () => {
    state.eqAuto = false;
    state.eqPresetIndex = (state.eqPresetIndex + 1) % EQ_PRESETS.length;
    setEqPreset(EQ_PRESETS[state.eqPresetIndex]);
  });
  els.viz.addEventListener("click", () => {
    if (state.geissOpen) closeGeissVisualizer();
    else openGeissVisualizer();
  });
  els.geissClose.addEventListener("click", closeGeissVisualizer);
  els.geissFullscreen.addEventListener("click", toggleGeissFullscreen);
  document.addEventListener("fullscreenchange", syncGeissFullscreenState);
  [els.settings, els.settingsFooter].forEach((button) => button.addEventListener("click", openSettings));
  els.settingsForm.addEventListener("submit", saveSettings);
  els.connect.addEventListener("click", connectSoundCloud);
  els.syncSoundCloud.addEventListener("click", () => state.sessionId ? fetchLikes() : openSettings());
  els.disconnect.addEventListener("click", disconnect);
  els.refresh.addEventListener("click", () => state.sessionId ? fetchLikes() : openSettings());
  els.clear.addEventListener("click", () => {
    stopPlayback();
    clearAudioSource();
    state.tracks = [];
    state.currentIndex = -1;
    renderTracks();
    updateNowPlaying(null);
  });
  els.select.addEventListener("click", () => currentTrack() && selectTrack(state.currentIndex, true));
  els.more.addEventListener("click", () => {
    const track = currentTrack();
    if (track?.permalink_url) window.open(track.permalink_url, "_blank", "noopener");
  });

  els.trackList.addEventListener("scroll", () => {
    const max = els.trackList.scrollHeight - els.trackList.clientHeight;
    const percent = max ? (els.trackList.scrollTop / max) * 100 : 0;
    els.scrollThumb.style.setProperty("--scroll", `${Math.min(92, percent * 0.92)}%`);
  });

  els.audio.addEventListener("timeupdate", () => updateProgress(els.audio.currentTime * 1000, els.audio.duration * 1000 || currentTrack()?.duration));
  els.audio.addEventListener("ended", handleTrackEnd);
  els.audio.addEventListener("play", () => setPlaying(true));
  els.audio.addEventListener("pause", () => {
    if (!els.audio.ended) setPlaying(false);
  });
  els.audio.addEventListener("error", () => {
    if (els.audio.src && !state.hls) showToast("The SoundCloud stream could not be played", 4200);
    setPlaying(false);
  });

  document.querySelector(".window-button.minimize").addEventListener("click", () => {
    window.close();
  });
  document.querySelector(".player-window > .titlebar .window-button.close").addEventListener("click", () => window.close());
}

async function initialize() {
  buildEqualizer();
  buildVisualizer();
  bindEvents();
  const saved = await storage.get({
    chromeampSessionId: "",
    chromeampProfile: null,
    chromeampOAuthStatus: null,
    volume: 82,
    eqEnabled: false,
    eqAuto: false,
    eqValues: Array(11).fill(0)
  });
  state.sessionId = saved.chromeampSessionId || "";
  state.profile = saved.chromeampProfile || null;
  els.volume.value = String(saved.volume ?? 82);
  els.audio.volume = Number(els.volume.value) / 100;
  state.eqEnabled = Boolean(saved.eqEnabled);
  state.eqAuto = Boolean(saved.eqAuto);
  state.eqValues = Array.isArray(saved.eqValues) && saved.eqValues.length === 11
    ? saved.eqValues.map((value) => Math.max(-12, Math.min(12, Number(value) || 0)))
    : Array(11).fill(0);
  applyEqSettings();
  updateRangeVisual(els.volume);
  updateRangeVisual(els.balance);
  updateRangeVisual(els.seek);

  await storage.remove(["soundcloudAccessToken"]);
  if (globalThis.chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: "chromeamp:clearBadge" }).catch(() => {});
  }

  if (state.sessionId) {
    await fetchLikes();
  } else {
    renderTracks();
    updateNowPlaying(null);
    if (saved.chromeampOAuthStatus?.state === "error") {
      showToast(saved.chromeampOAuthStatus.message || "SoundCloud connection failed", 5000);
    } else if (saved.chromeampOAuthStatus?.state === "pending") {
      showToast("SoundCloud authorization is still waiting to finish", 4000);
    }
  }

  animateVisualizer();
}

initialize();
