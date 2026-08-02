# fb-ai-poster

Generates an AI image (via OpenAI's image API) and posts it to a Facebook Page automatically, every day at **8:00 AM Philippine Time**, using GitHub Actions.

> Note: this uses the **OpenAI API** for image generation, not "ChatGPT" directly — ChatGPT itself has no API for automation, but it's powered by the same OpenAI models, and the API is how you script this kind of thing.

## How it works

1. `src/generateImage.js` generates an image using **either OpenAI or Gemini** — whichever API key you've set (see "Choosing a provider" below) — and saves the result as a PNG/JPG.
2. `src/postToFacebook.js` uploads that image to your Facebook Page via the Graph API as a published photo post.
3. `.github/workflows/daily-image-post.yml` runs both steps every day at 00:00 UTC (= 08:00 PH time) via GitHub Actions, or on-demand from the Actions tab.

Prompts rotate daily from `prompts.json` (edit that file to change what gets generated), or you can lock it to one fixed prompt via a repo variable.

## Choosing a provider

You only need **one** API key — set whichever provider you want to use:

- Set `GEMINI_API_KEY` → uses Google Gemini (`gemini-3.1-flash-image` by default)
- Set `OPENAI_API_KEY` → uses OpenAI (`gpt-image-1` by default)
- Set **both** → Gemini is used by default. Set `IMAGE_PROVIDER=openai` (or `gemini`) to force one explicitly.

This means you can switch providers any time just by changing which secret is set, with no code changes.

## One-time setup

### 1. Get an API key for your chosen provider

**Gemini** (recommended if you want lower cost / already use Google AI Studio):
- Go to https://aistudio.google.com/apikey and create a key.
- Note: the API is billed per image from the first call — there's no free tier on the API itself (only the consumer Gemini app has free daily generations, which isn't scriptable).

**OpenAI**:
- Go to https://platform.openai.com/api-keys and create a key.
- Make sure the account has billing enabled — image generation is paid per image.

You only need one of these — see "Choosing a provider" above.

### 2. Get a Facebook Page access token
This is the fiddly part. You need a **long-lived Page access token** (not a personal user token, and not one that expires in 60 minutes).

1. Go to https://developers.facebook.com/apps and create an app (type: "Business").
2. Add the **Facebook Login** and **Pages API** products.
3. In [Graph API Explorer](https://developers.facebook.com/tools/explorer/), select your app, then generate a **User Access Token** with these permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
4. Exchange that for a long-lived user token (60 days) using the "Access Token Debugger" or the `oauth/access_token` endpoint with `grant_type=fb_exchange_token`.
5. Call `GET /me/accounts` with that long-lived user token — this returns your Pages along with a **Page access token** for each. Page tokens generated from a long-lived user token do not expire, as long as the user token stays valid and you don't revoke the app's access.
6. Also grab your **Page ID** from the same response (or from your Page's About section).

Meta's own docs walk through this in more detail: https://developers.facebook.com/docs/pages/access-tokens

### 3. Push this project to a GitHub repo
```bash
cd fb-ai-poster
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 4. Add GitHub Secrets and Variables
In your repo: **Settings → Secrets and variables → Actions**

**Secrets** (sensitive, encrypted):
| Name | Value |
|---|---|
| `OPENAI_API_KEY` | your OpenAI key (skip if using Gemini) |
| `GEMINI_API_KEY` | your Gemini key (skip if using OpenAI) |
| `FB_PAGE_ID` | your Facebook Page ID |
| `FB_PAGE_ACCESS_TOKEN` | your long-lived Page access token |

**Variables** (non-sensitive, optional — the workflow works without these using defaults):
| Name | Value | Default if unset |
|---|---|---|
| `IMAGE_PROVIDER` | `openai` or `gemini` | auto-detects based on which key is set (Gemini wins if both are) |
| `OPENAI_IMAGE_MODEL` | e.g. `gpt-image-1` | `gpt-image-1` |
| `OPENAI_IMAGE_SIZE` | e.g. `1024x1024` | `1024x1024` |
| `GEMINI_IMAGE_MODEL` | e.g. `gemini-3.1-flash-image` | `gemini-3.1-flash-image` |
| `IMAGE_PROMPT` | a fixed prompt, if you don't want daily rotation | (rotates through `prompts.json`) |
| `FB_CAPTION` | a fixed caption | (uses the image prompt as the caption) |

### 5. Test it manually first
Go to the **Actions** tab → "Daily AI Image → Facebook Post" → **Run workflow**. Check the logs, and check your Page.

Once that works, it'll run automatically every day at 8:00 AM PH time — no further action needed.

## Local testing (optional)
```bash
npm install
cp .env.example .env   # fill in real values
npm start
```
`src/index.js` loads `.env` automatically via `dotenv`. This is a no-op in GitHub Actions (no `.env` file exists there — secrets are injected as real env vars instead), so it's safe either way.

## Customizing what gets posted
- Edit `prompts.json` to change the pool of image prompts.
- Set the `IMAGE_PROMPT` repo variable to bypass rotation and always use one prompt.
- Set `FB_CAPTION` to control the post caption independently of the prompt.

## Changing the schedule
Edit the `cron` line in `.github/workflows/daily-image-post.yml`. GitHub Actions cron is always in UTC. PH time is UTC+8, so:
- `0 0 * * *` → 8:00 AM PH
- `30 22 * * *` → 6:30 AM PH (previous UTC day)

Note: GitHub Actions scheduled runs can be delayed by a few minutes during high load — this is a platform limitation, not something this project can control.
