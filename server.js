'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 8080;
const HOST = '0.0.0.0';

const AGENT_URL = (process.env.AGENT_URL || '').trim();
const AGENT_TOKEN = (process.env.AGENT_TOKEN || '').trim();
const AGENT_TIMEOUT_MS = 65_000;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data', 'pedidos.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const agenteConfigurado = () => Boolean(AGENT_URL && AGENT_TOKEN);

async function carregarPedidos() {
  const bruto = await fsp.readFile(DATA_FILE, 'utf8');
  const dados = JSON.parse(bruto);
  return {
    loja: dados.loja || 'Loja da Serra',
    data_referencia: dados.data_referencia || new Date().toISOString().slice(0, 10),
    pedidos: Array.isArray(dados.pedidos) ? dados.pedidos : [],
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Corpo da requisição muito grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function servirEstatico(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const alvo = path.resolve(PUBLIC_DIR, rel);

  if (alvo !== PUBLIC_DIR && !alvo.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { erro: 'Acesso negado' });
    return;
  }

  let info;
  try {
    info = await fsp.stat(alvo);
  } catch {
    sendJson(res, 404, { erro: 'Não encontrado' });
    return;
  }
  if (!info.isFile()) {
    sendJson(res, 404, { erro: 'Não encontrado' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(alvo).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(alvo).pipe(res);
}

// O agente é síncrono: o endpoint espera até 60s pela resposta.
function urlDoAgente() {
  const separador = AGENT_URL.includes('?') ? '&' : '?';
  return `${AGENT_URL}${separador}wait=60`;
}

function normalizarAnalise(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.pedidos)) return null;
  if (typeof payload.resumo !== 'string') return null;
  const urgencias = ['alta', 'media', 'baixa'];
  return {
    resumo: payload.resumo,
    prioridade_do_dia: typeof payload.prioridade_do_dia === 'string' ? payload.prioridade_do_dia : '',
    pedidos: payload.pedidos.map((p) => ({
      id: String(p?.id ?? ''),
      urgencia: urgencias.includes(p?.urgencia) ? p.urgencia : 'baixa',
      motivo: String(p?.motivo ?? ''),
      proxima_acao: String(p?.proxima_acao ?? ''),
    })),
    totais: {
      alta: Number(payload?.totais?.alta ?? 0),
      media: Number(payload?.totais?.media ?? 0),
      baixa: Number(payload?.totais?.baixa ?? 0),
    },
  };
}

async function analisar(req, res) {
  if (!agenteConfigurado()) {
    sendJson(res, 503, {
      erro: 'Análise não configurada',
      detalhe:
        'Faltam as variáveis AGENT_URL (endpoint do agente) e AGENT_TOKEN (token de acesso) nos Secrets do projeto.',
      configurado: { AGENT_URL: Boolean(AGENT_URL), AGENT_TOKEN: Boolean(AGENT_TOKEN) },
    });
    return;
  }

  try {
    await readBody(req);
  } catch (err) {
    sendJson(res, 413, { erro: 'Requisição inválida', detalhe: err.message });
    return;
  }

  let dados;
  try {
    dados = await carregarPedidos();
  } catch (err) {
    sendJson(res, 500, { erro: 'Falha ao ler os pedidos', detalhe: err.message });
    return;
  }

  // Corpo exatamente como o contrato exige: nada além destes três campos.
  const corpo = {
    loja: dados.loja,
    data_referencia: dados.data_referencia,
    pedidos: dados.pedidos,
  };

  let resposta;
  try {
    resposta = await fetch(urlDoAgente(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${AGENT_TOKEN}`,
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
  } catch (err) {
    const expirou = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    sendJson(res, expirou ? 504 : 502, {
      erro: expirou ? 'O agente não respondeu a tempo' : 'Não foi possível falar com o agente',
      detalhe: expirou
        ? `Tempo limite de ${Math.round(AGENT_TIMEOUT_MS / 1000)}s excedido.`
        : String(err?.message || err),
    });
    return;
  }

  const texto = await resposta.text();

  if (!resposta.ok) {
    sendJson(res, 502, {
      erro: 'O agente respondeu com erro',
      status: resposta.status,
      detalhe: texto.slice(0, 600),
    });
    return;
  }

  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    sendJson(res, 502, { erro: 'Resposta do agente não é JSON válido', detalhe: texto.slice(0, 600) });
    return;
  }

  const analise = normalizarAnalise(bruto);
  if (!analise) {
    sendJson(res, 502, {
      erro: 'Resposta do agente fora do contrato',
      detalhe: 'Eram esperados os campos "resumo", "prioridade_do_dia" e "pedidos".',
    });
    return;
  }

  sendJson(res, 200, analise);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { erro: 'Caminho inválido' });
    return;
  }

  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname === '/api/pedidos') {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }
    carregarPedidos()
      .then((dados) => sendJson(res, 200, { ...dados, agente_configurado: agenteConfigurado() }))
      .catch((err) => sendJson(res, 500, { erro: 'Falha ao ler os pedidos', detalhe: err.message }));
    return;
  }

  if (pathname === '/api/analisar') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    analisar(req, res).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, { erro: 'Erro inesperado', detalhe: String(err?.message || err) });
      }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  servirEstatico(res, pathname).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { erro: 'Erro ao servir o arquivo' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Loja da Serra on http://${HOST}:${PORT}`);
  if (!agenteConfigurado()) {
    console.warn('AGENT_URL/AGENT_TOKEN ausentes: /api/analisar responderá 503.');
  }
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => server.close(() => process.exit(0)));
}
