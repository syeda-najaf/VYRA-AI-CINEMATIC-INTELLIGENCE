import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
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
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "web" ? "http://localhost:8787" : "")
)
  .trim()
  .replace(/\/+$/, "");

const C = {
  bg: "#050a13",
  panel: "#0c1524",
  white: "#f6f8ff",
  muted: "#a5b3c8",
  cyan: "#79efff",
  green: "#78f4c0",
  pink: "#ff9dd6",
  border: "rgba(153,201,255,0.18)",
};

const SCENES = [
  {
    title: "Aurora Princess",
    category: "Fantasy",
    image:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1000&q=85",
    prompt:
      "An anime heroine beneath a luminous emerald aurora in a frozen fantasy kingdom, flowing hair, drifting snow, magical particles, expressive eyes, smooth camera push-in, atmospheric cinematic lighting, rich blue and emerald colors.",
  },
  {
    title: "Spirit of Sakura",
    category: "Anime",
    image:
      "https://images.unsplash.com/photo-1522383225653-ed111181a951?auto=format&fit=crop&w=1000&q=85",
    prompt:
      "An anime-inspired heroine surrounded by falling cherry blossom petals at twilight, glowing lanterns, delicate wind movement, dreamy pink and blue lighting, detailed fantasy scenery, graceful cinematic camera orbit.",
  },
  {
    title: "Midnight Tokyo",
    category: "Cyberpunk",
    image:
      "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1000&q=85",
    prompt:
      "A futuristic anime city at midnight, neon cyan and magenta lights, reflective wet streets, a mysterious protagonist, atmospheric fog, dramatic tracking camera, detailed cyberpunk film composition.",
  },
  {
    title: "Ocean Dream",
    category: "Dreamscape",
    image:
      "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1000&q=85",
    prompt:
      "A dreamy anime ocean beneath a luminous sky, sparkling waves, a gentle sea breeze, glowing clouds, cinematic camera movement, delicate particles and detailed fantasy animation scenery.",
  },
];

const STYLE_OPTIONS = [
  "Anime Film",
  "Dark Fantasy",
  "Dreamscape",
  "Cyberpunk",
  "Studio Ghibli",
  "Cinematic",
];

function Button({ children, onPress, secondary, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondaryButton,
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.75 },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: C.white }]}>
        {children}
      </Text>
    </Pressable>
  );
}

function SceneCard({ scene, onPress }) {
  return (
    <Pressable onPress={onPress} style={s.sceneCard}>
      <ImageBackground
        source={{ uri: scene.image }}
        style={s.sceneImage}
        imageStyle={{ borderRadius: 12 }}
      >
        <View style={s.sceneShade} />

        <View style={s.sceneTop}>
          <Text style={s.tag}>{scene.category.toUpperCase()}</Text>
          <Text style={s.cyan}>↗</Text>
        </View>

        <View style={s.sceneBottom}>
          <Text style={s.sceneTitle}>{scene.title}</Text>
          <Text style={s.sceneSubtitle}>USE THIS INSPIRATION</Text>
        </View>
      </ImageBackground>
    </Pressable>
  );
}

