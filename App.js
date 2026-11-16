import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, ImageBackground, Linking, Platform, Pressable, ScrollView,
  Share, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  STYLES, CAMERAS, MOODS, AD_TEMPLATES, LANGUAGES, STORIES, SCENES, buildPrompt, directorVariants, screenPrompt,
} from "./shared";

const API = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "web" ? (typeof __DEV__ !== "undefined" && __DEV__ ? "http://localhost:8787" : window.location.origin) : "")
).trim().replace(/\/+$/, "");

const K = { library: "vyra-library-v2", legacy: "vyra-ai-library-v1", client: "vyra-client-id", code: "vyra-access-code", pending: "vyra-pending-job", onboarded: "vyra-onboarded" };

const C = { bg: "#050a13", panel: "#0c1524", white: "#f6f8ff", muted: "#a5b3c8", cyan: "#79efff", green: "#78f4c0", pink: "#ff9dd6", red: "#ffc3d1", border: "rgba(153,201,255,0.18)" };

const MODES = [
  ["text", "✦ Text"], ["photo", "▧ Photo"], ["ad", "◈ Ad Studio"], ["talking-fruits", "🍓 Fruits"],
];

const FAQ = [
  ["How long does a video take?", "Most clips are ready in 1–3 minutes. Talking Fruits stories have four scenes and take longer."],
  ["Is it free?", "Each account receives 3 free video-generation trials for its lifetime. The balance is shown in Settings. Prompt Director does not use a video trial."],
  ["Who owns my videos?", "You do. Videos are AI-generated, so check the rules of the platform where you publish and label AI content where required."],
  ["What can't I make?", "Sexual content, content involving minors in unsafe contexts, deepfakes of real people, graphic violence, and anything illegal."],
  ["How long are videos kept?", "Videos are stored for 7 days. Download the ones you want to keep."],
];

function Button({ children, onPress, secondary, disabled, small }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={({ pressed }) => [s.button, small && s.buttonSmall, secondary && s.secondaryButton, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: 0.75 }]}>
      <Text style={[s.buttonText, secondary && { color: C.white }]}>{children}</Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.pill, active && s.pillActive]}>
      <Text style={[s.whiteText, active && { color: C.cyan }]}>{label}</Text>
    </Pressable>
  );
}

function Label({ children, right }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{children}</Text>
      {right ? <Text style={s.muted}>{right}</Text> : null}
    </View>
  );
}

function NativePlayer({ uri }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; });
  return <VideoView player={player} style={s.nativeVideo} nativeControls allowsFullscreen />;
}

