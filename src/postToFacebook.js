const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || "v21.0";

async function postToFacebook({ filePath, caption }) {
  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

  if (!pageId) throw new Error("Missing FB_PAGE_ID");
  if (!accessToken) throw new Error("Missing FB_PAGE_ACCESS_TOKEN");

  // Step 1: Upload photo as unpublished
  const form = new FormData();
  form.append("source", fs.createReadStream(filePath));
  form.append("published", "false");          // Important!
  form.append("access_token", accessToken);

  console.log("Uploading unpublished photo...");

  const uploadRes = await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/photos`,
    form,
    {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      timeout: 120000,
    }
  );

  const photoId = uploadRes.data.id;
  console.log("Photo uploaded. Photo ID:", photoId);

  // Step 2: Create the actual feed post using the photo
  console.log("Creating feed post...");

  const postRes = await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`,
    null,
    {
      params: {
        message: caption || "",
        attached_media: JSON.stringify([{ media_fbid: photoId }]),
        published: true,
        access_token: accessToken,
      },
      timeout: 30000,
    }
  );

  console.log("Feed post created:", postRes.data);
  return postRes.data; // This will contain the real post_id
}

module.exports = { postToFacebook };