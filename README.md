# localStorage Editor

A small Chrome extension for editing a page's `localStorage` without hand-editing JSON in DevTools.

![icon](icons/128.png)

## Features

- **Form view** — JSON values are expanded into fields: number inputs, checkboxes, text inputs.
- **Grouped by path** — e.g. `state.attributes` and `state.stats` are separate collapsible cards.
- **Search** — filter by key name or value; matching groups open automatically.
- **Set all** — set every numeric field in a group to one value at once.
- **Raw JSON mode** — toggle to a plain text editor for anything the form can't express.
- **Edits stick** — apps that rewrite `localStorage` on unload (autosave) would otherwise overwrite your change. The extension blocks `Storage.setItem` for the reload, so your value survives.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin the extension from the puzzle-piece menu.

## Usage

1. Open the page whose storage you want to change.
2. Click the extension icon and pick a key.
3. Edit fields (use the search box and **Set all** to move faster).
4. Click **Save & reload**.

## How it works

The popup reads `localStorage` of the active tab through `chrome.scripting.executeScript`.
On save it runs in the page's main world: it replaces `Storage.prototype.setItem` with a no-op,
writes the new value with the original `setItem`, then reloads the page.
The patch disappears with the reload, so the app behaves normally afterwards.

## Permissions

| Permission  | Why                                                  |
| ----------- | ---------------------------------------------------- |
| `activeTab` | Access the current tab only after you click the icon |
| `scripting` | Read and write that tab's `localStorage`             |

No network requests, no data leaves your browser.

## Limitations

- Only `localStorage` (not `sessionStorage`, cookies or IndexedDB).
- Values that are encrypted, encoded or signed by the app will be rejected or reset by the app itself.
- Intended for your own data and local experiments.

## License

[MIT](LICENSE)
