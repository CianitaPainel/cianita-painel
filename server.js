const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JUERI_BASE = 'https://jueri.com.br/sis/api/v1';
const CACHE_TTL = 5 * 60 * 1000;

const UPSTASH_URL = 'https://pure-boa-106896.upstash.io';
const UPSTASH_TOKEN = 'gQAAAAAAAaGQAAIgcDEzODA1YTQwOTlmOTA0NDllOTdkODE4ZjU1NzcxNjhiMQ';

// Cache em memória para o Jueri
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
setInterval(() => {
  const now = Date.now();
  Object.keys(cache).forEach(k => { if (now - cache[k].timestamp > CACHE_TTL) delete cache[k]; });
}, 10 * 60 * 1000);

// Upstash Redis REST
async function redisGet(key) {
  try {
    const r = await axios.get(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    if (r.data.result) return JSON.parse(r.data.result);
    return null;
  } catch(e) { return null; }
}

async function redisSet(key, value) {
  try {
    await axios.post(`${UPSTASH_URL}/set/${key}`, JSON.stringify(value), {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' }
    });
  } catch(e) { console.error('Redis set error:', e.message); }
}

app.use(express.json());
app.use(express.static(__dirname));

// API de dados persistentes via Upstash
app.get('/api/dados', async (req, res) => {
  const dados = await redisGet('cianita_dados') || { supervisoras: {}, obs: {}, acoes: {}, _versao: 0 };
  res.json(dados);
});

app.post('/api/dados', async (req, res) => {
  const atual = await redisGet('cianita_dados') || { supervisoras: {}, obs: {}, acoes: {}, _versao: 0 };
  const novo = req.body;

  // Supervisoras: merge simples
  if (novo.supervisoras) {
    atual.supervisoras = { ...atual.supervisoras, ...novo.supervisoras };
  }

  // Observações: acumula por consultora (não sobrescreve)
  if (novo.obs) {
    Object.entries(novo.obs).forEach(([id, lista]) => {
      if (!Array.isArray(lista)) return;
      const existentes = atual.obs[id] || [];
      // Adiciona só as que ainda não existem (compara texto + data)
      lista.forEach(novaObs => {
        const jaExiste = existentes.some(e => e.txt === novaObs.txt && e.data === novaObs.data);
        if (!jaExiste) existentes.push(novaObs);
      });
      atual.obs[id] = existentes;
    });
  }

  // Ações: merge por consultora preservando estado de cada ação
  if (novo.acoes) {
    Object.entries(novo.acoes).forEach(([id, lista]) => {
      if (!Array.isArray(lista)) return;
      atual.acoes[id] = lista; // ações são substituídas pois o usuário gerencia a lista
    });
  }

  atual._versao = Date.now();
  await redisSet('cianita_dados', atual);
  res.json({ ok: true });
});

// Limpar cache Jueri
app.post('/api/cache/clear', (req, res) => {
  const token = req.headers['x-jueri-token'];
  if (!token) return res.status(401).json({ error: 'Token não informado' });
  const suffix = token.slice(-8);
  Object.keys(cache).forEach(k => { if (k.startsWith(suffix)) delete cache[k]; });
  res.json({ ok: true });
});

// Proxy Jueri com cache
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
