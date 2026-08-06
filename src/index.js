require("dotenv").config();

const { loadPages } = require("./pages");
const { generateImage } = require("./generateImage");
const { postToFacebook } = require("./postToFacebook");

async function postForPage(page) {
  console.log(`\n========== Page: ${page.key} (id ${page.pageId}) ==========`);
  console.log(
    `[${page.key}] page config: postType=${page.config.postType}, imageProvider=${page.config.imageProvider}, imageModel=${page.config.imageModel || "(default)"}`
  );

  const {
    filePath,
    prompt,
    caption: pickedCaption,
    config,
  } = await generateImage({
    outputDir: "output",
    page,
  });

  // Caption: schedule entry caption, else the image prompt text
  const caption = pickedCaption || prompt || "";

  const result = await postToFacebook({
    filePath,
    caption,
    pageId: page.pageId,
    accessToken: page.accessToken,
    postType: config.postType,
    published: config.published,
    link: config.link,
  });

  const postId = result.post_id || result.id;
  console.log(`[${page.key}] Done. Post ID:`, postId);
  return {
    pageKey: page.key,
    postId,
    postType: config.postType,
    ok: true,
  };
}

async function main() {
  const pages = loadPages();
  console.log(
    `Posting to ${pages.length} page(s): ${pages
      .map((p) => `${p.key}[${p.config.postType}]`)
      .join(", ")}`
  );

  const results = [];
  const errors = [];

  // Sequential: avoids hammering image APIs and keeps logs readable.
  for (const page of pages) {
    try {
      results.push(await postForPage(page));
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error(`[${page.key}] Failed:`, detail);
      errors.push({ pageKey: page.key, error: detail });
    }
  }

  console.log("\n========== Summary ==========");
  for (const r of results) {
    console.log(`  OK  ${r.pageKey} (${r.postType}) → ${r.postId}`);
  }
  for (const e of errors) {
    console.log(`  FAIL ${e.pageKey}`);
  }

  if (errors.length > 0) {
    console.error(
      `Job finished with ${errors.length} failure(s) out of ${pages.length} page(s).`
    );
    process.exit(1);
  }

  console.log("All pages posted successfully.");
}

main();
