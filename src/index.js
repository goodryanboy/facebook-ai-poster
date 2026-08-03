require("dotenv").config();

const { generateImage } = require("./generateImage");
const { postToFacebook } = require("./postToFacebook");

async function main() {
  try {
    const { filePath, prompt, caption: pickedCaption } = await generateImage({ outputDir: "output" });

    // Priority: FB_CAPTION env var (handled inside generateImage/pickPrompt)
    // > the matched schedule entry's caption > raw prompt text as last resort.
    const caption = pickedCaption || prompt;
    const result = await postToFacebook({ filePath, caption });

    console.log("Done. Post ID:", result.post_id || result.id);
  } catch (err) {
    console.error("Job failed:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();