function Player({ uri, shareUrl, notify }) {
  async function download() {
    if (Platform.OS !== "web") return Linking.openURL(uri).catch(() => notify("Could not open the video."));
    try {
      notify("Preparing download…");
      const r = await fetch(uri);
      if (!r.ok) throw new Error("Download failed.");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "vyra-ai-video.mp4";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notify("Download started.");
    } catch (e) { notify(e.message || "Download failed."); }
  }
  async function share() {
    const link = shareUrl || uri;
    try {
      if (Platform.OS === "web") {
        if (navigator.share) await navigator.share({ title: "Made with VYRA AI", url: link });
        else { await navigator.clipboard.writeText(link); notify("Share link copied."); }
      } else await Share.share({ message: `Made with VYRA AI ✨ ${link}` });
    } catch { /* user dismissed */ }
  }
  return (
    <View style={{ gap: 12 }}>
      {Platform.OS === "web"
        ? React.createElement("video", { src: uri, controls: true, playsInline: true, autoPlay: true, loop: true, style: { width: "100%", maxHeight: 520, borderRadius: 12, backgroundColor: "#02050a" } })
        : <NativePlayer uri={uri} />}
      <View style={s.actions}>
        <Button onPress={download} small>↓ DOWNLOAD</Button>
        <Button secondary onPress={share} small>↗ SHARE LINK</Button>
      </View>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const desktop = width >= 950;
  const tablet = width >= 650;

  const [page, setPage] = useState("Home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [online, setOnline] = useState(null);
  const [quota, setQuota] = useState(null);
  const [code, setCode] = useState("");
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [toast, setToast] = useState("");

  const [mode, setMode] = useState("text");
  const [prompt, setPrompt] = useState(SCENES[0].prompt);
  const [styleName, setStyleName] = useState("Anime Film");
  const [camera, setCamera] = useState("auto");
  const [mood, setMood] = useState("auto");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState("5");
  const [photoUri, setPhotoUri] = useState("");
  const [photoData, setPhotoData] = useState("");
  const [storyKey, setStoryKey] = useState("market");
  const [language, setLanguage] = useState("Hindi");
  const [adTemplate, setAdTemplate] = useState("hero");
  const [brandName, setBrandName] = useState("");
  const [productName, setProductName] = useState("");
  const [callToAction, setCallToAction] = useState("Discover more");
  const [variants, setVariants] = useState([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ pct: 0, text: "", queue: 0, elapsed: 0 });
  const [result, setResult] = useState(null);

  const [library, setLibrary] = useState([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [faqOpen, setFaqOpen] = useState(-1);
  const [welcome, setWelcome] = useState(false);

  const clientId = useRef("");
  const stopPolling = useRef(false);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }, []);

  const api = useCallback(async (path, opts = {}) => {
    const { data: { session: currentSession } = {} } = supabase
      ? await supabase.auth.getSession()
      : {};
    const token = currentSession?.access_token;
    const r = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "x-vyra-client": clientId.current,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(code ? { "x-vyra-code": code } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || `Request failed (${r.status}).`); e.code = data.code; e.status = r.status; throw e; }
    return data;
  }, [code]);

  // ---- Supabase account session
  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return undefined;
    }

    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthMessage(error.message);
      setSession(data?.session || null);
      setAuthReady(true);
    }).catch(() => {
      if (active) setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setQuota(null);
      setAuthMessage("");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn() {
    if (!supabase) return setAuthMessage("Account sign-in is not configured in this app build.");
    if (!authEmail.trim() || !authPassword) return setAuthMessage("Enter your email and password.");
    setAuthBusy(true); setAuthMessage("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      setAuthPassword("");
      setAuthMessage("You are signed in.");
    } catch (error) {
      setAuthMessage(error.message || "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signUp() {
    if (!supabase) return setAuthMessage("Account registration is not configured in this app build.");
    if (!authEmail.trim() || authPassword.length < 6) return setAuthMessage("Enter an email and a password with at least 6 characters.");
    setAuthBusy(true); setAuthMessage("");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      setAuthPassword("");
      setAuthMessage(data?.session
        ? "Your account is ready."
        : "Account created. Check your email to confirm your address, then sign in.");
    } catch (error) {
      setAuthMessage(error.message || "Could not create your account.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setAuthBusy(true); setAuthMessage("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setQuota(null);
      setAuthMessage("You are signed out.");
    } catch (error) {
      setAuthMessage(error.message || "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  }

  // ---- boot: client id, access code, library, backend config, resume pending job
  useEffect(() => {
    (async () => {
      try {
        let id = await AsyncStorage.getItem(K.client);
        if (!id) { id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; await AsyncStorage.setItem(K.client, id); }
        clientId.current = id;
        setCode((await AsyncStorage.getItem(K.code)) || "");
        const saved = (await AsyncStorage.getItem(K.library)) || (await AsyncStorage.getItem(K.legacy));
        if (saved) { const p = JSON.parse(saved); if (Array.isArray(p)) setLibrary(p); }
        if (!(await AsyncStorage.getItem(K.onboarded))) setWelcome(true);
      } catch { /* ignore */ }
      setLibraryLoaded(true);
    })();
  }, []);

  useEffect(() => { if (libraryLoaded) AsyncStorage.setItem(K.library, JSON.stringify(library)).catch(() => {}); }, [library, libraryLoaded]);

  const loadConfig = useCallback(async () => {
    if (!API) { setOnline(false); return; }
    try {
      const c = await api("/api/config");
      setConfig(c); setOnline(true);
      if (session && (!c.accessRequired || code)) {
        try {
          const q = await api("/api/quota");
          setQuota(q);
        } catch {
          setQuota(null);
        }
      } else {
        setQuota(null);
      }
    } catch { setOnline(false); }
  }, [api, code, session]);

  useEffect(() => { if (libraryLoaded && authReady) loadConfig(); }, [libraryLoaded, authReady, loadConfig]);

  useEffect(() => {
    if (!libraryLoaded || !authReady || !session || !API) return;
    AsyncStorage.getItem(K.pending).then((raw) => {
      if (!raw) return;
      try { const p = JSON.parse(raw); if (p?.jobId) { setPage("Create"); setBusy(true); finishJob(p.jobId, p.meta); } } catch { /* ignore */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLoaded, authReady, Boolean(session)]);

  const features = config?.features || {};
  const enabled = { text: features.text, photo: features.photo, ad: features.ad, "talking-fruits": features.talkingFruits };

  function go(p) { setPage(p); setMenuOpen(false); setError(""); }
  function openCreator(m = "text") { setMode(m); setResult(null); setError(""); setVariants([]); go("Create"); }

  function switchMode(m) {
    setMode(m); setError(""); setResult(null); setVariants([]);
    if (m === "talking-fruits") { setAspectRatio("9:16"); setStyleName("3D Cartoon"); }
    if (m === "photo" && !prompt.trim()) setPrompt("Animate this photo with gentle cinematic camera movement and natural motion.");
    if (m === "ad" && prompt === SCENES[0].prompt) setPrompt("");
  }

  function loadScene(scene) {
    setPrompt(scene.prompt); setStyleName(scene.style); setMode("text"); setResult(null); setVariants([]);
    go("Create"); notify(`${scene.title} loaded.`);
  }

  async function choosePhoto() {
    setError("");
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setError("Please allow photo library access.");
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.8, base64: true });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      if (!a.base64) throw new Error("Could not read this photo.");
      const mime = a.mimeType || "image/jpeg";
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Choose a JPG, PNG or WebP image.");
      const data = `data:${mime};base64,${a.base64}`;
      if (data.length > 11 * 1024 * 1024) throw new Error("Choose a smaller photo (under about 8 MB).");
      setPhotoUri(a.uri); setPhotoData(data); setMode("photo"); setPage("Create");
    } catch (e) { setError(e.message || "Could not open photos."); }
  }

  async function runDirector() {
    setError("");
    if (!prompt.trim()) return setError("Describe your scene first.");
    const blocked = screenPrompt(prompt);
    if (blocked) return setError(blocked);
    try {
      const d = await api("/api/enhance", { method: "POST", body: JSON.stringify({ prompt }) });
      setVariants(d.variants || []);
    } catch { setVariants(directorVariants({ prompt })); }
  }

  // ---- polling (shared by new jobs and resumed jobs)
  async function finishJob(jobId, meta) {
    stopPolling.current = false;
    const started = Date.now();
    try {
      for (let i = 0; i < 400; i += 1) {
        if (stopPolling.current) throw new Error("Stopped waiting. Your video may still finish — check Library soon.");
        const j = await api(`/api/generate/${encodeURIComponent(jobId)}`);
        setProgress({ pct: j.progress || 0, text: j.message || "Working…", queue: j.queuePosition || 0, elapsed: Math.round((Date.now() - started) / 1000) });
        if (j.status === "completed" && j.videoUrl) {
          const item = { id: jobId, title: (meta?.title || j.prompt || "Untitled").slice(0, 60), category: meta?.category || "Video", url: j.videoUrl, thumb: j.thumbUrl, shareUrl: j.shareUrl, fav: false, createdAt: new Date().toLocaleString(), settings: meta?.settings || null };
          setLibrary((prev) => [item, ...prev.filter((x) => x.id !== jobId)]);
          setResult(item);
          notify("Your video is ready!");
          await AsyncStorage.removeItem(K.pending);
          return;
        }
        if (j.status === "failed") throw new Error(j.error || "Video generation failed.");
        await new Promise((r) => setTimeout(r, i < 10 ? 2000 : 3000));
      }
      throw new Error("This is taking longer than expected. Check Library in a few minutes.");
    } catch (e) {
      const m = String(e.message || "");
      if (!/Stopped waiting|longer than expected/.test(m)) await AsyncStorage.removeItem(K.pending);
      setError(/failed to fetch|network request failed/i.test(m) ? "Cannot reach the VYRA server. Check your connection." : m);
    } finally {
      setBusy(false); setProgress({ pct: 0, text: "", queue: 0, elapsed: 0 });
      api("/api/quota").then(setQuota).catch(() => {});
    }
  }

  async function generate() {
    setError(""); setResult(null);
    if (!API) return setError("This build has no server configured. Set EXPO_PUBLIC_API_URL.");
    if (!session) { setError("Sign in or create a VYRA account to use a video trial."); setPage("Settings"); return; }
    if (enabled[mode] === false) return setError("This mode is not enabled on the server yet.");
    if (mode === "photo" && !photoData) return setError("Please choose a photo first.");
    if (mode !== "talking-fruits") {
      if (!prompt.trim()) return setError("Please describe your scene first.");
      const blocked = screenPrompt(prompt);
      if (blocked) return setError(blocked);
    }
    const settings = { mode, prompt, styleName, camera, mood, aspectRatio, duration, storyKey, language, adTemplate, brandName, productName, callToAction };
    const body = {
      mode, prompt, style: styleName, camera, mood, aspectRatio, duration: Number(duration), storyKey, language,
      imageData: mode === "photo" ? photoData : null,
      ad: mode === "ad" ? { template: adTemplate, brandName, productName, callToAction } : null,
    };
    setBusy(true); setProgress({ pct: 2, text: "Submitting…", queue: 0, elapsed: 0 });
    try {
      const job = await api("/api/generate", { method: "POST", body: JSON.stringify(body) });
      if (typeof job.remaining === "number") setQuota((q) => ({ ...(q || {}), remaining: job.remaining, limit: 3, type: "lifetime" }));
      const meta = { title: mode === "talking-fruits" ? STORIES[storyKey].title : prompt.trim(), category: mode === "talking-fruits" ? "Talking Fruits" : mode === "ad" ? "Ad" : styleName, settings };
      await AsyncStorage.setItem(K.pending, JSON.stringify({ jobId: job.jobId, meta }));
      await finishJob(job.jobId, meta);
    } catch (e) {
      setBusy(false); setProgress({ pct: 0, text: "", queue: 0, elapsed: 0 });
      if (e.code === "ACCESS_CODE") { setError("Enter your access code in Settings to create videos."); setPage("Settings"); }
      else if (e.code === "AUTH_REQUIRED" || e.code === "AUTH_INVALID") { setError("Please sign in to your VYRA account."); setPage("Settings"); }
      else setError(/failed to fetch|network request failed/i.test(e.message) ? "Cannot reach the VYRA server. Check your connection." : e.message);
    }
  }

  function remix(item) {
    const st = item.settings;
    if (!st) return openCreator("text");
    setMode(st.mode); setPrompt(st.prompt || ""); setStyleName(st.styleName || "Cinematic"); setCamera(st.camera || "auto"); setMood(st.mood || "auto");
    setAspectRatio(st.aspectRatio || "16:9"); setDuration(st.duration || "5"); setStoryKey(st.storyKey || "market"); setLanguage(st.language || "Hindi");
    setAdTemplate(st.adTemplate || "hero"); setBrandName(st.brandName || ""); setProductName(st.productName || ""); setCallToAction(st.callToAction || "");
    setResult(null); go("Create"); notify("Settings restored — tweak and generate again.");
  }

  async function removeItem(item) {
    setLibrary((p) => p.filter((x) => x.id !== item.id));
    api(`/api/generate/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => {});
  }

  async function saveCode() {
    try { await AsyncStorage.setItem(K.code, code.trim()); setCode(code.trim()); notify("Access code saved."); setTimeout(loadConfig, 50); } catch { notify("Could not save."); }
  }

  const nav = [["Home", "⌂"], ["Create", "✦"], ["Explore", "▧"], ["Library", "▤"], ["Help", "?"], ["Settings", "⚙"]];
  const quotaText = quota && typeof quota.remaining === "number" ? `${quota.remaining}/${quota.limit || config?.trialLimit || 3} lifetime trials left` : session ? "Trial balance unavailable" : "Sign in to view your trials";

  const header = (
    <View style={s.header}>
      <Pressable style={s.logoRow} onPress={() => go("Home")}>
        <View style={s.logoMark}><Text style={s.logoLetter}>V</Text></View>
        <View><Text style={s.logoText}>VYRA <Text style={s.cyan}>AI</Text></Text><Text style={s.logoCaption}>CINEMATIC INTELLIGENCE</Text></View>
      </Pressable>
      {desktop ? (
        <View style={s.nav}>
          {nav.map(([label]) => (
            <Pressable key={label} onPress={() => go(label)} style={[s.navItem, page === label && s.navItemActive]}>
              <Text style={[s.navText, page === label && s.cyan]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable onPress={() => setMenuOpen((v) => !v)} style={s.menuButton}><Text style={s.cyan}>{menuOpen ? "×" : "☰"}</Text></Pressable>
      )}
      <Button small onPress={() => openCreator("text")}>＋ CREATE</Button>
    </View>
  );

  const mobileMenu = menuOpen && !desktop ? (
    <View style={s.mobileMenu}>
      {nav.map(([label, icon]) => (
        <Pressable key={label} onPress={() => go(label)} style={s.mobileMenuItem}><Text style={s.cyan}>{icon}</Text><Text style={s.navText}>{label}</Text></Pressable>
      ))}
    </View>
  ) : null;

  const statusBanner = online === false ? (
    <View style={s.banner}><Text style={s.bannerText}>⚠ Can't reach the VYRA server right now. Browsing works, but creating videos needs a connection.</Text></View>
  ) : config?.maintenance ? (
    <View style={s.banner}><Text style={s.bannerText}>VYRA is in maintenance mode. Creating videos is paused.</Text></View>
  ) : null;

  const welcomeCard = welcome ? (
    <View style={[s.section, { paddingTop: 20, paddingBottom: 0 }]}>
      <View style={[s.panel, { borderColor: C.cyan, marginBottom: 0 }]}>
        <Text style={s.eyebrow}>WELCOME TO VYRA</Text>
        <Text style={s.panelTitle}>Make your first video in 3 steps</Text>
        <Text style={s.mutedParagraph}>1 · Pick a mode (Text, Photo, Ad Studio or Talking Fruits).  2 · Describe it, or tap Prompt Director for ideas.  3 · Generate, then download or share the link.</Text>
        <Button small onPress={() => { setWelcome(false); AsyncStorage.setItem(K.onboarded, "1").catch(() => {}); openCreator("text"); }}>START CREATING</Button>
      </View>
    </View>
  ) : null;

  const hero = (
    <ImageBackground source={{ uri: SCENES[0].image }} style={[s.hero, !desktop && s.heroMobile]} imageStyle={{ resizeMode: "cover" }}>
      <View style={s.heroShade} />
      <View style={s.heroContent}>
        <View style={s.badge}><View style={s.dot} /><Text style={s.badgeText}>YOUR AI STORY STUDIO · NOW LIVE</Text></View>
        <Text style={s.heroEyebrow}>DREAM IN MOTION</Text>
        <Text style={[s.heroTitle, !tablet && s.heroTitleMobile]}>STORIES BEYOND{"\n"}<Text style={s.cyan}>IMAGINATION.</Text></Text>
        <Text style={s.heroDescription}>Turn words into cinematic scenes, bring photos to life, make ads in minutes, or create a Hindi talking-fruit comedy.</Text>
        <View style={[s.actions, !tablet && { flexDirection: "column", alignItems: "stretch" }]}>
          <Button onPress={() => openCreator("text")}>✦ CREATE A SCENE</Button>
          <Button secondary onPress={() => openCreator("talking-fruits")}>🍓 TALKING FRUITS</Button>
        </View>
        <Text style={s.heroFoot}>TEXT · PHOTO · ADS · TALKING FRUITS · SHAREABLE LINKS</Text>
      </View>
    </ImageBackground>
  );

  const generatingPanel = busy ? (
    <View style={s.progressBox}>
      <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.max(4, progress.pct)}%` }]} /></View>
      <View style={s.progressRow}>
        <ActivityIndicator color={C.cyan} />
        <Text style={[s.muted, { flex: 1 }]}>
          {progress.queue > 0 ? `In line — position ${progress.queue}` : progress.text || "Working…"}
          {progress.elapsed ? ` · ${progress.elapsed}s` : ""}
        </Text>
      </View>
      <Text style={s.muted}>You can leave this page. Your video keeps rendering and will appear in Library.</Text>
      <Button small secondary onPress={() => { stopPolling.current = true; }}>STOP WAITING</Button>
    </View>
  ) : null;

  const creator = (
    <View style={s.section}>
      <View style={s.fieldRow}>
        <Text style={s.eyebrow}>YOUR PERSONAL AI STUDIO</Text>
        {quotaText ? <Text style={s.quotaTag}>{quotaText}</Text> : null}
      </View>
      <Text style={s.sectionTitle}>Bring a world to life.</Text>

      <View style={[s.creatorGrid, !desktop && { flexDirection: "column" }]}>
        <View style={[s.panel, desktop && { flex: 1.1 }]}>
          <View style={s.tabs}>
            {MODES.map(([value, label]) => (
              <Pressable key={value} onPress={() => switchMode(value)} style={[s.tab, mode === value && s.tabActive]}>
                <Text style={[s.tabText, mode === value && s.cyan]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {enabled[mode] === false && <Text style={s.error}>This mode isn't switched on for this server yet.</Text>}

          {mode === "photo" && (
            <Pressable onPress={choosePhoto} style={s.uploadBox}>
              {photoUri ? <Image source={{ uri: photoUri }} style={s.uploadImage} /> : <Text style={[s.cyan, { fontSize: 30 }]}>＋</Text>}
              <Text style={s.whiteText}>{photoUri ? "Photo selected — tap to change" : "Choose a starting photo"}</Text>
              <Text style={s.muted}>Tip: use photos you own. People's faces need consent.</Text>
            </Pressable>
          )}

          {mode === "ad" && (
            <View style={s.storyBox}>
              <Label>AD TEMPLATE</Label>
              <View style={s.actions}>{AD_TEMPLATES.map((t) => <Chip key={t.id} label={t.label} active={adTemplate === t.id} onPress={() => setAdTemplate(t.id)} />)}</View>
              <TextInput value={brandName} onChangeText={setBrandName} placeholder="Brand name" placeholderTextColor="#71839c" style={s.smallInput} />
              <TextInput value={productName} onChangeText={setProductName} placeholder="Product or service" placeholderTextColor="#71839c" style={s.smallInput} />
              <TextInput value={callToAction} onChangeText={setCallToAction} placeholder="Call to action" placeholderTextColor="#71839c" style={s.smallInput} />
            </View>
          )}

          {mode === "talking-fruits" ? (
            <View style={s.storyBox}>
              <Label>CHOOSE A STORY</Label>
              {Object.entries(STORIES).map(([key, st]) => (
                <Pressable key={key} onPress={() => setStoryKey(key)} style={[s.storyOption, storyKey === key && s.styleOptionActive]}>
                  <Text style={s.whiteText}>{st.title}</Text><Text style={s.muted}>{st.description}</Text>
                </Pressable>
              ))}
              <Label>DIALOGUE VOICE</Label>
              <View style={s.actions}>{LANGUAGES.map((l) => <Chip key={l} label={l} active={language === l} onPress={() => setLanguage(l)} />)}</View>
              <Label>SCRIPT PREVIEW</Label>
              {STORIES[storyKey].scenes.map((sc, i) => (
                <View key={i} style={s.dialogueLine}><Text style={s.cyan}>{sc.character}</Text><Text style={s.whiteText}>{sc.dialogue}</Text></View>
              ))}
              <Text style={s.muted}>Voices are synced to scenes; frame-accurate lip-sync isn't guaranteed.</Text>
            </View>
          ) : (
            <>
              <Label right={`${prompt.length}/1800`}>{mode === "ad" ? "DESCRIBE YOUR AD SCENE" : "DESCRIBE YOUR SCENE"}</Label>
              <TextInput value={prompt} onChangeText={(t) => { setPrompt(t); setVariants([]); }} multiline maxLength={1800} textAlignVertical="top"
                placeholder="A lone astronaut walks through glowing alien flowers…" placeholderTextColor="#71839c" style={s.promptInput} />
              <Pressable onPress={runDirector}><Text style={s.cyan}>✦ PROMPT DIRECTOR — GET 3 BETTER VERSIONS</Text></Pressable>
              {variants.length > 0 && (
                <View style={{ gap: 8 }}>
                  {variants.map((v) => (
                    <Pressable key={v.label} style={s.variant} onPress={() => { setPrompt(v.prompt); setVariants([]); notify(`${v.label} version applied.`); }}>
                      <Text style={s.cyan}>{v.label.toUpperCase()}</Text><Text style={s.muted} numberOfLines={3}>{v.prompt}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Label>CAMERA</Label>
              <View style={s.actions}>{CAMERAS.map((c) => <Chip key={c.id} label={c.label} active={camera === c.id} onPress={() => setCamera(c.id)} />)}</View>
              <Label>MOOD</Label>
              <View style={s.actions}>{MOODS.map((m) => <Chip key={m.id} label={m.label} active={mood === m.id} onPress={() => setMood(m.id)} />)}</View>
            </>
          )}

          <Label>VISUAL STYLE</Label>
          <View style={s.styleGrid}>
            {STYLES.map((v) => (
              <Pressable key={v} onPress={() => setStyleName(v)} style={[s.styleOption, styleName === v && s.styleOptionActive]}>
                <Text style={[s.styleOptionText, styleName === v && s.cyan]}>{v}</Text>
              </Pressable>
            ))}
          </View>

          <Label>ASPECT RATIO</Label>
          <View style={s.actions}>{[["9:16", "9:16 Reels"], ["16:9", "16:9 Wide"], ["1:1", "1:1 Square"]].map(([v, l]) => <Chip key={v} label={l} active={aspectRatio === v} onPress={() => setAspectRatio(v)} />)}</View>

          {mode !== "talking-fruits" && mode !== "photo" && (
            <>
              <Label>CLIP LENGTH</Label>
              <View style={s.actions}>{["5", "10", "15"].map((v) => <Chip key={v} label={`${v}s`} active={duration === v} onPress={() => setDuration(v)} />)}</View>
            </>
          )}
          {mode === "photo" && (<><Label>CLIP LENGTH</Label><View style={s.actions}>{["5", "10"].map((v) => <Chip key={v} label={`${v}s`} active={duration === v} onPress={() => setDuration(v)} />)}</View></>)}

          {mode !== "talking-fruits" && prompt.trim().length > 0 && (
            <View style={s.promptPreview}><Text style={s.cyan}>FINAL PROMPT</Text><Text style={s.muted}>{buildPrompt({ prompt, mode, style: styleName, camera, mood, ad: mode === "ad" ? { template: adTemplate, brandName, productName, callToAction } : null })}</Text></View>
          )}

          {!!error && <Text style={s.error}>{error}</Text>}
          <Button onPress={generate} disabled={busy || online === false || config?.maintenance}>{busy ? "GENERATING…" : "✦ GENERATE VIDEO"}</Button>
          {generatingPanel}
          <Text style={s.muted}>AI-generated content. Don't upload photos of people without their permission. Videos are kept for 7 days.</Text>
        </View>

        <View style={[s.panel, desktop && { flex: 0.9 }]}>
          <Text style={s.eyebrow}>YOUR NEXT MASTERPIECE</Text>
          <Text style={s.panelTitle}>Scene monitor</Text>
          {result ? (
            <>
              <Player uri={result.url} shareUrl={result.shareUrl} notify={notify} />
              <Text style={s.success}>VIDEO READY · SAVED TO LIBRARY</Text>
              <Button secondary small onPress={() => setResult(null)}>CREATE ANOTHER</Button>
            </>
          ) : (
            <ImageBackground source={{ uri: photoUri || SCENES[0].image }} style={s.monitor} imageStyle={{ borderRadius: 12 }}>
              <View style={s.monitorShade} />
              <View style={s.monitorCenter}>
                {busy ? <ActivityIndicator size="large" color={C.cyan} /> : <Text style={{ color: "#fff", fontSize: 38 }}>▶</Text>}
                <Text style={s.whiteText}>{busy ? "CREATING YOUR STORY" : "A WORLD UNFOLDING"}</Text>
              </View>
              <View style={s.monitorFooter}><Text style={s.tag}>{aspectRatio}</Text><Text style={s.tag}>{mode === "talking-fruits" ? "4 SCENES" : `${duration} SEC`}</Text></View>
            </ImageBackground>
          )}
          <View style={s.info}>
            {[["Mode", MODES.find((m) => m[0] === mode)[1].replace(/^\S+\s/, "")], ["Style", styleName], ["Ratio", aspectRatio]].map(([l, v]) => (
              <View key={l} style={s.infoLine}><Text style={s.muted}>{l}</Text><Text style={s.whiteText}>{v}</Text></View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );

  const explore = (
    <View style={s.section}>
      <Text style={s.eyebrow}>THE INSPIRATION WALL</Text>
      <Text style={s.sectionTitle}>Choose your universe.</Text>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search anime, fantasy, cyberpunk…" placeholderTextColor="#71839c" style={s.smallInput} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
        {["All", "Anime", "Fantasy", "Cyberpunk", "Dreamscape"].map((v) => <Chip key={v} label={v} active={category === v} onPress={() => setCategory(v)} />)}
      </ScrollView>
      <View style={s.sceneGrid}>
        {SCENES.filter((sc) => (category === "All" || category === sc.category) && `${sc.title} ${sc.category}`.toLowerCase().includes(search.toLowerCase())).map((sc) => (
          <Pressable key={sc.title} style={s.sceneCard} onPress={() => loadScene(sc)}>
            <ImageBackground source={{ uri: sc.image }} style={s.sceneImage} imageStyle={{ borderRadius: 12 }}>
              <View style={s.sceneBottom}><Text style={s.sceneTitle}>{sc.title}</Text><Text style={s.cyan}>{sc.category.toUpperCase()} · USE THIS ↗</Text></View>
            </ImageBackground>
          </Pressable>
        ))}
      </View>
      <Pressable style={[s.storyBanner, { marginTop: 24 }]} onPress={() => openCreator("talking-fruits")}>
        <Text style={{ fontSize: 32 }}>🍑 🍓</Text><Text style={s.panelTitle}>Talking Fruits Comedy</Text>
        <Text style={s.muted}>A Hindi fruit-market story with voices.</Text><Text style={s.cyan}>CREATE STORY ↗</Text>
      </Pressable>
    </View>
  );

  const shownLibrary = library.filter((i) => (!favOnly || i.fav) && `${i.title} ${i.category}`.toLowerCase().includes(libSearch.toLowerCase()));
  const libraryPage = (
    <View style={s.section}>
      <Text style={s.eyebrow}>YOUR CREATIVE ARCHIVE</Text>
      <Text style={s.sectionTitle}>Your stories.</Text>
      {library.length > 0 && (
        <>
          <TextInput value={libSearch} onChangeText={setLibSearch} placeholder="Search your videos…" placeholderTextColor="#71839c" style={s.smallInput} />
          <View style={s.actions}><Chip label="All" active={!favOnly} onPress={() => setFavOnly(false)} /><Chip label="★ Favorites" active={favOnly} onPress={() => setFavOnly(true)} /></View>
        </>
      )}
      {library.length === 0 ? (
        <View style={s.empty}><Text style={{ fontSize: 34 }}>✧</Text><Text style={s.panelTitle}>Your library is empty.</Text><Text style={s.muted}>Generated videos appear here for 7 days.</Text><Button onPress={() => openCreator("text")}>START CREATING</Button></View>
      ) : (
        <View style={[s.sceneGrid, { marginTop: 14 }]}>
          {shownLibrary.map((item) => (
            <View key={item.id} style={s.libraryCard}>
              {item.thumb ? <Image source={{ uri: item.thumb }} style={s.libThumb} resizeMode="cover" /> : null}
              <View style={s.fieldRow}>
                <Text style={[s.panelTitle, { flex: 1 }]} numberOfLines={2}>{item.title}</Text>
                <Pressable onPress={() => setLibrary((p) => p.map((x) => (x.id === item.id ? { ...x, fav: !x.fav } : x)))}><Text style={{ color: item.fav ? "#ffd666" : C.muted, fontSize: 22 }}>{item.fav ? "★" : "☆"}</Text></Pressable>
              </View>
              <Text style={s.muted}>{item.category} · {item.createdAt}</Text>
              <View style={s.actions}>
                <Button small onPress={() => { setResult(item); setMode(item.settings?.mode || "text"); go("Create"); }}>PLAY</Button>
                <Button small secondary onPress={() => remix(item)}>REMIX</Button>
                <Button small secondary onPress={() => removeItem(item)}>DELETE</Button>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const helpPage = (
    <View style={s.section}>
      <Text style={s.eyebrow}>HELP & SAFETY</Text>
      <Text style={s.sectionTitle}>Questions, answered.</Text>
      {FAQ.map(([q, a], i) => (
        <Pressable key={q} style={s.faq} onPress={() => setFaqOpen(faqOpen === i ? -1 : i)}>
          <Text style={s.whiteText}>{faqOpen === i ? "− " : "+ "}{q}</Text>
          {faqOpen === i && <Text style={[s.mutedParagraph, { marginTop: 8, marginBottom: 0 }]}>{a}</Text>}
        </Pressable>
      ))}
      <View style={[s.actions, { marginTop: 18 }]}>
        <Button small secondary onPress={() => Linking.openURL(`${API}/terms`)}>TERMS</Button>
        <Button small secondary onPress={() => Linking.openURL(`${API}/privacy`)}>PRIVACY</Button>
        <Button small secondary onPress={() => Linking.openURL("mailto:support@vyra.ai")}>CONTACT SUPPORT</Button>
      </View>
    </View>
  );

  const settingsPage = (
    <View style={s.section}>
      <Text style={s.eyebrow}>SETTINGS</Text>
      <Text style={s.sectionTitle}>Your account.</Text>
      <View style={s.panel}>
        <Text style={s.panelTitle}>VYRA account</Text>
        {session ? (
          <>
            <Text style={s.muted}>Signed in as {session.user?.email || "your account"}</Text>
            <Text style={s.muted}>{quotaText}</Text>
            <Button small secondary disabled={authBusy} onPress={signOut}>{authBusy ? "PLEASE WAIT…" : "SIGN OUT"}</Button>
          </>
        ) : (
          <>
            <Text style={s.muted}>Create an account or sign in. Each account gets 3 lifetime video-generation trials.</Text>
            <TextInput value={authEmail} onChangeText={setAuthEmail} placeholder="Email address" placeholderTextColor="#71839c" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={s.smallInput} />
            <TextInput value={authPassword} onChangeText={setAuthPassword} placeholder="Password (at least 6 characters)" placeholderTextColor="#71839c" secureTextEntry autoCapitalize="none" style={s.smallInput} />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button small disabled={authBusy || !authReady} onPress={signIn}>{authBusy ? "PLEASE WAIT…" : "SIGN IN"}</Button>
              <Button small secondary disabled={authBusy || !authReady} onPress={signUp}>CREATE ACCOUNT</Button>
            </View>
          </>
        )}
        {!!authMessage && <Text style={s.muted}>{authMessage}</Text>}
        <Text style={s.panelTitle}>Access code</Text>
        <Text style={s.muted}>{config?.accessRequired ? "This server needs an invite code as an extra step after sign-in." : "No invite code is required on this server."}</Text>
        {config?.accessRequired && <>
          <TextInput value={code} onChangeText={setCode} placeholder="Access code" placeholderTextColor="#71839c" autoCapitalize="none" autoCorrect={false} style={s.smallInput} />
          <Button small onPress={saveCode}>SAVE CODE</Button>
        </>}
        <Text style={s.panelTitle}>Server</Text>
        <Text style={s.muted}>{online === null ? "Checking…" : online ? "● Connected" : "● Offline"}{quotaText ? ` · ${quotaText}` : ""}</Text>
        <Button small secondary onPress={loadConfig}>REFRESH STATUS</Button>
        <Text style={s.panelTitle}>Data</Text>
        <Text style={s.muted}>Your library is stored on this device. Clearing it doesn't delete the shared links you've already sent.</Text>
        <Button small secondary onPress={() => { setLibrary([]); notify("Library cleared on this device."); }}>CLEAR LIBRARY</Button>
      </View>
    </View>
  );

  return (
    <View style={s.app}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      {header}{mobileMenu}{statusBanner}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {page === "Home" && (
          <>
            {welcomeCard}{hero}
            <View style={s.section}>
              <Text style={s.eyebrow}>STEP INSIDE THE STORY</Text>
              <Text style={s.sectionTitle}>Every world starts somewhere.</Text>
              <View style={[s.featureGrid, !tablet && { flexDirection: "column" }]}>
                {[["✦", "Text to Video", "Describe a scene.", () => openCreator("text")], ["▧", "Photo to Video", "Animate any photo.", () => { choosePhoto(); }], ["◈", "Ad Studio", "Product videos in minutes.", () => openCreator("ad")], ["🍓", "Talking Fruits", "Hindi comedy stories.", () => openCreator("talking-fruits")]].map(([ic, t, d, fn]) => (
                  <Pressable key={t} style={s.featureCard} onPress={fn}><Text style={s.featureIcon}>{ic}</Text><Text style={s.whiteText}>{t}</Text><Text style={s.muted}>{d}</Text></Pressable>
                ))}
              </View>
            </View>
            {explore}
          </>
        )}
        {page === "Create" && creator}
        {page === "Explore" && explore}
        {page === "Library" && libraryPage}
        {page === "Help" && helpPage}
        {page === "Settings" && settingsPage}
        <View style={s.footer}>
          <Text style={s.logoText}>VYRA <Text style={s.cyan}>AI</Text></Text>
          <Text style={s.muted}>DREAM IN MOTION. CREATE YOUR WORLD.</Text>
          <Text style={s.muted}>AI-generated content · v2.0</Text>
        </View>
      </ScrollView>
      {!!toast && <View style={s.toast} pointerEvents="none"><Text style={s.toastText}>{toast}</Text></View>}
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, minHeight: "100%", backgroundColor: C.bg },
  header: { minHeight: 76, paddingHorizontal: 24, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, backgroundColor: "#050a13", borderBottomWidth: 1, borderBottomColor: C.border },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: { height: 42, width: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#173347", borderWidth: 1, borderColor: C.cyan },
  logoLetter: { fontSize: 27, fontWeight: "900", color: C.cyan },
  logoText: { color: C.white, fontSize: 18, fontWeight: "900", letterSpacing: 2 },
  logoCaption: { color: C.muted, fontSize: 8, letterSpacing: 1.5, marginTop: 4 },
  cyan: { color: C.cyan, fontSize: 11, fontWeight: "700" },
  nav: { flexDirection: "row", alignItems: "center", gap: 4 },
  navItem: { paddingHorizontal: 11, paddingVertical: 10, borderRadius: 7 },
  navItemActive: { backgroundColor: "#142d3e" },
  navText: { color: "#cbd8e9", fontSize: 11, fontWeight: "700" },
  menuButton: { padding: 10, backgroundColor: C.panel, borderRadius: 7 },
  mobileMenu: { backgroundColor: C.panel, paddingHorizontal: 16 },
  mobileMenuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  banner: { backgroundColor: "#3a2a12", paddingVertical: 9, paddingHorizontal: 18 },
  bannerText: { color: "#ffd9a0", fontSize: 11, lineHeight: 17 },
  button: { minHeight: 43, paddingHorizontal: 17, paddingVertical: 12, borderRadius: 7, backgroundColor: C.cyan, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.cyan },
  buttonSmall: { minHeight: 36, paddingVertical: 8, paddingHorizontal: 13 },
  secondaryButton: { backgroundColor: "#102235", borderColor: "rgba(121,239,255,0.45)" },
  buttonText: { color: "#04101c", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  hero: { minHeight: 560, justifyContent: "center", padding: 50, overflow: "hidden", backgroundColor: "#071725" },
  heroMobile: { padding: 22 },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(2,10,24,0.66)" },
  heroContent: { maxWidth: 850, width: "100%", alignSelf: "center" },
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "rgba(121,239,255,0.4)", borderRadius: 30, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "rgba(4,15,29,0.72)", marginBottom: 27 },
  dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: C.green },
  badgeText: { color: C.white, fontSize: 8, letterSpacing: 1.1, fontWeight: "800" },
  heroEyebrow: { color: C.cyan, fontSize: 10, letterSpacing: 4, marginBottom: 18 },
  heroTitle: { color: C.white, fontSize: 55, lineHeight: 63, fontWeight: "900", fontFamily: Platform.OS === "web" ? "Georgia, serif" : "serif" },
  heroTitleMobile: { fontSize: 35, lineHeight: 43 },
  heroDescription: { color: "#d4e1f1", fontSize: 14, lineHeight: 23, maxWidth: 500, marginTop: 20, marginBottom: 26 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  heroFoot: { color: "#c1d2e9", fontSize: 8, letterSpacing: 1.5, marginTop: 32 },
  section: { width: "100%", maxWidth: 1180, alignSelf: "center", paddingHorizontal: 24, paddingTop: 40, paddingBottom: 18 },
  eyebrow: { color: C.cyan, fontSize: 9, fontWeight: "900", letterSpacing: 1.8, marginBottom: 10 },
  sectionTitle: { color: C.white, fontSize: 30, lineHeight: 38, fontWeight: "700", fontFamily: Platform.OS === "web" ? "Georgia, serif" : "serif", marginBottom: 14 },
  muted: { color: C.muted, fontSize: 11, lineHeight: 17 },
  mutedParagraph: { color: C.muted, fontSize: 12, lineHeight: 21, marginBottom: 16, maxWidth: 650 },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 13 },
  featureCard: { flex: 1, minWidth: 170, minHeight: 135, padding: 19, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12, gap: 8 },
  featureIcon: { color: C.cyan, fontSize: 26, marginBottom: 4 },
  creatorGrid: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  panel: { flex: 1, minWidth: 0, padding: 20, marginBottom: 22, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 14, gap: 12 },
  panelTitle: { color: C.white, fontSize: 16, fontWeight: "900" },
  tabs: { flexDirection: "row", flexWrap: "wrap", padding: 4, backgroundColor: "#050b15", borderRadius: 8, gap: 5, marginBottom: 6 },
  tab: { flexGrow: 1, padding: 11, borderRadius: 6, alignItems: "center" },
  tabActive: { backgroundColor: "#173347", borderWidth: 1, borderColor: C.border },
  tabText: { color: C.muted, fontSize: 10, fontWeight: "700" },
  uploadBox: { alignItems: "center", gap: 9, padding: 22, borderWidth: 1, borderStyle: "dashed", borderColor: C.cyan, borderRadius: 10 },
  uploadImage: { width: 110, height: 110, borderRadius: 10 },
  whiteText: { color: C.white, fontSize: 11, fontWeight: "700" },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  fieldLabel: { color: "#a2b6ce", fontSize: 9, letterSpacing: 1, fontWeight: "900", marginTop: 6 },
  promptInput: { minHeight: 135, color: C.white, backgroundColor: "#060d19", borderWidth: 1, borderColor: C.border, borderRadius: 9, padding: 13, fontSize: 13, lineHeight: 20 },
  smallInput: { color: C.white, backgroundColor: "#0d1a2b", borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 12, fontSize: 12 },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  styleOption: { width: "30%", minWidth: 100, flexGrow: 1, padding: 11, borderRadius: 7, backgroundColor: "#09111e", borderWidth: 1, borderColor: C.border },
  styleOptionActive: { backgroundColor: "#143043", borderColor: C.cyan },
  styleOptionText: { color: C.white, fontSize: 10, fontWeight: "700" },
  pill: { paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: C.border, borderRadius: 7 },
  pillActive: { borderColor: C.cyan, backgroundColor: "#173747" },
  error: { color: C.red, fontSize: 12, lineHeight: 18, padding: 12, backgroundColor: "#321722", borderRadius: 8 },
  success: { color: C.green, fontSize: 10, lineHeight: 18, paddingVertical: 4, fontWeight: "800" },
  promptPreview: { padding: 12, borderRadius: 8, backgroundColor: "#071522", borderWidth: 1, borderColor: C.border, gap: 6 },
  variant: { padding: 12, borderRadius: 8, backgroundColor: "#0a1a2b", borderWidth: 1, borderColor: C.border, gap: 4 },
  progressBox: { gap: 10, padding: 12, backgroundColor: "#07101d", borderRadius: 9, borderWidth: 1, borderColor: C.border },
  progressTrack: { height: 6, borderRadius: 4, backgroundColor: "#12263a", overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: C.cyan },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  quotaTag: { color: C.green, fontSize: 10, fontWeight: "800", borderWidth: 1, borderColor: "rgba(120,244,192,0.4)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  monitor: { width: "100%", minHeight: 300, justifyContent: "space-between", overflow: "hidden", borderRadius: 12, backgroundColor: "#071421", borderWidth: 1, borderColor: C.border },
  monitorShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(3,11,24,0.5)" },
  monitorCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 18 },
  monitorFooter: { flexDirection: "row", justifyContent: "space-between", gap: 8, padding: 12 },
  nativeVideo: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: "#02050a" },
  tag: { color: C.white, fontSize: 8, letterSpacing: 1, backgroundColor: "rgba(3,10,20,0.75)", padding: 8, borderRadius: 5, overflow: "hidden" },
  sceneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  sceneCard: { flexGrow: 1, flexBasis: 280, minWidth: 220, maxWidth: 560, height: 240, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: C.border },
  sceneImage: { flex: 1, justifyContent: "flex-end" },
  sceneBottom: { padding: 16, backgroundColor: "rgba(3,9,19,0.78)" },
  sceneTitle: { color: C.white, fontSize: 19, fontWeight: "800", marginBottom: 8 },
  info: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 14, gap: 10 },
  infoLine: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  storyBox: { padding: 12, backgroundColor: "#07101d", borderRadius: 10, gap: 10 },
  storyOption: { padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 8, gap: 5 },
  dialogueLine: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  storyBanner: { padding: 20, borderRadius: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, gap: 10 },
  libraryCard: { flex: 1, flexBasis: 260, minWidth: 240, maxWidth: 560, gap: 10, padding: 14, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  libThumb: { width: "100%", height: 170, borderRadius: 9, backgroundColor: "#07101d" },
  faq: { padding: 16, backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  footer: { padding: 26, marginTop: 20, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: "#040811", alignItems: "center", gap: 10 },
  empty: { alignItems: "center", padding: 36, backgroundColor: C.panel, borderRadius: 12, gap: 14 },
  toast: { position: "absolute", bottom: 28, alignSelf: "center", backgroundColor: "#173347", borderWidth: 1, borderColor: C.cyan, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, maxWidth: "90%" },
  toastText: { color: C.white, fontSize: 12, fontWeight: "700" },
});