function VideoPlayer({ uri }) {
  const [downloadMessage, setDownloadMessage] = useState("");

  const match = uri.match(/\/api\/videos\/([a-f0-9-]+)/i);
  const downloadUri = match
    ? `${API_BASE_URL}/api/videos/${match[1]}?download=1`
    : uri;

  async function openVideo() {
    try {
      if (Platform.OS === "web") {
        window.open(uri, "_blank", "noopener,noreferrer");
      } else {
        await Linking.openURL(uri);
      }
    } catch {
      setDownloadMessage("Unable to open the video. Please try again.");
    }
  }

  async function downloadVideo() {
    setDownloadMessage("Preparing your video...");

    if (Platform.OS !== "web") {
      try {
        await Linking.openURL(downloadUri);
        setDownloadMessage(
          "The video link was opened. Use your browser's save option."
        );
      } catch {
        setDownloadMessage("Download failed. Try opening the video first.");
      }
      return;
    }

    let objectUrl = null;

    try {
      const response = await fetch(downloadUri);

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Download failed.");
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "vyra-ai-video.mp4";
      document.body.appendChild(link);
      link.click();
      link.remove();

      setDownloadMessage("Your video download has started.");
    } catch (error) {
      setDownloadMessage(error.message || "Could not download the video.");
    } finally {
      if (objectUrl) {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      }
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {Platform.OS === "web" ? (
        React.createElement("video", {
          key: uri,
          src: uri,
          controls: true,
          playsInline: true,
          preload: "metadata",
          style: {
            width: "100%",
            minHeight: 220,
            maxHeight: 450,
            borderRadius: 12,
            backgroundColor: "#02050a",
            objectFit: "contain",
          },
        })
      ) : (
        <View style={s.nativeVideo}>
          <Text style={s.panelTitle}>Your generated video is ready</Text>
          <Text selectable style={s.cyan}>
            {uri}
          </Text>
        </View>
      )}

      <View style={s.actions}>
        <Button secondary onPress={openVideo}>
          ↗ OPEN VIDEO
        </Button>
        <Button onPress={downloadVideo}>↓ DOWNLOAD VIDEO</Button>
      </View>

      {downloadMessage ? (
        <Text style={s.messageText}>{downloadMessage}</Text>
      ) : null}
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const desktop = width >= 950;
  const tablet = width >= 650;

  const [page, setPage] = useState("Home");
  const [mode, setMode] = useState("text");
  const [prompt, setPrompt] = useState(SCENES[0].prompt);
  const [styleName, setStyleName] = useState("Anime Film");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState("5");

  const [photoUri, setPhotoUri] = useState("");
  const [photoData, setPhotoData] = useState("");

  const [adMode, setAdMode] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [productName, setProductName] = useState("");
  const [callToAction, setCallToAction] = useState("Discover more");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [enhancedPrompt, setEnhancedPrompt] = useState("");

  const [library, setLibrary] = useState([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem("vyra-ai-library-v1")
      .then((saved) => {
        if (!active || !saved) return;

        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setLibrary(parsed);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLibraryLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!libraryLoaded) return;

    AsyncStorage.setItem(
      "vyra-ai-library-v1",
      JSON.stringify(library)
    ).catch(() => {});
  }, [library, libraryLoaded]);

  function navigate(nextPage) {
    setPage(nextPage);
    setMenuOpen(false);
    setError("");
  }

  function openCreator(nextMode = "text") {
    setPage("Create");
    setMode(nextMode);
    setMenuOpen(false);
    setError("");
    setMessage("");
    setVideoUrl("");
    setEnhancedPrompt("");
  }

  async function choosePhoto() {
    setError("");

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setError("Please allow photo library access to select an image.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];

      if (!asset.base64) {
        setError(
          "The image could not be encoded. Please choose another photo."
        );
        return;
      }

      const mime = asset.mimeType || "image/jpeg";

      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        setError("Please choose a JPG, PNG, or WebP image.");
        return;
      }

      const dataUri = `data:${mime};base64,${asset.base64}`;

      if (dataUri.length > 11 * 1024 * 1024) {
        setError("Choose a smaller photo. The maximum image size is 8 MB.");
        return;
      }

      setPhotoUri(asset.uri);
      setPhotoData(dataUri);
      setMode("photo");
      setPage("Create");
      setVideoUrl("");
      setMessage("Photo selected. Describe how you want it to move.");
    } catch {
      setError(
        "Could not open the photo picker. Install expo-image-picker and restart Expo."
      );
    }
  }

  function chooseScene(scene) {
    setPrompt(scene.prompt);

    setStyleName(
      scene.category === "Cyberpunk"
        ? "Cyberpunk"
        : scene.category === "Dreamscape"
          ? "Dreamscape"
          : "Anime Film"
    );

    setMode("text");
    setVideoUrl("");
    setError("");
    setEnhancedPrompt("");
    setMessage(`${scene.title} loaded into your scene director.`);
    setPage("Create");
  }

  function enhancePrompt() {
    if (!prompt.trim()) {
      setError("Describe your scene first.");
      return;
    }

    const extra = [
      "Cinematic anime composition",
      "expressive character design and intricate environmental details",
      "volumetric lighting and atmospheric depth",
      "smooth deliberate camera movement",
      "luminous cyan and emerald highlights with deep midnight-blue shadows",
      "polished color grading and coherent motion",
      "avoid unwanted lettering, distortion, flickering and abrupt cuts",
    ];

    if (adMode) {
      extra.push(
        `Brand: ${brandName || "unspecified"}`,
        `Product: ${productName || "main subject"}`,
        `Call to action: ${callToAction || "Discover more"}`
      );
    }

    const improved = `${prompt.trim()} ${extra.join(". ")}.`
      .slice(0, 1200);

    setPrompt(improved);
    setEnhancedPrompt(improved);
    setMessage("Prompt enhanced locally. Nothing was sent to the provider.");
    setError("");
  }

  async function generateVideo() {
    setError("");
    setMessage("");
    setVideoUrl("");
    setEnhancedPrompt("");

    if (!API_BASE_URL) {
      setError(
        "The VYRA API URL is missing. Set EXPO_PUBLIC_API_URL to your deployed backend URL and restart or rebuild the app."
      );
      return;
    }

    if (!prompt.trim()) {
      setError("Please describe your scene first.");
      return;
    }

    if (prompt.trim().length > 1200) {
      setError("Your scene description must be 1200 characters or fewer.");
      return;
    }

    if (mode === "photo" && !photoData) {
      setError("Please choose a photo first.");
      return;
    }

    setBusy(true);
    setMessage("Connecting to the VYRA AI video engine...");

    try {
      const resultPrompt = [
        prompt.trim(),
        "Create a coherent video with visible motion, a clear subject, and cinematic camera movement.",
        adMode
          ? `Commercial concept: ${brandName || "your brand"}. Featured product: ${productName || "your subject"}. Call to action: ${callToAction || "Discover more"}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1800);

      setEnhancedPrompt(
        `${resultPrompt} Visual style: ${styleName}. Aspect ratio: ${aspectRatio}. Requested duration: ${duration} seconds.`
      );

      // FIXED: the backend expects "style" and "duration".
      const submitResponse = await fetch(
        `${API_BASE_URL}/api/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: resultPrompt,
            style: styleName,
            aspectRatio,
            duration: Number(duration),
            mode,
            imageData: mode === "photo" ? photoData : null,
          }),
        }
      );

      const submitData = await submitResponse.json().catch(() => ({}));

      if (!submitResponse.ok) {
        throw new Error(
          submitData.error ||
            `Generation request failed (${submitResponse.status}).`
        );
      }

      if (!submitData.jobId) {
        throw new Error("The backend did not return a generation job ID.");
      }

      let completed = null;
      const maxPolls = 90;

      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        setMessage(
          `Waiting for the AI video model... (${attempt + 1}/${maxPolls})`
        );

        await new Promise((resolve) => setTimeout(resolve, 5000));

        const statusResponse = await fetch(
          `${API_BASE_URL}/api/generate/${encodeURIComponent(
            submitData.jobId
          )}`
        );

        const statusData = await statusResponse.json().catch(() => ({}));

        if (!statusResponse.ok) {
          throw new Error(
            statusData.error ||
              `Could not check generation status (${statusResponse.status}).`
          );
        }

        if (statusData.status === "COMPLETED" && statusData.videoUrl) {
          completed = statusData;
          break;
        }

        if (
          statusData.status === "FAILED" ||
          statusData.status === "ERROR"
        ) {
          throw new Error(
            statusData.error || "The provider could not generate this video."
          );
        }
      }

      if (!completed) {
        throw new Error(
          "Generation is taking longer than expected. Check the backend before starting another request."
        );
      }

      const newItem = {
        id: String(Date.now()),
        title: prompt.trim().slice(0, 48),
        image: photoUri || SCENES[0].image,
        category: styleName,
        url: completed.videoUrl,
        createdAt: new Date().toLocaleString(),
      };

      setVideoUrl(completed.videoUrl);
      setLibrary((previous) => [newItem, ...previous]);

      setMessage(
        "Your generated video is ready. You can play it or download it below."
      );
    } catch (err) {
      const raw = String(err?.message || "");

      if (/failed to fetch|network request failed|networkerror/i.test(raw)) {
        setError(
          `Cannot reach ${API_BASE_URL}. Check the backend URL, Render deployment, and CORS settings.`
        );
      } else {
        setError(
          raw || "Video generation failed. Check the backend logs."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const nav = [
    ["Home", "⌂"],
    ["Create", "✦"],
    ["Explore", "▧"],
    ["Library", "▤"],
  ];

  const header = (
    <View style={s.header}>
      <Pressable style={s.logoRow} onPress={() => navigate("Home")}>
        <View style={s.logoMark}>
          <Text style={s.logoLetter}>V</Text>
        </View>

        <View>
          <Text style={s.logoText}>
            VYRA <Text style={s.cyan}>AI</Text>
          </Text>
          <Text style={s.logoCaption}>ANIME MOTION STUDIO</Text>
        </View>
      </Pressable>

      {desktop ? (
        <View style={s.nav}>
          {nav.map(([label]) => (
            <Pressable
              key={label}
              onPress={() => navigate(label)}
              style={[s.navItem, page === label && s.navItemActive]}
            >
              <Text style={[s.navText, page === label && s.cyan]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable
          onPress={() => setMenuOpen((value) => !value)}
          style={s.menuButton}
        >
          <Text style={s.cyan}>{menuOpen ? "×" : "☰"}</Text>
        </Pressable>
      )}

      <Button onPress={() => openCreator("text")}>＋ CREATE</Button>
    </View>
  );

  const mobileMenu = menuOpen && !desktop ? (
    <View style={s.mobileMenu}>
      {nav.map(([label, icon]) => (
        <Pressable
          key={label}
          onPress={() => navigate(label)}
          style={s.mobileMenuItem}
        >
          <Text style={s.cyan}>{icon}</Text>
          <Text style={s.navText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  ) : null;

  const hero = (
    <ImageBackground
      source={{ uri: SCENES[0].image }}
      style={[s.hero, !desktop && s.heroMobile]}
      imageStyle={s.heroBackground}
    >
      <View style={s.heroShade} />

      <View style={s.heroContent}>
        <View style={s.badge}>
          <View style={s.dot} />
          <Text style={s.badgeText}>THE NEXT CHAPTER OF ANIME</Text>
        </View>

        <Text style={s.heroEyebrow}>ENTER ANOTHER WORLD</Text>

        <Text style={[s.heroTitle, !tablet && s.heroTitleMobile]}>
          STORIES BEYOND{"\n"}
          <Text style={s.cyan}>IMAGINATION.</Text>
        </Text>

        <Text style={s.heroDescription}>
          From whispered dreams to breathtaking anime cinema. Turn your ideas
          into a world that moves.
        </Text>

        <View
          style={[
            s.actions,
            !tablet && {
              flexDirection: "column",
              alignItems: "flex-start",
            },
          ]}
        >
          <Button onPress={() => openCreator("text")}>
            ✦ CREATE YOUR SCENE
          </Button>

          <Button secondary onPress={() => navigate("Explore")}>
            EXPLORE WORLDS ↗
          </Button>
        </View>

        <Text style={s.heroFoot}>
          ANIME · FANTASY · CINEMATIC MOTION
        </Text>
      </View>
    </ImageBackground>
  );

  const creator = (
    <View style={s.section}>
      <Text style={s.eyebrow}>YOUR PERSONAL ANIMATION STUDIO</Text>
      <Text style={s.sectionTitle}>Bring a world to life.</Text>

      <Text style={s.mutedParagraph}>
        Describe a scene or upload a photo. VYRA sends your request to the
        configured video model and displays the returned video.
      </Text>

      <View
        style={[s.creatorGrid, !desktop && { flexDirection: "column" }]}
      >
        <View style={[s.panel, desktop && { flex: 1.1 }]}>
          <Text style={s.panelTitle}>Scene director</Text>
          <Text style={s.panelSubtitle}>Shape your next idea.</Text>

          <View style={s.tabs}>
            {[
              ["text", "✦ Text to Video"],
              ["photo", "▧ Photo to Video"],
            ].map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => {
                  setMode(value);
                  setError("");
                  setVideoUrl("");
                }}
                style={[s.tab, mode === value && s.tabActive]}
              >
                <Text style={[s.tabText, mode === value && s.cyan]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {mode === "photo" && (
            <Pressable onPress={choosePhoto} style={s.uploadBox}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={s.uploadImage} />
              ) : (
                <Text style={[s.cyan, { fontSize: 30 }]}>＋</Text>
              )}

              <Text style={s.whiteText}>
                {photoUri ? "Photo selected" : "Choose a starting photo"}
              </Text>

              <Text style={s.cyan}>BROWSE FILES ↗</Text>
            </Pressable>
          )}

          <View style={s.fieldRow}>
            <Text style={s.fieldLabel}>DESCRIBE YOUR SCENE</Text>
            <Text style={s.muted}>{prompt.length}/1200</Text>
          </View>

          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            maxLength={1200}
            textAlignVertical="top"
            placeholder="Describe your anime scene..."
            placeholderTextColor="#71839c"
            style={s.promptInput}
          />

          <Pressable onPress={enhancePrompt} style={{ marginBottom: 12 }}>
            <Text style={s.cyan}>✦ ENHANCE PROMPT LOCALLY</Text>
          </Pressable>

          <View style={s.toggleRow}>
            <Pressable onPress={() => setAdMode((value) => !value)}>
              <Text style={s.cyan}>{adMode ? "☑" : "☐"}</Text>
            </Pressable>

            <Pressable
              onPress={() => setAdMode((value) => !value)}
              style={{ flex: 1 }}
            >
              <Text style={s.whiteText}>COMMERCIAL MODE</Text>
              <Text style={s.muted}>
                Add optional brand details to the prompt.
              </Text>
            </Pressable>

            <Text style={s.cyan}>{adMode ? "ON" : "OFF"}</Text>
          </View>

          {adMode && (
            <View style={s.fields}>
              <TextInput
                value={brandName}
                onChangeText={setBrandName}
                placeholder="Brand name"
                placeholderTextColor="#71839c"
                style={s.smallInput}
              />

              <TextInput
                value={productName}
                onChangeText={setProductName}
                placeholder="Product or service"
                placeholderTextColor="#71839c"
                style={s.smallInput}
              />

              <TextInput
                value={callToAction}
                onChangeText={setCallToAction}
                placeholder="Call to action"
                placeholderTextColor="#71839c"
                style={s.smallInput}
              />
            </View>
          )}

          <Text style={s.fieldLabel}>VISUAL STYLE</Text>

          <View style={s.styleGrid}>
            {STYLE_OPTIONS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setStyleName(value)}
                style={[
                  s.styleOption,
                  styleName === value && s.styleOptionActive,
                ]}
              >
                <Text
                  style={[
                    s.styleOptionText,
                    styleName === value && s.cyan,
                  ]}
                >
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.fieldLabel}>ASPECT RATIO</Text>

          <View style={s.actions}>
            {["16:9", "9:16"].map((value) => (
              <Pressable
                key={value}
                onPress={() => setAspectRatio(value)}
                style={[
                  s.pill,
                  aspectRatio === value && s.pillActive,
                ]}
              >
                <Text style={s.whiteText}>{value}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[s.fieldLabel, { marginTop: 18 }]}>DURATION</Text>

          <View style={s.actions}>
            {["5", "10", "15"].map((value) => (
              <Pressable
                key={value}
                onPress={() => setDuration(value)}
                style={[
                  s.pill,
                  duration === value && s.pillActive,
                ]}
              >
                <Text style={s.whiteText}>{value}s</Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}
          {message ? <Text style={s.success}>{message}</Text> : null}

          {enhancedPrompt ? (
            <View style={s.promptPreview}>
              <Text style={s.cyan}>PROMPT PREVIEW</Text>
              <Text selectable style={s.mutedParagraph}>
                {enhancedPrompt}
              </Text>
            </View>
          ) : null}

          <Button onPress={generateVideo} disabled={busy}>
            {busy ? "GENERATING AI VIDEO..." : "✦ GENERATE AI VIDEO"}
          </Button>

          {busy && (
            <View style={s.progressRow}>
              <ActivityIndicator color={C.cyan} />
              <Text style={s.muted}>
                Your request is being processed. Please keep this screen open.
              </Text>
            </View>
          )}

          <Text style={[s.muted, { marginTop: 8, lineHeight: 17 }]}>
            Real video generation requires a valid provider key, model access,
            and available credits. Your API key stays on the server.
          </Text>
        </View>

        <View style={[s.panel, desktop && { flex: 0.9 }]}>
          <Text style={s.eyebrow}>YOUR NEXT MASTERPIECE</Text>
          <Text style={s.panelTitle}>Scene monitor</Text>

          {videoUrl ? (
            <>
              <VideoPlayer uri={videoUrl} />

              <Text style={s.success}>AI-GENERATED VIDEO READY</Text>

              <Button
                secondary
                onPress={() => {
                  setVideoUrl("");
                  setMessage("");
                  setEnhancedPrompt("");
                }}
              >
                CREATE ANOTHER VIDEO
              </Button>
            </>
          ) : (
            <ImageBackground
              source={{ uri: photoUri || SCENES[0].image }}
              style={s.monitor}
              imageStyle={{ borderRadius: 12 }}
            >
              <View style={s.monitorShade} />

              <View style={s.monitorCenter}>
                {busy ? (
                  <ActivityIndicator size="large" color={C.cyan} />
                ) : (
                  <Text style={{ color: "#fff", fontSize: 38 }}>▶</Text>
                )}

                <Text style={s.whiteText}>
                  {busy ? "GENERATING YOUR VIDEO" : "A WORLD UNFOLDING"}
                </Text>

                <Text style={s.muted}>VYRA · HOSTED AI VIDEO MODEL</Text>
              </View>

              <View style={s.monitorFooter}>
                <Text style={s.tag}>{aspectRatio}</Text>
                <Text style={s.tag}>{duration} SECONDS</Text>
              </View>
            </ImageBackground>
          )}

          <View style={s.info}>
            {[
              ["Style", styleName],
              ["Mode", mode === "text" ? "Text to Video" : "Photo to Video"],
              ["Ratio", aspectRatio],
              ["Requested length", `${duration}s`],
            ].map(([label, value]) => (
              <View key={label} style={s.infoLine}>
                <Text style={s.muted}>{label}</Text>
                <Text style={s.whiteText}>{value}</Text>
              </View>
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

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search anime, fantasy, cyberpunk..."
        placeholderTextColor="#71839c"
        style={s.smallInput}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 14 }}
      >
        {[
          "All",
          "Anime",
          "Fantasy",
          "Cyberpunk",
          "Dreamscape",
        ].map((value) => (
          <Pressable
            key={value}
            onPress={() => setCategory(value)}
            style={[s.pill, category === value && s.pillActive]}
          >
            <Text style={s.whiteText}>{value}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={s.sceneGrid}>
        {SCENES.filter((scene) => {
          const correctCategory =
            category === "All" || category === scene.category;

          const correctSearch = `${scene.title} ${scene.category}`
            .toLowerCase()
            .includes(search.toLowerCase());

          return correctCategory && correctSearch;
        }).map((scene) => (
          <SceneCard
            key={scene.title}
            scene={scene}
            onPress={() => chooseScene(scene)}
          />
        ))}
      </View>
    </View>
  );

  const libraryPage = (
    <View style={s.section}>
      <Text style={s.eyebrow}>YOUR CREATIVE ARCHIVE</Text>
      <Text style={s.sectionTitle}>Your stories.</Text>

      {library.length === 0 ? (
        <View style={s.empty}>
          <Text style={{ fontSize: 34, color: C.cyan }}>✧</Text>
          <Text style={s.panelTitle}>Your library is empty.</Text>
          <Text style={s.muted}>
            Your generated videos will appear here and be saved on this device.
          </Text>
          <Button onPress={() => openCreator("text")}>
            START CREATING
          </Button>
        </View>
      ) : (
        <View style={s.sceneGrid}>
          {library.map((item) => (
            <View key={item.id} style={s.libraryCard}>
              <SceneCard
                scene={{
                  title: item.title,
                  category: item.category,
                  image: item.image,
                }}
                onPress={() => {
                  setVideoUrl(item.url);
                  setPage("Create");
                  setError("");
                }}
              />

              <Text style={s.muted}>{item.createdAt}</Text>

              <Button
                secondary
                onPress={() => {
                  setVideoUrl(item.url);
                  setPage("Create");
                  setError("");
                }}
              >
                OPEN GENERATED VIDEO
              </Button>

              <Button
                secondary
                onPress={() =>
                  setLibrary((previous) =>
                    previous.filter((entry) => entry.id !== item.id)
                  )
                }
              >
                REMOVE FROM LIBRARY
              </Button>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={s.app}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {header}
      {mobileMenu}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {page === "Home" && (
          <>
            {hero}

            <View style={s.section}>
              <Text style={s.eyebrow}>STEP INSIDE THE STORY</Text>
              <Text style={s.sectionTitle}>
                Every world starts somewhere.
              </Text>

              <Text style={s.mutedParagraph}>
                Start with words, animate a photo, and create a real AI video
                through your connected provider.
              </Text>

              <View
                style={[
                  s.featureGrid,
                  !tablet && { flexDirection: "column" },
                ]}
              >
                <Pressable
                  onPress={() => openCreator("text")}
                  style={s.featureCard}
                >
                  <Text style={s.featureIcon}>✦</Text>
                  <Text style={s.whiteText}>Text to Video</Text>
                  <Text style={s.muted}>Describe a scene.</Text>
                </Pressable>

                <Pressable onPress={choosePhoto} style={s.featureCard}>
                  <Text style={s.featureIcon}>▧</Text>
                  <Text style={s.whiteText}>Photo to Video</Text>
                  <Text style={s.muted}>Choose a starting image.</Text>
                </Pressable>

                <Pressable
                  onPress={() => navigate("Explore")}
                  style={s.featureCard}
                >
                  <Text style={s.featureIcon}>☾</Text>
                  <Text style={s.whiteText}>Explore Worlds</Text>
                  <Text style={s.muted}>Find your visual style.</Text>
                </Pressable>
              </View>
            </View>

            {explore}
          </>
        )}

        {page === "Create" && creator}
        {page === "Explore" && explore}
        {page === "Library" && libraryPage}

        <View style={s.footer}>
          <Text style={s.logoText}>
            VYRA <Text style={s.cyan}>AI</Text>
          </Text>
          <Text style={s.muted}>DREAM IN MOTION. CREATE YOUR WORLD.</Text>
          <Text style={s.success}>AI VIDEO STUDIO · HOSTED MODEL</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  app: {
    flex: 1,
    minHeight: "100%",
    backgroundColor: C.bg,
  },

  header: {
    minHeight: 76,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    backgroundColor: "#050a13",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  logoMark: {
    height: 42,
    width: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#173347",
    borderWidth: 1,
    borderColor: C.cyan,
  },

  logoLetter: {
    fontSize: 27,
    fontWeight: "900",
    color: C.cyan,
  },

  logoText: {
    color: C.white,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2,
  },

  logoCaption: {
    color: C.muted,
    fontSize: 8,
    letterSpacing: 1.5,
    marginTop: 4,
  },

  cyan: { color: C.cyan },

  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  navItem: {
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 7,
  },

  navItemActive: { backgroundColor: "#142d3e" },

  navText: {
    color: "#cbd8e9",
    fontSize: 11,
    fontWeight: "700",
  },

  menuButton: {
    padding: 10,
    backgroundColor: C.panel,
    borderRadius: 7,
  },

  mobileMenu: {
    backgroundColor: C.panel,
    paddingHorizontal: 16,
  },

  mobileMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  button: {
    minHeight: 43,
    paddingHorizontal: 17,
    paddingVertical: 12,
    borderRadius: 7,
    backgroundColor: C.cyan,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.cyan,
  },

  secondaryButton: {
    backgroundColor: "#102235",
    borderColor: "rgba(121,239,255,0.45)",
  },

  buttonText: {
    color: "#04101c",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  hero: {
    minHeight: 560,
    justifyContent: "center",
    padding: 50,
    overflow: "hidden",
    backgroundColor: "#071725",
  },

  heroMobile: {
    minHeight: 560,
    padding: 22,
  },

  heroBackground: { resizeMode: "cover" },

  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,10,24,0.64)",
  },

  heroContent: {
    maxWidth: 850,
    width: "100%",
    alignSelf: "center",
  },

  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(121,239,255,0.4)",
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "rgba(4,15,29,0.72)",
    marginBottom: 27,
  },

  dot: {
    width: 7,
    height: 7,
    borderRadius: 5,
    backgroundColor: C.green,
  },

  badgeText: {
    color: C.white,
    fontSize: 8,
    letterSpacing: 1.1,
    fontWeight: "800",
  },

  heroEyebrow: {
    color: C.cyan,
    fontSize: 10,
    letterSpacing: 4,
    marginBottom: 18,
  },

  heroTitle: {
    color: C.white,
    fontSize: 55,
    lineHeight: 63,
    fontWeight: "900",
    fontFamily: Platform.OS === "web" ? "Georgia, serif" : "serif",
  },

  heroTitleMobile: {
    fontSize: 35,
    lineHeight: 43,
  },

  heroDescription: {
    color: "#d4e1f1",
    fontSize: 13,
    lineHeight: 23,
    maxWidth: 490,
    marginTop: 20,
    marginBottom: 26,
  },

  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },

  heroFoot: {
    color: "#c1d2e9",
    fontSize: 8,
    letterSpacing: 1.5,
    marginTop: 32,
  },

  section: {
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 46,
    paddingBottom: 22,
  },

  eyebrow: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.8,
    marginBottom: 10,
  },

  sectionTitle: {
    color: C.white,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "700",
    fontFamily: Platform.OS === "web" ? "Georgia, serif" : "serif",
    marginBottom: 11,
  },

  muted: {
    color: C.muted,
    fontSize: 10,
    lineHeight: 17,
  },

  mutedParagraph: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 21,
    marginBottom: 20,
    maxWidth: 650,
  },

  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 13,
  },

  featureCard: {
    flex: 1,
    minWidth: 180,
    minHeight: 145,
    padding: 19,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    gap: 10,
  },

  featureIcon: {
    color: C.cyan,
    fontSize: 26,
    marginBottom: 4,
  },

  creatorGrid: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
  },

  panel: {
    flex: 1,
    minWidth: 0,
    padding: 20,
    marginBottom: 22,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    gap: 12,
  },

  panelTitle: {
    color: C.white,
    fontSize: 16,
    fontWeight: "900",
  },

  panelSubtitle: {
    color: C.muted,
    fontSize: 10,
    marginTop: 5,
    marginBottom: 8,
  },

  tabs: {
    flexDirection: "row",
    padding: 4,
    backgroundColor: "#050b15",
    borderRadius: 8,
    gap: 5,
    marginVertical: 8,
  },

  tab: {
    flex: 1,
    padding: 11,
    borderRadius: 6,
    alignItems: "center",
  },

  tabActive: {
    backgroundColor: "#173347",
    borderWidth: 1,
    borderColor: C.border,
  },

  tabText: {
    color: C.muted,
    fontSize: 10,
    fontWeight: "700",
  },

  uploadBox: {
    alignItems: "center",
    gap: 9,
    padding: 22,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.cyan,
    borderRadius: 10,
  },

  uploadImage: {
    width: 110,
    height: 110,
    borderRadius: 10,
    marginBottom: 8,
  },

  whiteText: {
    color: C.white,
    fontSize: 11,
    fontWeight: "700",
  },

  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  fieldLabel: {
    color: "#a2b6ce",
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "900",
    marginBottom: 8,
  },

  promptInput: {
    minHeight: 145,
    color: C.white,
    backgroundColor: "#060d19",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 9,
    padding: 13,
    fontSize: 12,
    lineHeight: 20,
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "#07101d",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 9,
  },

  fields: {
    padding: 10,
    backgroundColor: "#070e19",
    borderRadius: 9,
    gap: 8,
  },

  smallInput: {
    color: C.white,
    backgroundColor: "#0d1a2b",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 12,
    fontSize: 11,
    marginBottom: 8,
  },

  styleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  styleOption: {
    width: "30%",
    minWidth: 100,
    flexGrow: 1,
    padding: 11,
    borderRadius: 7,
    backgroundColor: "#09111e",
    borderWidth: 1,
    borderColor: C.border,
  },

  styleOptionActive: {
    backgroundColor: "#143043",
    borderColor: C.cyan,
  },

  styleOptionText: {
    color: C.white,
    fontSize: 10,
    fontWeight: "700",
  },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 7,
  },

  pillActive: {
    borderColor: C.cyan,
    backgroundColor: "#173747",
  },

  error: {
    color: "#ffc3d1",
    fontSize: 11,
    lineHeight: 18,
    padding: 12,
    backgroundColor: "#321722",
    borderRadius: 8,
  },

  success: {
    color: C.green,
    fontSize: 10,
    lineHeight: 18,
    paddingVertical: 7,
  },

  messageText: {
    color: C.green,
    fontSize: 10,
    lineHeight: 18,
  },

  promptPreview: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#071522",
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },

  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },

  monitor: {
    width: "100%",
    minHeight: 330,
    justifyContent: "space-between",
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: "#071421",
    borderWidth: 1,
    borderColor: C.border,
  },

  monitorShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,11,24,0.45)",
  },

  monitorCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 18,
  },

  monitorFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    padding: 12,
  },

  tag: {
    color: C.white,
    fontSize: 8,
    letterSpacing: 1,
    backgroundColor: "rgba(3,10,20,0.75)",
    padding: 8,
    borderRadius: 5,
    overflow: "hidden",
  },

  sceneGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },

  sceneCard: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 220,
    maxWidth: 560,
    height: 270,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 4,
  },

  sceneImage: {
    flex: 1,
    justifyContent: "space-between",
  },

  sceneShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,10,24,0.28)",
  },

  sceneTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 13,
  },

  sceneBottom: {
    padding: 16,
    backgroundColor: "rgba(3,9,19,0.76)",
  },

  sceneTitle: {
    color: C.white,
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 8,
  },

  sceneSubtitle: {
    color: C.cyan,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  info: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 14,
    gap: 12,
  },

  infoLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },

  nativeVideo: {
    padding: 16,
    backgroundColor: "#07101b",
    borderRadius: 10,
    gap: 10,
  },

  libraryCard: {
    flex: 1,
    minWidth: 220,
    maxWidth: 560,
    marginBottom: 16,
    gap: 8,
  },

  footer: {
    padding: 26,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: "#040811",
    alignItems: "center",
    gap: 12,
  },

  empty: {
    alignItems: "center",
    padding: 36,
    backgroundColor: C.panel,
    borderRadius: 12,
    gap: 14,
  },
});