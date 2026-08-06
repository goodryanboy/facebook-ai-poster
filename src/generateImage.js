const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { configForEntry } = require("./pageConfig");

const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const PH_TIMEZONE = "Asia/Manila";

/**
 * Gets the current day-of-week name and hour in Philippine time, regardless
 * of what timezone the machine/runner is actually in (GitHub Actions runs
 * in UTC).
 */
function getPhilippineDayAndHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PH_TIMEZONE,
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday").value.toLowerCase();
  // hour can come back as "24" for midnight in some environments; normalize.
  let hour = parseInt(parts.find((p) => p.type === "hour").value, 10);
  if (hour === 24) hour = 0;

  return { weekday, hour };
}

/**
 * Maps the current PH hour to the nearest scheduled slot: 6am, 12pm, or 6pm.
 */
function resolveSlot(hour) {
  if (hour < 9) return "6am"; // 0–8h  -> morning run
  if (hour < 15) return "12pm"; // 9–14h -> midday run
  return "6pm"; // 15–23h -> evening run
}

/**
 * Picks schedule entry + prompt/caption for one page.
 * Caption comes only from the schedule entry (or falls back to prompt later).
 * Returns { entry, prompt, caption, weekday, slot, config }.
 *
 * @param {{ key?: string, schedule?: object, config?: object, rawConfig?: object, fileDefaults?: object }} page
 */
function pickPrompt(page = {}) {
  const envPrompt = process.env.IMAGE_PROMPT && process.env.IMAGE_PROMPT.trim();
  const pageLabel = page.key || "default";

  if (envPrompt) {
    const config = page.config || configForEntry(page, null);
    return {
      entry: null,
      prompt: envPrompt,
      // IMAGE_PROMPT override: post message uses the prompt text itself
      caption: null,
      weekday: null,
      slot: null,
      config,
    };
  }

  const schedule = page.schedule;
  if (!schedule) {
    throw new Error(
      `Page "${pageLabel}" has no schedule and IMAGE_PROMPT is not set.`
    );
  }

  const { weekday, hour } = getPhilippineDayAndHour();
  let slot = resolveSlot(hour);

  // Page config may restrict which slots are active
  const pageConfig = page.config || {};
  if (Array.isArray(pageConfig.slots) && pageConfig.slots.length > 0) {
    if (!pageConfig.slots.includes(slot)) {
      // Prefer the nearest configured slot for this time window, else first
      const preferred = pageConfig.slots.find((s) => s === slot);
      slot = preferred || pageConfig.slots[0];
      console.log(
        `[${pageLabel}] Slot restricted by config.slots → using "${slot}"`
      );
    }
  }

  const dayEntries = schedule[weekday];
  if (!dayEntries || dayEntries.length === 0) {
    throw new Error(
      `Page "${pageLabel}" has no prompts configured for "${weekday}".`
    );
  }

  const entry =
    dayEntries.find((e) => e.slot === slot) || dayEntries[0]; // fallback to first if slot missing

  // Merge page config + optional per-slot entry.config
  const config = configForEntry(page, entry);

  // If slots filter is set and the resolved entry's slot isn't allowed, skip-friendly error
  if (Array.isArray(config.slots) && config.slots.length > 0) {
    if (!config.slots.includes(entry.slot)) {
      const alt = dayEntries.find((e) => config.slots.includes(e.slot));
      if (!alt) {
        throw new Error(
          `Page "${pageLabel}": no schedule entry for ${weekday} matching config.slots=${JSON.stringify(config.slots)}.`
        );
      }
      // Use alternate entry and re-resolve config
      return finalizePick(pageLabel, weekday, alt, page);
    }
  }

  console.log(`[${pageLabel}] Selected schedule entry: ${weekday} / ${entry.slot}`);

  return finalizePick(pageLabel, weekday, entry, page);
}

function finalizePick(pageLabel, weekday, entry, page) {
  const config = configForEntry(page, entry);
  const prompt = entry.prompt != null ? String(entry.prompt) : null;
  // Caption from schedule only (index falls back to prompt if missing)
  const caption = entry.caption != null ? String(entry.caption) : null;

  // Validate content against post type
  if (config.postType === "image" && !prompt && !(process.env.IMAGE_PROMPT || "").trim()) {
    throw new Error(
      `Page "${pageLabel}" (${weekday}/${entry.slot}): postType is "image" but schedule entry has no "prompt".`
    );
  }
  if (config.postType === "text" && !caption && !prompt) {
    throw new Error(
      `Page "${pageLabel}" (${weekday}/${entry.slot}): postType is "text" but entry has neither "caption" nor "prompt".`
    );
  }

  return {
    entry,
    prompt,
    caption,
    weekday,
    slot: entry.slot,
    config,
  };
}

/**
 * Resolves image provider from page config (+ env keys available).
 * config.imageProvider: "auto" | "gemini" | "openai"
 */
