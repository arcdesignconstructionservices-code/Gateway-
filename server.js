/* ARC+ Gateway — tiny static server (Railway runs `npm start`). */
const express = require('express');
const path = require('path');

const app = express();
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use(express.static(__dirname, { extensions: ['html'], index: 'index.html' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ARC+ Gateway listening on port ' + PORT));
