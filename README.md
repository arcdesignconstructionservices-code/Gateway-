# ARC+ Gateway

Launcher page for the ARC+ tools (Payroll, Inventory, ...). It only links to the tools; each tool keeps its own app and database.

- Add or change tools in `tools.js` (name, description, group, URL, icon), then push.
- `server.js` is a tiny static server (`npm start`), so it deploys on Railway like the other apps.
- Favourites ("My Tools") and the theme are remembered per browser.

```
npm install
npm start      # http://localhost:3000
```
