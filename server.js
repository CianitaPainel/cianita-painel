const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JUERI_BASE = 'https://jueri.com.br/sis/api/v1';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Cache em memória: { [token+path]: { data, timestamp } }
const cache = {};

function getCacheKey(token, path) {
  // Usa só os últimos 8 chars do token para a chave (não armazena token completo)
  return token.slice(-8) + '|' + path;
}

function getCache(token, path) {
  const key = getCacheKey(token, path);
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    delete cache[key];
    return null;
  }
  return entry.data;
}

function setCache(token, path, data) {
  const key = getCacheKey(token, path);
  cache[key] = { data, timestamp: Date.now() };
}

// Limpa cache expirado a cada 10 minutos
setInterval(() => {
  const now = Date.now();
  Object.keys(cache).forEach(k => {
    if (now - cache[k].timestamp > CACHE_TTL) delete cache[k];
  });
}, 10 * 60 * 1000);

app.use(express.json());
app.use(express.static(__dirname));

app.use('/api/jueri/:clienteId/*', async (req, res) => {
  const { clienteId } = req.params;
  const subpath = req.params[0];
  const token = req.headers['x-jueri-token'];

  if (!token) {
    return res.status(401).json({ error: 'Token não informado' });
  }

  // Monta URL completa com query string
  const queryString = new URLSearchParams(req.query).toString();
  const fullPath = subpath + (queryString ? '?' + queryString : '');
  const url = `${JUERI_BASE}/${clienteId}/${fullPath}`;

  // Só usa cache para requisições GET
  if (req.method === 'GET') {
    const cached = getCache(token, fullPath);
    if (cached) {
      return res.json(cached);
    }
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

    if (req.method === 'GET') {
      setCache(token, fullPath, response.data);
    }

    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response ? err.response.status : 500;
    const data = err.response ? err.response.data : { error: err.message };
    res.status(status).json(data);
  }
});

// Endpoint para limpar cache manualmente
app.post('/api/cache/clear', (req, res) => {
  const token = req.headers['x-jueri-token'];
  if (!token) return res.status(401).json({ error: 'Token não informado' });
  const suffix = token.slice(-8);
  Object.keys(cache).forEach(k => {
    if (k.startsWith(suffix)) delete cache[k];
  });
  res.json({ ok: true, message: 'Cache limpo' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Cianita Painel rodando na porta ' + PORT);
});
