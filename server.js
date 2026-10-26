require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { fal } = require("@fal-ai/client");

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());

// Photo uploads use base64, which needs a larger JSON limit.
app.use(express.json({ limit: "30mb" }));

if (process.env.FAL_KEY) {
  fal.config({
    credentials: process.env.FAL_KEY,
  });
}

// Demo-only in-memory accounts.
// A production app should use a database and secure authentication.
const accounts = new Map();

function getAccount(userId = "local-demo-user") {
  if (!accounts.has(userId)) {
    accounts.set(userId, {
      credits: 4,
      projects: [],
    });
  }

  return accounts.get(userId);
}

function validDuration(value) {
  const duration = Number(value);
  return [5, 10, 15].includes(duration) ? duration : null;
}

function validAspect(value) {
  return ["16:9", "9:16", "1:1"].includes(value)
    ? value
    : "16:9";
}

function isConfigured() {
  return Boolean(
    process.env.FAL_KEY &&
    process.env.FAL_KEY !== "YOUR_REAL_FAL_API_KEY"
  );
}

app.get("/", (_req, res) => {
  res.json({
    name: "VYRA AI API",
    ok: true,
    health: "/api/health",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VYRA AI API",
    configured: isConfigured(),
  });
});

app.get("/api/subscription/status", (req, res) => {
  const userId = String(
    req.query.userId || "local-demo-user"
  );

  const account = getAccount(userId);

  res.json({
    credits: account.credits,
    projects: account.projects,
  });
});

app.post("/api/generate", async (req, res) => {
  const userId = String(
    req.body?.userId || "local-demo-user"
  ).slice(0, 100);

  const prompt = String(
    req.body?.prompt || ""
  ).trim();

  const style = String(
    req.body?.style || "Cinematic"
  ).trim().slice(0, 80);

  const mode =
    req.body?.mode === "photo" ? "photo" : "text";

  const duration = validDuration(req.body?.duration);
  const aspectRatio = validAspect(req.body?.aspectRatio);
  const imageData = req.body?.imageData;

  const account = getAccount(userId);

  // Validate request.
  if (!prompt) {
    return res.status(400).json({
      error: "Please enter a video prompt.",
    });
  }

  if (prompt.length > 2000) {
    return res.status(400).json({
      error: "Prompt is too long. Keep it under 2,000 characters.",
    });
  }

  if (!duration) {
    return res.status(400).json({
      error: "Duration must be 5, 10, or 15 seconds.",
    });
  }

  if (mode === "photo" && typeof imageData !== "string") {
    return res.status(400).json({
      error: "Choose a photo for Photo to Video mode.",
    });
  }

  if (
    mode === "photo" &&
    !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageData)
  ) {
    return res.status(400).json({
      error: "Photo must be a JPG, PNG, or WebP image.",
    });
  }

  if (
    mode === "photo" &&
    imageData.length > 27 * 1024 * 1024
  ) {
    return res.status(413).json({
      error: "Image is too large. Choose a smaller image.",
    });
  }

  if (!isConfigured()) {
    return res.status(503).json({
      error:
        "AI generation is not configured. Add your real FAL_KEY to .env and restart the server.",
    });
  }

  if (account.credits <= 0) {
    return res.status(402).json({
      error: "No demo credits remain.",
    });
  }

  // Select the appropriate AI model.
  const model =
    mode === "photo"
      ? "fal-ai/wan/v2.7/image-to-video"
      : "fal-ai/wan/v2.7/text-to-video";

  const input = {
    prompt:
      `${prompt}. Visual direction: ${style}. ` +
      "Smooth motion, coherent composition, detailed lighting.",
    duration: String(duration),
    resolution: "720p",
    enable_prompt_expansion: true,
  };

  if (mode === "photo") {
    input.image_url = imageData;
  } else {
    input.aspect_ratio = aspectRatio;
  }

  try {
    console.log(
      `[VYRA] Starting ${mode}-to-video generation`
    );

    const result = await fal.subscribe(model, {
      input,
      logs: true,

      onQueueUpdate(update) {
        if (update?.status) {
          console.log(`[FAL] Status: ${update.status}`);
        }

        if (update?.logs?.length) {
          update.logs.forEach((entry) => {
            if (entry?.message) {
              console.log(`[FAL] ${entry.message}`);
            }
          });
        }
      },
    });

    const videoUrl =
      result?.data?.video?.url ||
      result?.data?.video_url ||
      result?.video?.url ||
      result?.video_url;

    if (!videoUrl) {
      console.error(
        "[VYRA] No video URL returned:",
        JSON.stringify(result?.data || result).slice(0, 1500)
      );

      return res.status(502).json({
        error:
          "The AI provider did not return a video URL. Check your server logs and try again.",
      });
    }

    // Deduct a demo credit only after successful generation.
    account.credits -= 1;

    const project = {
      id: String(Date.now()),
      prompt,
      style,
      mode,
      duration,
      aspectRatio: mode === "text" ? aspectRatio : null,
      videoUrl,
      createdAt: new Date().toISOString(),
    };

    account.projects.unshift(project);

    console.log("[VYRA] Video generated successfully.");

    return res.json({
      ok: true,
      videoUrl,
      project,
      creditsRemaining: account.credits,
    });
  } catch (error) {
    console.error(
      "[VYRA] Generation failed:",
      error?.body || error?.message || error
    );

    const detail =
      error?.body?.detail ||
      error?.message ||
      "Unknown provider error";

    return res.status(502).json({
      error: `AI video generation failed: ${String(detail).slice(0, 700)}`,
    });
  }
});

// This endpoint is not a complete payment integration.
// Configure a real payment provider before selling subscriptions.
app.post("/api/create-order", async (req, res) => {
  const checkoutUrl = process.env.PAYMENT_CREATE_SESSION_URL;
  const apiKey = process.env.PAYMENT_API_KEY;

  if (!checkoutUrl || !apiKey) {
    return res.status(501).json({
      error:
        "Payments are not configured. Connect a payment provider before enabling subscriptions.",
    });
  }

  try {
    const response = await fetch(checkoutUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body || {}),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.error ||
          "The payment provider rejected the request.",
      });
    }

    return res.json(data);
  } catch (error) {
    return res.status(502).json({
      error: `Payment provider error: ${error.message}`,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`VYRA AI API: http://localhost:${PORT}`);
  console.log(`AI key configured: ${isConfigured()}`);
});