const { generateImage } = require("./generateImage");
const { postToFacebook } = require("./postToFacebook");

async function main() {
  try {
    const { filePath, prompt } = await generateImage({ outputDir: "output" });

    const caption = process.env.FB_CAPTION || prompt;
    const result = await postToFacebook({ filePath, caption });

    console.log("Done. Post ID:", result.post_id || result.id);
  } catch (err) {
    console.error("Job failed:", err.response?.data || err.message);
    process.exit(1);
  }
}

main();
