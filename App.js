
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

const API = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:8787"
).replace(/\/$/, "");

const C = {
  bg: "#090914",
  panel: "#131323",
  panel2: "#1b1930",
  line: "rgba(255,255,255,0.09)",
  white: "#faf8ff",
  muted: "#a19dbb",
  purple: "#9b72ff",
  pink: "#f26ec8",
  green: "#7de6bd",
};

const IMAGES = {
  portrait:
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1000&q=85",
  fashion:
    "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=85",
  anime:
    "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=900&q=85",
  mountains:
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=900&q=85",
  city:
    "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=85",
  nature:
    "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=900&q=85",
};

const GALLERY = [
  {
    title: "Golden Hour",
    category: "Cinematic",
    image: IMAGES.portrait,
    prompt:
      "A cinematic close-up portrait of a woman during golden hour, gentle wind moving her hair, natural skin texture, slow camera push-in, soft background bokeh, beautiful film color grading.",
  },
  {
    title: "Anime Dreams",
    category: "Anime",
    image: IMAGES.anime,
    prompt:
      "A beautiful anime-inspired fantasy scene, glowing cherry blossoms, petals drifting through the air, expressive characters, dreamy twilight, smooth cinematic camera movement and richly detailed animation.",
  },
  {
    title: "Wild Horizons",
    category: "Fantasy",
    image: IMAGES.mountains,
    prompt:
      "A cinematic aerial journey above dramatic mountains at sunrise, clouds flowing between the peaks, golden light, sweeping camera movement and epic atmospheric scenery.",
  },
  {
    title: "Neon Nights",
    category: "Cinematic",
    image: IMAGES.city,
    prompt:
      "A stylish young adult walking through a neon-lit city at night, reflections on wet pavement, colorful lights, cinematic tracking shot, atmospheric depth and premium music-video aesthetics.",
  },
  {
    title: "Editorial",
    category: "Fashion",
    image: IMAGES.fashion,
    prompt:
      "A high-fashion editorial video with a confident model, elegant fabric moving in the breeze, dramatic studio lighting, graceful camera orbit and a luxury magazine aesthetic.",
  },
  {
    title: "Dreamscape",
    category: "Fantasy",
    image: IMAGES.nature,
    prompt:
      "A dreamy cinematic landscape with glowing clouds, mist rolling over green hills, warm sunbeams, drifting particles and a slow sweeping camera movement.",
  },
];

const STYLES = [
  ["Cinematic", "🎬", "#9b72ff"],
  ["Anime", "🌸", "#f26ec8"],
  ["Realistic", "📸", "#6e9cff"],
  ["Fantasy", "✨", "#ffb86b"],
  ["Dreamy", "☁️", "#75d8df"],
  ["Fashion", "💎", "#ff7d9a"],
];

function Label({ children }) {
  return <Text style={s.label}>{children}</Text>;
}

function Button({ children, onPress, secondary, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        secondary && s.buttonSecondary,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={s.buttonText}>{children}</Text>
    </Pressable>
  );
}