function resolveProvider(config = {}) {
  const forced = (config.imageProvider || "auto").toLowerCase();

  if (forced === "openai" || forced === "gemini") {
    if (forced === "openai" && !process.env.OPENAI_API_KEY) {
      throw new Error('imageProvider is "openai" but OPENAI_API_KEY is not set.');
    }
    if (forced === "gemini" && !process.env.GEMINI_API_KEY) {
      throw new Error('imageProvider is "gemini" but GEMINI_API_KEY is not set.');
    }
    return forced;
  }

  if (forced !== "auto") {
    throw new Error(
      `Unknown imageProvider "${forced}". Use "auto", "gemini", or "openai".`
    );
  }

  // auto: prefer gemini if key present (same as historical behavior)
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";

  throw new Error(
    "No image provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY (or set config.imageProvider)."
  );
}

function safeFilePart(name) {
  return String(name || "page").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolveOpenAiModel(config) {
  return (
    config.imageModel ||
    config._envOpenAiModel ||
    process.env.OPENAI_IMAGE_MODEL ||
    "gpt-image-1"
  );
}

function resolveOpenAiSize(config) {
  return (
    config.imageSize ||
    process.env.OPENAI_IMAGE_SIZE ||
    "1024x1024"
  );
}

function resolveGeminiModel(config) {
  return (
    config.imageModel ||
    config._envGeminiModel ||
    process.env.GEMINI_IMAGE_MODEL ||
    "gemini-3.1-flash-image"
  );
}

async function generateWithOpenAI(prompt, outputDir, pageKey, config = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");

  const model = resolveOpenAiModel(config);
  const size = resolveOpenAiSize(config);

  console.log(`[OpenAI] Generating image with model "${model}" size=${size}`);

  const response = await axios.post(
    OPENAI_API_URL,
    { model, prompt, size, n: 1 },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  const imageData = response.data?.data?.[0];
  if (!imageData) throw new Error("OpenAI response did not contain image data.");

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `generated-${safeFilePart(pageKey)}-${Date.now()}.png`
  );

  if (imageData.b64_json) {
    fs.writeFileSync(filePath, Buffer.from(imageData.b64_json, "base64"));
  } else if (imageData.url) {
    const imgResp = await axios.get(imageData.url, { responseType: "arraybuffer" });
    fs.writeFileSync(filePath, Buffer.from(imgResp.data));
  } else {
    throw new Error("OpenAI response contained neither b64_json nor url.");
  }

  return filePath;
}

async function generateWithGemini(prompt, outputDir, pageKey, config = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY environment variable.");

  const model = resolveGeminiModel(config);
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const aspectRatio = config.geminiAspectRatio || "ASPECT_RATIO_ONE_BY_ONE";
  const imageSize = config.geminiImageSize || "IMAGE_SIZE_FIVE_TWELVE";

  console.log(
    `[Gemini] Generating image with model "${model}" aspect=${aspectRatio} size=${imageSize}`
  );

  const response = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        responseFormat: {
          image: {
            aspectRatio,
            imageSize,
          },
        },
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 120000,
    }
  );

  const parts = response.data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);

  if (!imagePart) {
    throw new Error("Gemini response did not contain image data.");
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "png";

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `generated-${safeFilePart(pageKey)}-${Date.now()}.${ext}`
  );
  fs.writeFileSync(filePath, Buffer.from(imagePart.inlineData.data, "base64"));

  return filePath;
}

/**
 * Generates an image for one page and saves it to disk.
 * Skips generation when resolved config.postType is "text".
 *
 * @param {{ outputDir?: string, page?: object }} opts
 */
async function generateImage({ outputDir = "output", page = {} } = {}) {
  const picked = pickPrompt(page);
  const { prompt, caption, config } = picked;
  const pageKey = page.key || "default";

  console.log(`[${pageKey}] Config: ${JSON.stringify(publicConfig(config))}`);

  if (config.postType === "text") {
    console.log(`[${pageKey}] postType=text → skipping image generation`);
    return {
      filePath: null,
      prompt,
      caption,
      provider: null,
      pageKey,
      config,
      slot: picked.slot,
      weekday: picked.weekday,
    };
  }

  const provider = resolveProvider(config);
  console.log(`[${pageKey}] Provider: ${provider}`);
  console.log(`[${pageKey}] Prompt: ${prompt}`);

  const filePath =
    provider === "gemini"
      ? await generateWithGemini(prompt, outputDir, pageKey, config)
      : await generateWithOpenAI(prompt, outputDir, pageKey, config);

  console.log(`[${pageKey}] Image saved to ${filePath}`);
  return {
    filePath,
    prompt,
    caption,
    provider,
    pageKey,
    config,
    slot: picked.slot,
    weekday: picked.weekday,
  };
}

/** Strip internal/env helper fields from logged config. */
function publicConfig(config) {
  const out = { ...config };
  delete out._envOpenAiModel;
  delete out._envGeminiModel;
  return out;
}

module.exports = {
  generateImage,
  pickPrompt,
  resolveProvider,
  getPhilippineDayAndHour,
  resolveSlot,
};
