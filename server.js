const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JUERI_BASE = 'https://jueri.com.br/sis/api/v1';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const DATA_FILE = path.join('/tmp', 'cianita_data.json');

// Cache em memória
const cache = {};

function getCacheKey(token, p) { return token.slice(-8) + '|' + p; }
function getCache(token, p) {
  const k = getCacheKey(token, p);
  const e = cache[k];
  if (!e) return null;
  if (Date.now() - e.timestamp > CACHE_TTL) { delete cache[k]; return null; }
  return e.data;
}
function setCache(token, p, data) {
  cache[getCacheKey(token, p)] = { data, timestamp: Date.now() };
}

// Limpa cache expirado a cada 10 min
setInterval(() => {
  const now = Date.now();
  Object.keys(cache).forEach(k => { if (now - cache[k].timestamp > CACHE_TTL) delete cache[k]; });
}, 10 * 60 * 1000);

// Armazenamento persistente em arquivo (supervisoras, obs, ações)
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) {}
  return { supervisoras: {}, obs: {}, acoes: {} };
}
function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data)); } catch(e) {}
}

app.use(express.json());
app.use(express.static(__dirname));

// API de dados persistentes (supervisoras, obs, ações)
app.get('/api/dados', (req, res) => {
  res.json(loadData());
});

app.post('/api/dados', (req, res) => {
  const atual = loadData();
  const novo = req.body;
  if (novo.supervisoras) atual.supervisoras = { ...atual.supervisoras, ...novo.supervisoras };
  if (novo.obs) atual.obs = { ...atual.obs, ...novo.obs };
  if (novo.acoes) atual.acoes = { ...atual.acoes, ...novo.acoes };
  atual._versao = Date.now();
  saveData(atual);
  res.json({ ok: true });
});

// Limpar cache
app.post('/api/cache/clear', (req, res) => {
  const token = req.headers['x-jueri-token'];
  if (!token) return res.status(401).json({ error: 'Token não informado' });
  const suffix = token.slice(-8);
  Object.keys(cache).forEach(k => { if (k.startsWith(suffix)) delete cache[k]; });
  res.json({ ok: true });
});

// Proxy para o Jueri com cache
app.use('/api/jueri/:clienteId/*', async (req, res) => {
  const { clienteId } = req.params;
  const subpath = req.params[0];
  const token = req.headers['x-jueri-token'];
  if (!token) return res.status(401).json({ error: 'Token não informado' });

  const queryString = new URLSearchParams(req.query).toString();
  const fullPath = subpath + (queryString ? '?' + queryString : '');

  if (req.method === 'GET') {
    const cached = getCache(token, fullPath);
    if (cached) return res.json(cached);
  }

  try {
    const response = await axios({
      method: req.method,
      url: `${JUERI_BASE}/${clienteId}/${subpath}`,
      params: req.query,
      data: req.body,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    if (req.method === 'GET') setCache(token, fullPath, response.data);
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const data = err.response ? err.response.data : { error: err.message };
    res.status(status).json(data);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log('Cianita Painel rodando na porta ' + PORT));
