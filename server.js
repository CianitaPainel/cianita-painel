const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JUERI_BASE = 'https://jueri.com.br/sis/api/v1';

app.use(express.json());
app.use(express.static(__dirname));

app.use('/api/jueri/:clienteId/*', async (req, res) => {
  const { clienteId } = req.params;
  const subpath = req.params[0];
  const token = req.headers['x-jueri-token'];

  if (!token) {
    return res.status(401).json({ error: 'Token nao informado' });
  }

  const url = `${JUERI_BASE}/${clienteId}/${subpath}`;
  const params = req.query;

  try {
    const response = await axios({
      method: req.method,
      url,
      params,
      data: req.body,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
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

app.listen(PORT, () => {
  console.log('Cianita Painel rodando na porta ' + PORT);
});
