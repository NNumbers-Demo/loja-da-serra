'use strict';

const $ = (id) => document.getElementById(id);

const corpoTabela = $('corpo-tabela');
const btnAnalisar = $('btn-analisar');
const aviso = $('analise-aviso');
const analiseCorpo = $('analise-corpo');

let pedidos = [];
let analisePorId = new Map();

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR');

const URGENCIA_TEXTO = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

function formatarMoeda(valor) {
  return moeda.format(Number(valor) || 0);
}

function formatarData(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function el(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

function mostrarAviso(mensagem, erro = false) {
  aviso.textContent = mensagem;
  aviso.classList.toggle('aviso--erro', erro);
  aviso.hidden = false;
}

function esconderAviso() {
  aviso.hidden = true;
  aviso.textContent = '';
  aviso.classList.remove('aviso--erro');
}

function renderResumo(dados) {
  const total = pedidos.reduce((soma, p) => soma + (Number(p.valor) || 0), 0);
  const itens = pedidos.reduce((soma, p) => soma + (Number(p.itens) || 0), 0);
  const clientes = new Set(pedidos.map((p) => p.cliente)).size;
  const cidades = new Set(pedidos.map((p) => p.cidade)).size;

  $('total-pedidos').textContent = numero.format(pedidos.length);
  $('total-clientes').textContent =
    clientes === 1 ? '1 cliente' : `${numero.format(clientes)} clientes`;
  $('total-valor').textContent = formatarMoeda(total);
  $('total-itens').textContent = numero.format(itens);
  $('total-cidades').textContent = numero.format(cidades);
  $('fila-contagem').textContent =
    pedidos.length === 0 ? '' : `${numero.format(pedidos.length)} em separação · ${numero.format(clientes)} clientes`;

  const referencia = formatarData(dados.data_referencia);
  $('data-referencia').textContent = referencia ? `Referência ${referencia}` : 'Referência indisponível';
}

function celulaUrgencia(pedido) {
  const analise = analisePorId.get(String(pedido.id));
  const caixa = el('div', 'urgencia');
  if (!analise) {
    caixa.append(el('span', 'pilula', 'sem análise'));
    return caixa;
  }
  caixa.append(
    el('span', `pilula pilula--${analise.urgencia}`, URGENCIA_TEXTO[analise.urgencia] || analise.urgencia),
  );
  return caixa;
}

function anotacaoPedido(analise) {
  if (!analise) return null;
  const caixa = el('div', 'anotacao');
  caixa.setAttribute('role', 'cell');
  if (analise.motivo) caixa.append(el('span', 'detalhe', analise.motivo));
  if (analise.proxima_acao) {
    const acao = el('span', 'detalhe detalhe--acao');
    acao.append(el('strong', '', 'Ação: '), document.createTextNode(analise.proxima_acao));
    caixa.append(acao);
  }
  return caixa;
}

function linhaPedido(pedido) {
  const linha = el('div', 'linha');
  linha.setAttribute('role', 'row');

  const cliente = el('span', 'cliente', pedido.cliente || '—');
  cliente.setAttribute('role', 'cell');

  const cidade = el('span', 'cidade', pedido.cidade || '—');
  cidade.setAttribute('role', 'cell');

  const itens = el('span', 'itens', numero.format(Number(pedido.itens) || 0));
  itens.setAttribute('role', 'cell');

  const valor = el('span', 'valor-pedido', formatarMoeda(pedido.valor));
  valor.setAttribute('role', 'cell');

  const pedidoInfo = el('div', 'pedido-info');
  pedidoInfo.setAttribute('role', 'cell');
  pedidoInfo.append(el('span', 'pedido-id', String(pedido.id ?? '')));
  const data = formatarData(pedido.data_pedido);
  if (data) pedidoInfo.append(el('span', 'pedido-data', data));

  const urgencia = celulaUrgencia(pedido);
  urgencia.setAttribute('role', 'cell');

  linha.append(cliente, cidade, itens, valor, pedidoInfo, urgencia);

  const anotacao = anotacaoPedido(analisePorId.get(String(pedido.id)));
  if (anotacao) linha.append(anotacao);
  return linha;
}

function renderTabela() {
  corpoTabela.replaceChildren(...pedidos.map(linhaPedido));
  $('vazio').hidden = pedidos.length > 0;
}

function renderAnalise(analise) {
  analisePorId = new Map(analise.pedidos.map((p) => [String(p.id), p]));

  $('analise-resumo').textContent = analise.resumo || '';
  $('analise-prioridade').textContent = analise.prioridade_do_dia || 'Sem prioridade indicada.';

  const totais = analise.totais || { alta: 0, media: 0, baixa: 0 };
  const lista = $('analise-totais');
  lista.replaceChildren(
    ...['alta', 'media', 'baixa'].map((nivel) => {
      const item = el('li', `pilula pilula--${nivel}`);
      item.textContent = `${URGENCIA_TEXTO[nivel]}: ${numero.format(Number(totais[nivel]) || 0)}`;
      return item;
    }),
  );

  analiseCorpo.hidden = false;
  renderTabela();
}

function ordenarPorUrgencia() {
  const peso = { alta: 0, media: 1, baixa: 2 };
  pedidos.sort((a, b) => {
    const ua = analisePorId.get(String(a.id));
    const ub = analisePorId.get(String(b.id));
    const pa = ua ? peso[ua.urgencia] ?? 3 : 3;
    const pb = ub ? peso[ub.urgencia] ?? 3 : 3;
    if (pa !== pb) return pa - pb;
    return String(a.data_pedido).localeCompare(String(b.data_pedido));
  });
}

async function carregar() {
  try {
    const resposta = await fetch('/api/pedidos', { headers: { Accept: 'application/json' } });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();

    pedidos = (Array.isArray(dados.pedidos) ? dados.pedidos : []).slice();
    if (dados.loja) {
      $('loja-nome').textContent = dados.loja;
      document.title = `${dados.loja} · Pedidos em separação`;
    }

    renderResumo(dados);
    renderTabela();

    if (dados.agente_configurado === false) {
      mostrarAviso(
        'A análise automática ainda não está configurada neste ambiente: faltam AGENT_URL e AGENT_TOKEN nos Secrets do projeto. A lista de pedidos continua funcionando.',
      );
    }
  } catch (erro) {
    $('data-referencia').textContent = 'Sem dados';
    $('status-dados').hidden = false;
    mostrarAviso('Não foi possível carregar os pedidos em separação agora.', true);
    $('vazio').hidden = false;
  }
}

async function analisar() {
  esconderAviso();
  btnAnalisar.disabled = true;
  btnAnalisar.dataset.carregando = 'true';
  btnAnalisar.setAttribute('aria-busy', 'true');
  const rotulo = btnAnalisar.querySelector('.botao__texto');
  const rotuloOriginal = rotulo.textContent;
  rotulo.textContent = 'Analisando…';

  try {
    const resposta = await fetch('/api/analisar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      const detalhe = dados?.detalhe ? ` ${dados.detalhe}` : '';
      mostrarAviso(`${dados?.erro || 'A análise falhou.'}${detalhe}`, true);
      return;
    }

    renderAnalise(dados);
    ordenarPorUrgencia();
    renderTabela();
  } catch (erro) {
    mostrarAviso('Não foi possível falar com o servidor para analisar os pedidos.', true);
  } finally {
    btnAnalisar.disabled = false;
    delete btnAnalisar.dataset.carregando;
    btnAnalisar.removeAttribute('aria-busy');
    rotulo.textContent = rotuloOriginal;
  }
}

btnAnalisar.addEventListener('click', analisar);
carregar();
