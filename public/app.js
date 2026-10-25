'use strict';

const ROTULO_STATUS = {
  pago: 'Pago',
  aguardando_pagamento: 'Aguardando pagamento',
  enviado: 'Enviado',
  devolucao_solicitada: 'Devolução solicitada',
  cancelado: 'Cancelado',
};

const ROTULO_URGENCIA = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR');

const el = (id) => document.getElementById(id);

const estado = {
  dados: { loja: 'Loja da Serra', data_referencia: '', pedidos: [] },
  analise: null,
};

function dataCurta(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function diferencaDias(iso) {
  const ref = estado.dados.data_referencia;
  if (!iso || !ref) return null;
  const alvo = Date.parse(`${iso}T00:00:00Z`);
  const base = Date.parse(`${ref}T00:00:00Z`);
  if (Number.isNaN(alvo) || Number.isNaN(base)) return null;
  return Math.round((alvo - base) / 86_400_000);
}

function criar(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

/* ---------------- cartões ---------------- */

function renderCards() {
  const { pedidos, data_referencia } = estado.dados;
  const total = pedidos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const vencidos = pedidos.filter((p) => {
    const d = diferencaDias(p.prazo_entrega);
    return d !== null && d <= 0 && p.status !== 'cancelado';
  }).length;
  const aguardando = pedidos.filter((p) => p.status === 'aguardando_pagamento').length;
  const devolucoes = pedidos.filter((p) => p.status === 'devolucao_solicitada').length;

  const cards = [
    {
      rotulo: 'Pedidos na fila',
      valor: numero.format(pedidos.length),
      nota: `${numero.format(pedidos.reduce((s, p) => s + Number(p.itens || 0), 0))} itens no total`,
    },
    {
      rotulo: 'Valor em carteira',
      valor: moeda.format(total),
      nota: `Referência de ${dataCurta(data_referencia)}`,
    },
    {
      rotulo: 'Prazo hoje ou vencido',
      valor: numero.format(vencidos),
      nota: vencidos ? 'Precisa de saída prioritária' : 'Nenhum prazo estourado',
      alerta: vencidos > 0,
    },
    {
      rotulo: 'Pendências abertas',
      valor: numero.format(aguardando + devolucoes),
      nota: `${aguardando} sem pagamento · ${devolucoes} devolução`,
      alerta: devolucoes > 0,
    },
  ];

  const container = el('cards');
  container.textContent = '';
  for (const c of cards) {
    const card = criar('article', `card${c.alerta ? ' alerta' : ''}`);
    card.append(criar('p', 'card-rotulo', c.rotulo));
    card.append(criar('p', 'card-valor', c.valor));
    card.append(criar('p', 'card-nota', c.nota));
    container.append(card);
  }
}

/* ---------------- pedidos ---------------- */

function ordenarPedidos() {
  const lista = [...estado.dados.pedidos];
  if (estado.analise) {
    const rank = { alta: 0, media: 1, baixa: 2 };
    return lista.sort((a, b) => {
      const ia = estado.analise.pedidos[a.id];
      const ib = estado.analise.pedidos[b.id];
      const ra = ia ? rank[ia.urgencia] : 3;
      const rb = ib ? rank[ib.urgencia] : 3;
      return ra - rb || String(a.id).localeCompare(String(b.id));
    });
  }
  return lista.sort((a, b) => {
    const da = diferencaDias(a.prazo_entrega);
    const db = diferencaDias(b.prazo_entrega);
    return (da ?? 999) - (db ?? 999) || String(a.id).localeCompare(String(b.id));
  });
}

function cardPedido(pedido) {
  const analise = estado.analise?.pedidos?.[pedido.id];
  const urgencia = analise?.urgencia;
  const card = criar('article', 'pedido');
  if (urgencia) card.dataset.urgencia = urgencia;

  const topo = criar('div', 'pedido-topo');
  const bloco = criar('div');
  bloco.append(criar('p', 'pedido-id', pedido.id));
  bloco.append(criar('h3', 'pedido-cliente', pedido.cliente));
  bloco.append(criar('p', 'pedido-cidade', pedido.cidade || '—'));
  topo.append(bloco);

  const selo = criar('span', 'selo', ROTULO_URGENCIA[urgencia] || 'Aguardando IA');
  selo.dataset.u = urgencia || 'pendente';
  topo.append(selo);
  card.append(topo);

  const dados = criar('div', 'pedido-dados');
  dados.append(criar('span', 'tag valor', moeda.format(Number(pedido.valor || 0))));
  dados.append(criar('span', 'tag', `${pedido.itens} ${pedido.itens === 1 ? 'item' : 'itens'}`));

  const dias = diferencaDias(pedido.prazo_entrega);
  const tagPrazo = criar('span', 'tag', `Entrega ${dataCurta(pedido.prazo_entrega)}`);
  if (dias !== null && dias < 0) {
    tagPrazo.classList.add('prazo-atrasado');
    tagPrazo.textContent += ` · ${Math.abs(dias)}d de atraso`;
  } else if (dias === 0) {
    tagPrazo.classList.add('prazo-hoje');
    tagPrazo.textContent += ' · hoje';
  }
  dados.append(tagPrazo);

  const status = criar('span', 'tag status', ROTULO_STATUS[pedido.status] || pedido.status);
  status.dataset.s = pedido.status;
  dados.append(status);
  card.append(dados);

  if (pedido.observacao) {
    card.append(criar('p', 'observacao', pedido.observacao));
  }

  if (analise) {
    const blocoIa = criar('div', 'analise-item');
    if (analise.motivo) blocoIa.append(criar('p', 'motivo', analise.motivo));
    if (analise.proxima_acao) blocoIa.append(criar('p', 'acao', analise.proxima_acao));
    card.append(blocoIa);
  }

  return card;
}

function renderPedidos() {
  const lista = ordenarPedidos();
  const container = el('lista-pedidos');
  container.textContent = '';

  el('pedidos-contagem').textContent = estado.analise
    ? `${lista.length} pedidos · ordenados por urgência`
    : `${lista.length} pedidos · ordenados por prazo`;

  el('vazio').hidden = lista.length > 0;
  for (const pedido of lista) container.append(cardPedido(pedido));
}

/* ---------------- IA ---------------- */

function mostrarAviso(texto, tipo = 'erro') {
  const aviso = el('ia-aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  aviso.classList.toggle('info', tipo === 'info');
}

function esconderAviso() {
  const aviso = el('ia-aviso');
  aviso.hidden = true;
  aviso.textContent = '';
}

function renderAnalise(analise) {
  el('ia-resumo').textContent = analise.resumo || '';
  el('ia-prioridade').textContent = analise.prioridade_do_dia || 'Sem prioridade definida.';

  const lista = el('ia-totais');
  lista.textContent = '';
  for (const chave of ['alta', 'media', 'baixa']) {
    const item = criar('li');
    item.dataset.u = chave;
    item.append(criar('strong', '', String(analise.totais?.[chave] ?? 0)));
    item.append(document.createTextNode(ROTULO_URGENCIA[chave]));
    lista.append(item);
  }

  el('ia-corpo').hidden = false;
}

async function analisar() {
  const botao = el('btn-analisar');
  const rotulo = botao.querySelector('.btn-texto');

  botao.disabled = true;
  botao.classList.add('carregando');
  rotulo.textContent = 'Analisando…';
  esconderAviso();
  mostrarAviso('Consultando o agente de pedidos. Isso pode levar até um minuto.', 'info');

  try {
    const resposta = await fetch('/api/analisar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    const corpo = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      const detalhe = corpo.detalhe ? ` ${corpo.detalhe}` : '';
      mostrarAviso(`${corpo.erro || `Falha na análise (HTTP ${resposta.status})`}.${detalhe}`);
      return;
    }

    const mapa = {};
    for (const item of corpo.pedidos || []) mapa[item.id] = item;

    estado.analise = {
      resumo: corpo.resumo,
      prioridade: corpo.prioridade_do_dia,
      pedidos: mapa,
      totais: corpo.totais,
    };

    esconderAviso();
    renderAnalise(estado.analise);
    renderPedidos();
  } catch (erro) {
    mostrarAviso(`Não foi possível concluir a análise: ${erro.message}`);
  } finally {
    botao.disabled = false;
    botao.classList.remove('carregando');
    rotulo.textContent = estado.analise ? 'Analisar de novo' : 'Analisar com IA';
  }
}

/* ---------------- saúde ---------------- */

async function checarSaude() {
  try {
    const resposta = await fetch('/healthz', { cache: 'no-store' });
    const corpo = await resposta.json();
    const ok = resposta.ok && corpo.status === 'ok';
    el('health-dot').classList.toggle('ok', ok);
    el('health-dot').classList.toggle('erro', !ok);
    el('health-texto').textContent = ok
      ? (corpo.agente_configurado ? 'operando · IA pronta' : 'operando · IA não configurada')
      : 'indisponível';
  } catch {
    el('health-dot').classList.add('erro');
    el('health-texto').textContent = 'indisponível';
  }
}

/* ---------------- início ---------------- */

async function iniciar() {
  el('btn-analisar').addEventListener('click', analisar);
  checarSaude();

  try {
    const resposta = await fetch('/api/pedidos', { cache: 'no-store' });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    estado.dados = await resposta.json();
    el('loja-nome').textContent = estado.dados.loja;
    el('data-ref').textContent = `Referência ${dataCurta(estado.dados.data_referencia)}`;
    renderCards();
    renderPedidos();
  } catch (erro) {
    el('cards').textContent = '';
    el('vazio').hidden = false;
    el('vazio').textContent = `Não foi possível carregar os pedidos (${erro.message}).`;
    mostrarAviso('A lista de pedidos não carregou. Recarregue a página para tentar de novo.');
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
