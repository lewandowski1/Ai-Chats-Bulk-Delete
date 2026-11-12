# AI Chat Bulk Delete

A Chrome extension that adds bulk delete and one-click delete to the chat history in **Google Search AI Mode** (google.com/search, the "AI Mode" / "AI-tilstand" tab), **Gemini** (gemini.google.com), **Claude** (claude.ai) and **ChatGPT** (chatgpt.com).

## Install

1. Get the files. On GitHub, click **Code → Download ZIP** and unzip it, or run `git clone https://github.com/lewandowski1/Ai-Chats-Bulk-Delete.git`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder that contains `manifest.json`.
5. Reload any open AI Mode, Gemini, Claude or ChatGPT tabs.

Keep the folder where it is afterwards, because Chrome loads the extension from it.

After you change the files, click the reload icon on the extension's card in `chrome://extensions`, then reload the page.

## Use

Click the extension's icon in the Chrome toolbar to see a short how-to and a count of how many chats you've deleted. If the icon isn't showing, pin it via the puzzle-piece menu.

At the bottom of the popup, **Support the creator** opens the Ko-fi page and **Visit creator website** opens the extensions site. Both addresses are in `LINKS` at the bottom of `popup.js`; while one is `null`, its button shows "Coming soon".

Open the history sidebar first. In AI Mode, that's the panel with "New thread" and your threads. In Claude and ChatGPT, it's the sidebar with your recent chats. On Claude, Cowork and Claude in Chrome tasks can be deleted the same way as chats.

**Quick delete:** hover over a chat and click the red trash button next to its ⋮ menu. The chat is deleted right away, without a confirmation step. If you click several in a row, they're deleted one after another.

**Bulk delete:**

1. Click **Bulk delete** in the floating bar at the top of the page.
2. Click chats to select them. Shift-click selects a range.
3. **Load all** scrolls the sidebar until every chat is loaded. **Select all** then selects all of them.
4. Click **Delete N**, then click again to confirm.

**Stop** halts a run after the chat currently being deleted. Press Esc or click ✕ to leave selection mode. To move the bar, drag it by the dotted handle.

**Without the floating bar:** the popup has the same buttons under **On this page** whenever the tab shows one of the supported sites: Bulk delete, then Select all, Load all, Clear, Delete (click twice to confirm) and Done, and Stop while chats are being deleted. It shows the page's progress as it goes. Select chats in the page's sidebar as usual, then open the popup again to delete them. To hide the bar on the page, switch off **Floating bar on the page** in the popup. The setting syncs across your Chrome profile and applies to open tabs straight away. The 🐞 debug button is only in the bar.

## How it works

For each chat, the extension clicks through the site's own UI: ⋮ menu → Delete → confirm. It doesn't call any private APIs, so you get the same result as deleting by hand, just without the clicking. Each chat takes about a second. Keep the tab open while a run is in progress.

Deleted chats can't be restored.

## Publishing

The name and icon don't use any company's branding. If you publish the extension, list the supported sites in the store description, not in the name.

## Download page

`site/` is a one-page website for the extension: a looping demo video (`demo.mp4`, with `poster.webp` as its first frame), the logo (`icon.png`) and name, a short description, a download link and the install tutorial. The hub's card plays `card.mp4`, a smaller copy of the demo (see `../extensions-site/README.md`). `screenshot.webp` is a still picture of the extension; the pages don't use it. It's plain static files, so any static host can serve the folder as-is (GitHub Pages, Netlify, your own server). After changing the extension, rebuild the download, which also updates the size shown on the page:

```powershell
powershell -ExecutionPolicy Bypass -File site\make-zip.ps1
```

The zip holds everything in this folder except `site/` and `store/`. Loading the folder unpacked still works with those two in it; the extension just doesn't use their files.

The page is also linked from the hub site in `../extensions-site`, which copies it in. The install tutorial at the bottom of the page comes from `../extensions-site/install.html`: edit it there, and its `build.ps1` updates this page.

## Chrome Web Store

`make-zip.ps1` also writes the store upload, `store/*.zip`, with `manifest.json` at the top of the zip as the store requires. `store/listing.md` has the text for each tab of the store's developer dashboard, and `store/` holds the 1280x800 screenshot and the 440x280 promo tile.

## Firefox

The same code runs in Firefox 140 and later. `make-zip.ps1` also writes `store/ai-chat-bulk-delete-firefox.zip` for addons.mozilla.org: the store zip with Firefox's settings added to `manifest.json` (its add-on ID `ai-chat-bulk-delete@nikma.xyz`, which must never change once published, the minimum version, and the statement that it collects no data). The scripts call the extension API through `browser` where it exists (Firefox) and `chrome` otherwise, so nothing else differs.

To try it: in Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `manifest.json` inside the unzipped Firefox zip (Firefox removes temporary add-ons when it closes).

## If it stops working

These sites change their pages from time to time. When the extension can't find something, it outlines the chat in red and logs the reason in the DevTools console with the prefix `[AI Chat Bulk Delete]`.

To collect debug info, use the bug button (🐞) in the floating bar:

1. Click 🐞. It turns red and starts recording.
2. Delete one chat by hand: ⋮ → Delete → confirm.
3. Click 🐞 again. The debug info is copied to your clipboard.

The debug info contains the sidebar's structure, the elements you clicked, what appeared after each click, and the page at the step that failed. Chat titles and URLs are masked. That's usually enough to update the finders in `content.js`:

- AI Mode: the `aiMode` object and `AIM` selectors.
- Gemini: the `gemini` object and `GEMINI` selectors.
- Claude: the `claude` object and `CLAUDE` selectors.
- ChatGPT: the `chatgpt` object and `CHATGPT` selectors.

## License

MIT (see `LICENSE`).
