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

async function loadPedidos() {
  const raw = await fsp.readFile(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  const pedidos = Array.isArray(data.pedidos) ? data.pedidos : [];
  return {
    loja: data.loja || 'Loja da Serra',
    data_referencia: data.data_referencia || new Date().toISOString().slice(0, 10),
    pedidos,
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

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, rel);

  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { erro: 'Acesso negado' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    sendJson(res, 404, { erro: 'Não encontrado' });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { erro: 'Não encontrado' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
}

function agentUrlComWait() {
  const base = AGENT_URL;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}wait=60`;
}

function validarAnalise(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const pedidos = Array.isArray(payload.pedidos) ? payload.pedidos : null;
  if (typeof payload.resumo !== 'string' || !pedidos) return null;
  return {
    resumo: payload.resumo,
    prioridade_do_dia: typeof payload.prioridade_do_dia === 'string' ? payload.prioridade_do_dia : '',
    pedidos: pedidos.map((p) => ({
      id: String(p?.id ?? ''),
      urgencia: ['alta', 'media', 'baixa'].includes(p?.urgencia) ? p.urgencia : 'baixa',
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

async function handleAnalisar(req, res) {
  if (!AGENT_URL || !AGENT_TOKEN) {
    sendJson(res, 503, {
      erro: 'Análise com IA não configurada',
      detalhe:
        'Defina as variáveis de ambiente AGENT_URL (endpoint do agente) e AGENT_TOKEN (token de acesso) e reinicie o serviço.',
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
    dados = await loadPedidos();
  } catch (err) {
    sendJson(res, 500, { erro: 'Falha ao ler os pedidos', detalhe: err.message });
    return;
  }

  const corpo = {
    loja: dados.loja,
    data_referencia: dados.data_referencia,
    pedidos: dados.pedidos,
  };

  let upstream;
  try {
    upstream = await fetch(agentUrlComWait(), {
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

  const texto = await upstream.text();

  if (!upstream.ok) {
    sendJson(res, 502, {
      erro: 'O agente respondeu com erro',
      status: upstream.status,
      detalhe: texto.slice(0, 600),
    });
    return;
  }

  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    sendJson(res, 502, {
      erro: 'Resposta do agente não é JSON válido',
      detalhe: texto.slice(0, 600),
    });
    return;
  }

  const analise = validarAnalise(bruto);
  if (!analise) {
    sendJson(res, 502, {
      erro: 'Resposta do agente fora do contrato',
      detalhe: 'Eram esperados os campos "resumo" e "pedidos".',
    });
    return;
  }

  sendJson(res, 200, analise);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    sendJson(res, 200, {
      status: 'ok',
      uptime_s: Math.round(process.uptime()),
      agente_configurado: Boolean(AGENT_URL && AGENT_TOKEN),
    });
    return;
  }

  if (pathname === '/api/pedidos') {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }
    loadPedidos()
      .then((dados) => sendJson(res, 200, dados))
      .catch((err) => sendJson(res, 500, { erro: 'Falha ao ler os pedidos', detalhe: err.message }));
    return;
  }

  if (pathname === '/api/analisar') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    handleAnalisar(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { erro: 'Erro inesperado', detalhe: String(err?.message || err) });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  serveStatic(res, pathname).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { erro: 'Erro ao servir o arquivo' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Painel da Loja da Serra em http://${HOST}:${PORT}`);
  if (!AGENT_URL || !AGENT_TOKEN) {
    console.warn('AGENT_URL/AGENT_TOKEN ausentes: /api/analisar responderá 503.');
  }
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => server.close(() => process.exit(0)));
}
