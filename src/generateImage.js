const fs = require("fs");
const path = require("path");
const axios = require("axios");

const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const PH_TIMEZONE = "Asia/Manila";
const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

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
 * This lines up with the 3x-daily cron (0 22,4,10 * * * UTC).
 */
function resolveSlot(hour) {
  if (hour < 9) return "6am"; // 0–8h  -> morning run
  if (hour < 15) return "12pm"; // 9–14h -> midday run
  return "6pm"; // 15–23h -> evening run
}

/**
 * Picks a prompt + caption pair for the current run.
 * - IMAGE_PROMPT / FB_CAPTION env vars, if set, override everything (useful
 *   for manual workflow_dispatch runs or one-off posts).
 * - Otherwise, selects based on the current Philippine day-of-week and
 *   time-of-day slot from prompts.json's "schedule" structure.
 */
function pickPrompt() {
  const envPrompt = process.env.IMAGE_PROMPT && process.env.IMAGE_PROMPT.trim();
  const envCaption = process.env.FB_CAPTION && process.env.FB_CAPTION.trim();

  if (envPrompt) {
    return { prompt: envPrompt, caption: envCaption || null };
  }

  const configPath = path.join(__dirname, "..", "prompts.json");
  const { schedule } = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (!schedule) {
    throw new Error("prompts.json has no \"schedule\" defined and IMAGE_PROMPT is not set.");
  }

  const { weekday, hour } = getPhilippineDayAndHour();
  const slot = resolveSlot(hour);

  const dayEntries = schedule[weekday];
  if (!dayEntries || dayEntries.length === 0) {
    throw new Error(`No prompts configured for "${weekday}" in prompts.json.`);
  }

  const entry =
    dayEntries.find((e) => e.slot === slot) || dayEntries[0]; // fallback to first if slot missing

  console.log(`Selected schedule entry: ${weekday} / ${slot}`);

  return {
    prompt: entry.prompt,
    caption: envCaption || entry.caption || null,
  };
}

/**
 * Decides which provider to use.
 * - IMAGE_PROVIDER env var wins if set ("openai" or "gemini").
 * - Otherwise: prefers Gemini if GEMINI_API_KEY is set, else OpenAI if
 *   OPENAI_API_KEY is set.
 * - Errors if neither key is present.
 */
function resolveProvider() {
  const forced = (process.env.IMAGE_PROVIDER || "").trim().toLowerCase();
  if (forced === "openai" || forced === "gemini") return forced;
  if (forced) {
    throw new Error(`Unknown IMAGE_PROVIDER "${forced}". Use "openai" or "gemini".`);
  }

  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";

  throw new Error(
    "No image provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY (or both — set IMAGE_PROVIDER to force one)."
  );
}

async function generateWithOpenAI(prompt, outputDir) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable.");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1024";

  console.log(`[OpenAI] Generating image with model "${model}"`);

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
  const filePath = path.join(outputDir, `generated-${Date.now()}.png`);

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

async function generateWithGemini(prompt, outputDir) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY environment variable.");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  console.log(`[Gemini] Generating image with model "${model}"`);

  const response = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 
        responseModalities: ["TEXT", "IMAGE"],
        "responseFormat": {
          "image": {
            "aspectRatio": "ASPECT_RATIO_ONE_BY_ONE",
            "imageSize": "IMAGE_SIZE_FIVE_TWELVE"
          }
        }
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
  const filePath = path.join(outputDir, `generated-${Date.now()}.${ext}`);
  fs.writeFileSync(filePath, Buffer.from(imagePart.inlineData.data, "base64"));

  return filePath;
}

/**
 * Generates an image and saves it to disk. Auto-selects between OpenAI and
 * Gemini based on which API key(s) are available (see resolveProvider()).
 * Returns the local file path and the prompt used.
 */
async function generateImage({ outputDir = "output" } = {}) {
  const provider = resolveProvider();
  const { prompt, caption } = pickPrompt();

  console.log(`Provider: ${provider}`);
  console.log(`Prompt: ${prompt}`);

  const filePath =
    provider === "gemini"
      ? await generateWithGemini(prompt, outputDir)
      : await generateWithOpenAI(prompt, outputDir);

  console.log(`Image saved to ${filePath}`);
  return { filePath, prompt, caption, provider };
}

module.exports = { generateImage, pickPrompt, resolveProvider };