function Heading({ eyebrow, title, action }) {
  return (
    <View style={s.heading}>
      <View>
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
        <Text style={s.headingTitle}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

function GalleryCard({ item, onPress }) {
  return (
    <Pressable onPress={onPress} style={s.galleryCard}>
      <ImageBackground
        source={{ uri: item.image }}
        resizeMode="cover"
        style={s.galleryImage}
        imageStyle={{ borderRadius: 17 }}
      >
        <View style={s.imageOverlay} />
        <View style={s.imageTop}>
          <Text style={s.imageTag}>{item.category.toUpperCase()}</Text>
          <View style={s.playCircle}>
            <Text style={{ color: "#fff" }}>▶</Text>
          </View>
        </View>
        <View style={s.imageBottom}>
          <Text style={s.imageTitle}>{item.title}</Text>
          <Text style={s.imageSubtitle}>Tap to use this idea ↗</Text>
        </View>
      </ImageBackground>
    </Pressable>
  );
}

function VideoResult({ uri }) {
  if (!uri) return null;

  if (Platform.OS === "web") {
    return React.createElement("video", {
      src: uri,
      controls: true,
      playsInline: true,
      style: {
        width: "100%",
        maxHeight: 480,
        borderRadius: 16,
        backgroundColor: "#05050a",
      },
    });
  }

  return (
    <View style={s.resultBox}>
      <Text style={s.resultTitle}>Your video is ready</Text>
      <Text selectable style={s.resultUrl}>{uri}</Text>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const desktop = width >= 1050;
  const tablet = width >= 700;

  const [page, setPage] = useState("Home");
  const [mode, setMode] = useState("text");
  const [prompt, setPrompt] = useState("");
  const [visualStyle, setVisualStyle] = useState("Cinematic");
  const [ratio, setRatio] = useState("9:16");
  const [duration, setDuration] = useState("5");
  const [photoUri, setPhotoUri] = useState("");
  const [photoData, setPhotoData] = useState("");
  const [apiOnline, setApiOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [library, setLibrary] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    fetch(`${API}/api/health`)
      .then((r) => {
        if (!r.ok) throw new Error("API offline");
        return r.json();
      })
      .then(() => active && setApiOnline(true))
      .catch(() => active && setApiOnline(false));

    return () => {
      active = false;
    };
  }, []);

  const navigate = (nextPage) => {
    setPage(nextPage);
    setMenuOpen(false);
  };

  const create = (nextMode = "text") => {
    setMode(nextMode);
    setPage("Create");
    setError("");
    setMessage("");
    setVideoUrl("");
  };

  const choosePhoto = async () => {
    setError("");

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.85,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];

        setPhotoUri(asset.uri);
        setPhotoData(
          asset.base64
            ? `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`
            : asset.uri
        );

        setMode("photo");
        setPage("Create");
      }
    } catch {
      setError(
        "The photo picker could not open. Check that expo-image-picker is installed."
      );
    }
  };

  const useIdea = (item) => {
    setPrompt(item.prompt);
    setVisualStyle(item.category);
    setMode("text");
    setError("");
    setMessage("");
    setVideoUrl("");
    setPage("Create");
  };

  const enhancePrompt = () => {
    const extra =
      " Cinematic lighting, natural motion, smooth camera movement, detailed textures, realistic depth of field, polished color grading, no flicker.";

    if (!prompt.trim()) {
      setPrompt(
        "A young woman walking through a glowing garden at twilight, petals floating around her, gentle wind moving her hair, cinematic camera movement, beautiful lighting, smooth motion and detailed textures."
      );
    } else if (!prompt.toLowerCase().includes("camera movement")) {
      setPrompt(prompt.trim().replace(/[.! ]*$/, "") + "." + extra);
    }
  };

  const generate = async () => {
    setError("");
    setMessage("");
    setVideoUrl("");

    if (!prompt.trim()) {
      setError("Describe your scene before generating a video.");
      return;
    }

    if (mode === "photo" && !photoData) {
      setError("Choose a photo before using Photo to Video.");
      return;
    }

    if (!apiOnline) {
      setError(
        `VYRA cannot reach ${API}. Start your backend with node server.js and retry.`
      );
      return;
    }

    setBusy(true);
    setMessage("Sending your scene to the AI video generator...");

    try {
      const response = await fetch(`${API}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "vyra-web-user",
          prompt: prompt.trim(),
          style: visualStyle,
          duration: Number(duration),
          aspectRatio: ratio,
          mode,
          imageData: mode === "photo" ? photoData : null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || data.message || `Generation failed (${response.status}).`
        );
      }

      const url =
        data.videoUrl ||
        data.video_url ||
        data.output?.video?.url ||
        data.output?.video_url ||
        data.result?.video?.url ||
        data.data?.video?.url ||
        data.url;

      if (!url) {
        throw new Error(
          data.request_id || data.requestId
            ? "The server returned a job ID but no finished video URL. Your backend needs to poll the AI job until completion."
            : "No video URL was returned. Check the response from server.js."
        );
      }

      setVideoUrl(url);
      setMessage("Your video was generated successfully.");

      setLibrary((old) => [
        {
          id: `${Date.now()}`,
          title: prompt.trim().slice(0, 45),
          style: visualStyle,
          url,
          image: photoUri || IMAGES.portrait,
          createdAt: new Date().toLocaleString(),
        },
        ...old,
      ]);
    } catch (e) {
      setError(e.message || "Video generation failed.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const nav = [
    ["Home", "⌂"],
    ["Create", "✦"],
    ["Explore", "▦"],
    ["Library", "▤"],
  ];

  const sidebar = (
    <View style={[s.sidebar, !desktop && s.mobileSidebar]}>
      <Pressable onPress={() => navigate("Home")} style={s.brand}>
        <View style={s.brandIcon}>
          <Text style={s.brandV}>V</Text>
        </View>
        <View>
          <Text style={s.brandName}>
            VYRA <Text style={{ color: C.purple }}>AI</Text>
          </Text>
          <Text style={s.brandCaption}>CREATIVE STUDIO</Text>
        </View>
      </Pressable>

      <Label>WORKSPACE</Label>

      {nav.map(([name, icon]) => (
        <Pressable
          key={name}
          onPress={() => navigate(name)}
          style={[s.navItem, page === name && s.navActive]}
        >
          <Text style={[s.navIcon, page === name && { color: C.purple }]}>
            {icon}
          </Text>
          <Text style={[s.navText, page === name && { color: "#fff" }]}>
            {name}
          </Text>
        </Pressable>
      ))}

      <View style={{ height: 26 }} />
      <Label>QUICK TOOLS</Label>

      <Pressable onPress={choosePhoto} style={s.navItem}>
        <Text style={s.navIcon}>▧</Text>
        <Text style={s.navText}>Animate a photo</Text>
      </Pressable>

      <Pressable onPress={() => navigate("Explore")} style={s.navItem}>
        <Text style={s.navIcon}>✧</Text>
        <Text style={s.navText}>AI styles</Text>
      </Pressable>

      <View style={{ flex: 1, minHeight: 35 }} />

      <View style={s.promo}>
        <Text style={s.promoIcon}>✦</Text>
        <Text style={s.promoTitle}>Have a story to tell?</Text>
        <Text style={s.promoSub}>Turn a spark of an idea into a moving scene.</Text>
        <Button onPress={() => create("text")}>Start creating ↗</Button>
      </View>

      <View style={s.profile}>
        <View style={s.avatar}><Text style={{ fontWeight: "900" }}>V</Text></View>
        <View>
          <Text style={s.profileName}>Creator Studio</Text>
          <Text style={s.muted}>Personal workspace</Text>
        </View>
      </View>
    </View>
  );

  const home = (
    <>
      <View style={[s.hero, !desktop && s.heroStack]}>
        <View style={s.heroCopy}>
          <View style={s.statusBadge}>
            <View style={[s.dot, { backgroundColor: apiOnline ? C.green : "#ffbd75" }]} />
            <Text style={s.statusText}>
              {apiOnline ? "STUDIO CONNECTED" : "YOUR CREATIVE UNIVERSE"}
            </Text>
          </View>

          <Text style={s.heroTitle}>
            Your imagination,{"\n"}in <Text style={{ color: C.purple }}>motion.</Text>
          </Text>

          <Text style={s.heroSub}>
            Create cinematic videos from a sentence or a single photo.
            Your next story starts here.
          </Text>

          <View style={[s.heroButtons, !tablet && { flexDirection: "column" }]}>
            <Button onPress={() => create("text")}>✦  Create a video</Button>
            <Button secondary onPress={choosePhoto}>▧  Animate a photo</Button>
          </View>

          <View style={s.stats}>
            <View><Text style={s.statNumber}>01</Text><Text style={s.muted}>Idea needed</Text></View>
            <View style={s.statLine} />
            <View><Text style={s.statNumber}>AI</Text><Text style={s.muted}>Powered motion</Text></View>
            <View style={s.statLine} />
            <View><Text style={s.statNumber}>∞</Text><Text style={s.muted}>Ways to create</Text></View>
          </View>
        </View>

        <View style={s.heroImageWrap}>
          <ImageBackground
            source={{ uri: IMAGES.portrait }}
            style={s.heroImage}
            imageStyle={{ borderRadius: 22 }}
          >
            <View style={s.heroImageShade} />
            <View style={s.floatingLabel}>
              <Text style={{ fontSize: 20 }}>✧</Text>
              <View>
                <Text style={s.floatingTitle}>A story in the making</Text>
                <Text style={s.muted}>Portraits · AI motion</Text>
              </View>
            </View>
            <View style={s.heroPlay}><Text style={{ color: "#fff", fontSize: 22 }}>▶</Text></View>
            <View style={s.heroImageBottom}>
              <Text style={s.heroImageTitle}>Beyond the ordinary</Text>
              <Text style={s.heroImageSub}>CINEMATIC · VYRA AI</Text>
            </View>
          </ImageBackground>
        </View>
      </View>

      <Heading eyebrow="YOUR CREATIVE WORKSPACE" title="What are we creating today?" />

      <View style={[s.modeGrid, !tablet && { flexDirection: "column" }]}>
        <Pressable onPress={() => create("text")} style={s.modeCard}>
          <View style={s.modeIcon}><Text style={{ fontSize: 24 }}>✦</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.modeTitle}>Text to Video</Text>
            <Text style={s.modeSub}>Describe a scene. Bring it to life.</Text>
          </View>
          <Text style={s.arrow}>↗</Text>
        </Pressable>

        <Pressable onPress={choosePhoto} style={s.modeCard}>
          <View style={[s.modeIcon, { backgroundColor: "#39203c" }]}>
            <Text style={{ fontSize: 24 }}>▧</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.modeTitle}>Photo to Video</Text>
            <Text style={s.modeSub}>Give your favourite image motion.</Text>
          </View>
          <Text style={s.arrow}>↗</Text>
        </Pressable>
      </View>

      <Heading
        eyebrow="A LITTLE INSPIRATION"
        title="Explore visual worlds"
        action={
          <Pressable onPress={() => navigate("Explore")}>
            <Text style={s.link}>View all ↗</Text>
          </Pressable>
        }
      />

      <View style={[s.galleryGrid, !tablet && { flexDirection: "column" }]}>
        {GALLERY.slice(0, tablet ? 3 : 2).map((item) => (
          <GalleryCard key={item.title} item={item} onPress={() => useIdea(item)} />
        ))}
      </View>

      <View style={s.quote}>
        <Text style={{ fontSize: 42, color: C.purple }}>“</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.quoteText}>
            More than a video generator. A doorway into the worlds in your head.
          </Text>
          <Text style={s.quoteCaption}>YOUR STORY. YOUR STYLE. YOUR VYRA.</Text>
        </View>
      </View>
    </>
  );

  const createPage = (
    <>
      <View style={s.pageIntro}>
        <Text style={s.eyebrow}>THE CREATIVE ROOM</Text>
        <Text style={s.pageTitle}>Make it move.</Text>
        <Text style={s.muted}>Set the scene. Pick a style. Let VYRA do the heavy lifting.</Text>
      </View>

      <View style={[s.createGrid, !desktop && { flexDirection: "column" }]}>
        <View style={[s.panel, desktop && { flex: 1.1 }]}>
          <View style={s.panelHeading}>
            <View>
              <Text style={s.panelTitle}>Your video brief</Text>
              <Text style={s.muted}>A little detail makes a big difference.</Text>
            </View>
            <Text style={s.step}>STEP 01</Text>
          </View>

          <View style={s.switchRow}>
            {["text", "photo"].map((m) => (
              <Pressable
                key={m}
                onPress={() => { setMode(m); setError(""); }}
                style={[s.switchButton, mode === m && s.switchActive]}
              >
                <Text style={[s.switchText, mode === m && { color: "#fff" }]}>
                  {m === "text" ? "✦ Text to Video" : "▧ Photo to Video"}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === "photo" && (
            <Pressable onPress={choosePhoto} style={s.upload}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={s.uploadImage} />
              ) : (
                <Text style={{ fontSize: 28, color: C.purple }}>↑</Text>
              )}
              <Text style={s.uploadTitle}>
                {photoUri ? "Photo ready" : "Choose a photo"}
              </Text>
              <Text style={s.muted}>JPG, PNG or WEBP</Text>
              <Text style={s.link}>Browse images ↗</Text>
            </Pressable>
          )}

          <View style={s.fieldRow}>
            <Label>DESCRIBE YOUR SCENE</Label>
            <Text style={s.muted}>{prompt.length}/1200</Text>
          </View>

          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            maxLength={1200}
            placeholder={
              mode === "photo"
                ? "How should your photo move? Describe the camera, light and atmosphere..."
                : "A young woman walking through a neon garden at twilight, petals floating around her..."
            }
            placeholderTextColor="#77748f"
            textAlignVertical="top"
            style={s.promptInput}
          />

          <View style={s.promptTools}>
            <Text style={s.muted}>✧ Mention movement, lighting and camera angle.</Text>
            <Pressable onPress={enhancePrompt}><Text style={s.link}>✦ Enhance prompt</Text></Pressable>
          </View>

          <Label>CHOOSE A VISUAL STYLE</Label>
          <View style={s.styleGrid}>
            {STYLES.map(([name, emoji, color]) => (
              <Pressable
                key={name}
                onPress={() => setVisualStyle(name)}
                style={[
                  s.styleCard,
                  visualStyle === name && {
                    borderColor: color,
                    backgroundColor: `${color}18`,
                  },
                ]}
              >
                <Text style={{ fontSize: 19 }}>{emoji}</Text>
                <Text style={s.styleText}>{name}</Text>
                {visualStyle === name && <Text style={{ color }}>✓</Text>}
              </Pressable>
            ))}
          </View>

          <View style={s.options}>
            <View style={{ flex: 1 }}>
              <Label>ASPECT RATIO</Label>
              <View style={s.pills}>
                {["9:16", "16:9", "1:1"].map((v) => (
                  <Pressable key={v} onPress={() => setRatio(v)} style={[s.pill, ratio === v && s.pillActive]}>
                    <Text style={s.pillText}>{v}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={{ flex: 1 }}>
              <Label>DURATION</Label>
              <View style={s.pills}>
                {["5", "10"].map((v) => (
                  <Pressable key={v} onPress={() => setDuration(v)} style={[s.pill, duration === v && s.pillActive]}>
                    <Text style={s.pillText}>{v}s</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <View style={s.apiLine}>
            <View style={[s.dot, { backgroundColor: apiOnline ? C.green : "#ffbd75" }]} />
            <Text style={s.muted}>{apiOnline ? "Backend connected" : "Backend offline"} · {API}</Text>
          </View>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>⚠ {error}</Text></View> : null}
          {message ? <View style={s.messageBox}><Text style={s.messageText}>✦ {message}</Text></View> : null}

          <Button onPress={generate} disabled={busy}>
            {busy ? "◌  Creating your video..." : "✦  Generate video"}
          </Button>

          <Text style={s.disclaimer}>
            Video generation requires a working AI provider and available API credits.
          </Text>
        </View>

        <View style={[s.panel, desktop && { flex: 0.9 }]}>
          <View style={s.panelHeading}>
            <View>
              <Text style={s.panelTitle}>Your preview</Text>
              <Text style={s.muted}>Your next scene is yours.</Text>
            </View>
            <Text style={s.step}>{videoUrl ? "READY" : busy ? "WORKING" : "STANDBY"}</Text>
          </View>

          {videoUrl ? (
            <View style={{ gap: 14 }}>
              <VideoResult uri={videoUrl} />
              <Button secondary onPress={() => {
                if (Platform.OS === "web") window.open(videoUrl, "_blank", "noopener,noreferrer");
              }}>
                ↗ Open video in new tab
              </Button>
              <Button onPress={() => { setVideoUrl(""); setMessage(""); }}>
                ＋ Create another
              </Button>
            </View>
          ) : (
            <ImageBackground
              source={{ uri: photoUri || (visualStyle === "Anime" ? IMAGES.anime : IMAGES.nature) }}
              style={s.preview}
              imageStyle={{ borderRadius: 18 }}
            >
              <View style={s.previewShade} />
              <View style={{ alignItems: "center", padding: 18 }}>
                {busy ? <ActivityIndicator size="large" color={C.purple} /> : <View style={s.previewPlay}><Text style={{ color: "#fff", fontSize: 24 }}>▶</Text></View>}
                <Text style={s.previewTitle}>{busy ? "Bringing your scene to life" : "Your next favourite scene"}</Text>
                <Text style={s.muted}>{busy ? "Waiting for the AI model..." : "Your generated video will appear here"}</Text>
              </View>
              <View style={s.previewMeta}>
                <Text style={s.metaText}>{visualStyle.toUpperCase()}</Text>
                <Text style={s.metaText}>{ratio} · {duration}s</Text>
              </View>
            </ImageBackground>
          )}

          <View style={s.settings}>
            <Label>CREATION SETTINGS</Label>
            {[
              ["Mode", mode === "text" ? "Text to video" : "Photo to video"],
              ["Style", visualStyle],
              ["Aspect ratio", ratio],
              ["Duration", `${duration} seconds`],
            ].map(([k, v]) => (
              <View key={k} style={s.settingRow}>
                <Text style={s.muted}>{k}</Text>
                <Text style={s.settingValue}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </>
  );

  const explore = (
    <>
      <View style={s.pageIntro}>
        <Text style={s.eyebrow}>THE INSPIRATION WALL</Text>
        <Text style={s.pageTitle}>Find your visual language.</Text>
        <Text style={s.muted}>Pick a world. Borrow a mood. Make it yours.</Text>
      </View>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search visual styles..."
        placeholderTextColor={C.muted}
        style={s.search}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 18 }}>
        {["All", "Cinematic", "Anime", "Fantasy", "Fashion"].map((v) => (
          <Pressable key={v} onPress={() => setFilter(v)} style={[s.pill, filter === v && s.pillActive]}>
            <Text style={s.pillText}>{v}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.galleryGrid, !tablet && { flexDirection: "column" }]}>
        {GALLERY.filter((item) =>
          (filter === "All" || item.category === filter) &&
          `${item.title} ${item.category}`.toLowerCase().includes(search.toLowerCase())
        ).map((item) => (
          <GalleryCard key={item.title} item={item} onPress={() => useIdea(item)} />
        ))}
      </View>
    </>
  );

  const libraryPage = (
    <>
      <View style={s.pageIntro}>
        <Text style={s.eyebrow}>YOUR CREATIVE HISTORY</Text>
        <Text style={s.pageTitle}>My library.</Text>
        <Text style={s.muted}>Your generated videos, all in one place.</Text>
      </View>

      {library.length ? (
        <View style={[s.libraryGrid, !tablet && { flexDirection: "column" }]}>
          {library.map((item) => (
            <View key={item.id} style={s.libraryCard}>
              <GalleryCard
                item={{ title: item.title, category: item.style, image: item.image }}
                onPress={() => { setVideoUrl(item.url); setPage("Create"); }}
              />
              <Text style={s.muted}>{item.createdAt}</Text>
              <Button secondary onPress={() => { setVideoUrl(item.url); setPage("Create"); }}>
                Play video ↗
              </Button>
            </View>
          ))}
        </View>
      ) : (
        <View style={s.empty}>
          <Text style={{ fontSize: 35, color: C.purple }}>▤</Text>
          <Text style={s.panelTitle}>Your next creation belongs here.</Text>
          <Text style={[s.muted, { textAlign: "center", lineHeight: 20 }]}>
            Videos you generate will appear here during this session.
          </Text>
          <Button onPress={() => create("text")}>✦ Create your first video</Button>
        </View>
      )}
    </>
  );

  return (
    <View style={s.app}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {!desktop && menuOpen ? (
        <View style={s.drawer}>
          {sidebar}
          <Pressable onPress={() => setMenuOpen(false)} style={s.closeDrawer}>
            <Text style={{ color: "#fff", fontSize: 20 }}>×</Text>
          </Pressable>
        </View>
      ) : null}

      {desktop ? sidebar : null}

      <View style={s.main}>
        <View style={s.topbar}>
          {!desktop && (
            <Pressable onPress={() => setMenuOpen(!menuOpen)} style={s.menuButton}>
              <Text style={{ color: "#fff", fontSize: 20 }}>☰</Text>
            </Pressable>
          )}

          <View style={{ flex: 1, flexDirection: "row", gap: 9, alignItems: "center" }}>
            <Text style={s.muted}>Workspace</Text>
            <Text style={{ color: "#625e7b" }}>/</Text>
            <Text style={{ color: "#fff", fontWeight: "800" }}>{page}</Text>
          </View>

          <View style={s.connection}>
            <View style={[s.dot, { backgroundColor: apiOnline ? C.green : "#ffbd75" }]} />
            <Text style={s.connectionText}>{apiOnline ? "API connected" : "API offline"}</Text>
          </View>

          <View style={s.avatar}><Text style={{ fontWeight: "900" }}>V</Text></View>
        </View>

        <ScrollView
          contentContainerStyle={[s.content, !desktop && { paddingHorizontal: 16 }]}
          showsVerticalScrollIndicator={false}
        >
          {page === "Home" ? home : null}
          {page === "Create" ? createPage : null}
          {page === "Explore" ? explore : null}
          {page === "Library" ? libraryPage : null}

          <View style={s.footer}>
            <Text style={s.brandName}>VYRA <Text style={{ color: C.purple }}>AI</Text></Text>
            <Text style={s.muted}>Because every moment deserves a movie. ✦</Text>
            <Text style={s.footerSmall}>CREATIVE STUDIO · 2026</Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, minHeight: "100%", flexDirection: "row", backgroundColor: C.bg },
  main: { flex: 1, minWidth: 0, backgroundColor: C.bg },

  sidebar: {
    width: 245, minHeight: "100%", padding: 19, paddingTop: 26,
    backgroundColor: "#0d0d19", borderRightWidth: 1, borderRightColor: C.line,
  },
  mobileSidebar: { width: 260, flex: 1 },
  brand: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 38 },
  brandIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: C.purple, alignItems: "center", justifyContent: "center" },
  brandV: { color: "#fff", fontWeight: "900", fontSize: 26, fontStyle: "italic" },
  brandName: { color: C.white, fontWeight: "900", fontSize: 17, letterSpacing: 1.5 },
  brandCaption: { color: C.muted, fontSize: 8, letterSpacing: 2, marginTop: 4 },
  label: { color: "#8782a2", fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginBottom: 11 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 11, marginBottom: 5 },
  navActive: { backgroundColor: "rgba(155,114,255,0.14)", borderWidth: 1, borderColor: "rgba(155,114,255,0.2)" },
  navIcon: { color: "#a19dbb", fontSize: 20, width: 22, textAlign: "center" },
  navText: { color: "#b3afca", fontSize: 12, fontWeight: "700" },
  promo: { padding: 14, borderRadius: 15, backgroundColor: "#19142b", borderWidth: 1, borderColor: "rgba(155,114,255,0.2)", marginBottom: 18, gap: 9 },
  promoIcon: { color: C.purple, fontSize: 22 },
  promoTitle: { color: "#fff", fontWeight: "900", fontSize: 12 },
  promoSub: { color: C.muted, fontSize: 10, lineHeight: 16 },
  profile: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 35, height: 35, borderRadius: 12, backgroundColor: "#34234f", borderWidth: 1, borderColor: "#624a92", alignItems: "center", justifyContent: "center" },
  profileName: { color: "#fff", fontWeight: "800", fontSize: 11 },
  muted: { color: C.muted, fontSize: 10 },
  topbar: { height: 68, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 22, gap: 13 },
  connection: { flexDirection: "row", alignItems: "center", gap: 7, padding: 8, borderRadius: 22, borderWidth: 1, borderColor: C.line },
  connectionText: { color: "#ded9ee", fontSize: 10, fontWeight: "700" },
  dot: { width: 7, height: 7, borderRadius: 8 },
  menuButton: { padding: 6 },
  content: { width: "100%", maxWidth: 1550, alignSelf: "center", paddingHorizontal: 28, paddingTop: 26, paddingBottom: 20 },
  hero: { flexDirection: "row", gap: 26, padding: 28, minHeight: 360, backgroundColor: "#131121", borderWidth: 1, borderColor: "rgba(155,114,255,0.23)", borderRadius: 25, marginBottom: 37, overflow: "hidden" },
  heroStack: { flexDirection: "column", padding: 20 },
  heroCopy: { flex: 1, justifyContent: "center" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", padding: 8, borderRadius: 25, borderWidth: 1, borderColor: C.line, marginBottom: 19 },
  statusText: { color: "#d5cee9", fontSize: 8, letterSpacing: 1.2, fontWeight: "900" },
  heroTitle: { color: "#fff", fontSize: 43, lineHeight: 51, fontWeight: "900", letterSpacing: -1.3, marginBottom: 14 },
  heroSub: { color: "#b0abc8", fontSize: 12, lineHeight: 21, maxWidth: 430, marginBottom: 22 },
  heroButtons: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  button: { minHeight: 43, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: C.purple },
  buttonSecondary: { backgroundColor: "#211e32", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  buttonText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  stats: { flexDirection: "row", gap: 17, alignItems: "center", marginTop: 27 },
  statNumber: { color: "#fff", fontWeight: "900", fontSize: 19 },
  statLine: { width: 1, height: 28, backgroundColor: C.line },
  heroImageWrap: { width: "41%", minWidth: 220, maxWidth: 390, minHeight: 300 },
  heroImage: { flex: 1, minHeight: 300, justifyContent: "space-between", overflow: "hidden" },
  heroImageShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,6,22,0.17)" },
  floatingLabel: { flexDirection: "row", alignItems: "center", gap: 9, alignSelf: "flex-start", margin: 12, padding: 10, borderRadius: 12, backgroundColor: "rgba(12,10,25,0.8)" },
  floatingTitle: { color: "#fff", fontSize: 10, fontWeight: "900", marginBottom: 4 },
  heroPlay: { position: "absolute", alignSelf: "center", top: "43%", width: 57, height: 57, borderRadius: 35, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(155,114,255,0.9)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  heroImageBottom: { padding: 15, backgroundColor: "rgba(8,7,20,0.63)" },
  heroImageTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  heroImageSub: { color: "#e0d7f3", fontSize: 8, letterSpacing: 1.5, marginTop: 5 },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 17, marginTop: 5 },
  eyebrow: { color: C.pink, fontSize: 9, letterSpacing: 1.7, fontWeight: "900", marginBottom: 8 },
  headingTitle: { color: "#fff", fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
  link: { color: "#c9b5ff", fontSize: 10, fontWeight: "900" },
  modeGrid: { flexDirection: "row", gap: 13, marginBottom: 35 },
  modeCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 13, minHeight: 105, padding: 16, borderRadius: 16, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line },
  modeIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: "#29203f", alignItems: "center", justifyContent: "center" },
  modeTitle: { color: "#fff", fontSize: 13, fontWeight: "900", marginBottom: 6 },
  modeSub: { color: C.muted, fontSize: 10, lineHeight: 16 },
  arrow: { color: C.purple, fontSize: 20 },
  galleryGrid: { flexDirection: "row", gap: 14, marginBottom: 28 },
  galleryCard: { flex: 1, minWidth: 0, height: 240, borderRadius: 17, overflow: "hidden", backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, marginBottom: 12 },
  galleryImage: { flex: 1, justifyContent: "space-between" },
  imageOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,6,20,0.12)" },
  imageTop: { flexDirection: "row", justifyContent: "space-between", padding: 11, alignItems: "center" },
  imageTag: { color: "#fff", fontSize: 8, fontWeight: "900", letterSpacing: 1, padding: 7, borderRadius: 7, overflow: "hidden", backgroundColor: "rgba(8,7,20,0.7)" },
  playCircle: { width: 30, height: 30, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.5)" },
  imageBottom: { padding: 14, backgroundColor: "rgba(8,7,20,0.62)" },
  imageTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  imageSubtitle: { color: "#d7d0e9", fontSize: 10, marginTop: 5 },
  quote: { flexDirection: "row", alignItems: "center", gap: 15, padding: 20, borderRadius: 17, backgroundColor: "#151225", borderWidth: 1, borderColor: "rgba(155,114,255,0.18)" },
  quoteText: { color: "#fff", fontSize: 13, lineHeight: 21, fontWeight: "700" },
  quoteCaption: { color: C.pink, fontSize: 8, fontWeight: "900", letterSpacing: 1.5, marginTop: 9 },
  pageIntro: { marginBottom: 25 },
  pageTitle: { color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: -1, marginBottom: 8 },
  createGrid: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  panel: { flex: 1, minWidth: 0, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 19, padding: 20, marginBottom: 20 },
  panelHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 17 },
  panelTitle: { color: "#fff", fontSize: 15, fontWeight: "900", marginBottom: 5 },
  step: { color: "#cbb9ff", backgroundColor: "#29203f", borderRadius: 7, padding: 7, fontSize: 8, fontWeight: "900", overflow: "hidden" },
  switchRow: { flexDirection: "row", gap: 5, backgroundColor: "#0b0b15", padding: 4, borderRadius: 11, marginBottom: 19 },
  switchButton: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 8 },
  switchActive: { backgroundColor: "#2a2142", borderWidth: 1, borderColor: "rgba(155,114,255,0.25)" },
  switchText: { color: C.muted, fontSize: 10, fontWeight: "800" },
  upload: { alignItems: "center", justifyContent: "center", padding: 18, borderRadius: 13, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(155,114,255,0.5)", marginBottom: 18, gap: 7 },
  uploadImage: { width: 100, height: 100, borderRadius: 13, marginBottom: 7 },
  uploadTitle: { color: "#fff", fontSize: 12, fontWeight: "900" },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 9 },
  promptInput: { color: "#fff", backgroundColor: "#0b0b15", borderRadius: 12, borderWidth: 1, borderColor: C.line, minHeight: 125, padding: 13, fontSize: 12, lineHeight: 20, marginBottom: 10 },
  promptTools: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 22 },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10, marginBottom: 22 },
  styleCard: { width: "31%", flexGrow: 1, minWidth: 88, flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: "#10101d" },
  styleText: { color: "#ddd8ee", fontSize: 10, fontWeight: "800", flex: 1 },
  options: { flexDirection: "row", gap: 15, marginBottom: 19 },
  pills: { flexDirection: "row", gap: 6, marginTop: 9, flexWrap: "wrap" },
  pill: { borderWidth: 1, borderColor: C.line, backgroundColor: "#171626", paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8 },
  pillActive: { borderColor: C.purple, backgroundColor: "#30234b" },
  pillText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  apiLine: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 13, marginBottom: 13 },
  errorBox: { padding: 12, borderRadius: 10, backgroundColor: "#351b2b", marginBottom: 12, borderWidth: 1, borderColor: "#653044" },
  errorText: { color: "#ffbdc7", fontSize: 11, lineHeight: 18 },
  messageBox: { padding: 12, borderRadius: 10, backgroundColor: "#153027", marginBottom: 12 },
  messageText: { color: "#a7f2d3", fontSize: 11, lineHeight: 18 },
  disclaimer: { color: "#77728e", textAlign: "center", fontSize: 9, lineHeight: 15, marginTop: 11 },
  preview: { minHeight: 360, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(8,6,20,0.48)", borderRadius: 18 },
  previewPlay: { width: 62, height: 62, borderRadius: 35, backgroundColor: "rgba(155,114,255,0.9)", alignItems: "center", justifyContent: "center", marginBottom: 18 },
  previewTitle: { color: "#fff", fontWeight: "900", fontSize: 16, marginBottom: 7, textAlign: "center" },
  previewMeta: { position: "absolute", bottom: 13, left: 13, right: 13, flexDirection: "row", justifyContent: "space-between" },
  metaText: { color: "#fff", fontSize: 8, letterSpacing: 1, backgroundColor: "rgba(8,7,20,0.7)", padding: 7, borderRadius: 6, overflow: "hidden" },
  settings: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 18, paddingTop: 15, gap: 10 },
  settingRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)", paddingBottom: 9 },
  settingValue: { color: "#e9e3fa", fontSize: 10, fontWeight: "800" },
  resultBox: { backgroundColor: "#090914", borderRadius: 14, padding: 20, gap: 12 },
  resultTitle: { color: "#fff", fontWeight: "900", fontSize: 15 },
  resultUrl: { color: "#c6b3ff", fontSize: 10 },
  search: { height: 47, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingHorizontal: 14, color: "#fff", marginBottom: 18 },
  libraryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  libraryCard: { flex: 1, minWidth: 230, maxWidth: 420, gap: 8 },
  empty: { alignItems: "center", padding: 40, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 18, gap: 14 },
  footer: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 28, paddingTop: 18, paddingBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 },
  footerSmall: { color: "#706b89", fontSize: 8, letterSpacing: 1.2, fontWeight: "800" },
  drawer: { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 100, width: 260, backgroundColor: "#0d0d19", elevation: 20 },
  closeDrawer: { position: "absolute", top: 18, right: -42, width: 34, height: 34, alignItems: "center", justifyContent: "center", backgroundColor: "#2a2340", borderRadius: 10 },
});
