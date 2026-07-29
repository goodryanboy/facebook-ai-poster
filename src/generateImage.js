const fs = require("fs");
const path = require("path");
const axios = require("axios");

const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";

/**
 * Picks a prompt: uses IMAGE_PROMPT env var if set, otherwise rotates
 * through prompts.json based on the day of the year (so it varies daily
 * but is fully deterministic — no state needs to be stored anywhere).
 */
function pickPrompt() {
  if (process.env.IMAGE_PROMPT && process.env.IMAGE_PROMPT.trim()) {
    return process.env.IMAGE_PROMPT.trim();
  }

  const configPath = path.join(__dirname, "..", "prompts.json");
  const { prompts } = JSON.parse(fs.readFileSync(configPath, "utf8"));

  if (!prompts || prompts.length === 0) {
    throw new Error("prompts.json has no prompts defined and IMAGE_PROMPT is not set.");
  }

  const startOfYear = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 0));
  const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86400000);
  return prompts[dayOfYear % prompts.length];
}

/**
 * Generates an image via OpenAI's image generation endpoint and saves it
 * to disk as a PNG. Returns the local file path and the prompt used.
 */
async function generateImage({ outputDir = "output" }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  const prompt = pickPrompt();
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1024";

  console.log(`Generating image with model "${model}"`);
  console.log(`Prompt: ${prompt}`);

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
  if (!imageData) {
    throw new Error("OpenAI response did not contain image data.");
  }

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

  console.log(`Image saved to ${filePath}`);
  return { filePath, prompt };
}

module.exports = { generateImage, pickPrompt };
