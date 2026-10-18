

// ===================== CONFIGURAÇÃO =====================
const CONFIG = {
  // Tipos de dado sensível. A ordem define a ordem dos cartões na página.
  // "palavra" é procurada no nome da regra DLP.
  SENSIVEIS: [
    { palavra: 'CPF', titulo: 'Envios de CPF', rotulo: 'CPF' },
    { palavra: 'Cartão', titulo: 'Envios de cartão de crédito', rotulo: 'cartão' }
  ],

  // Alta em relação à média das semanas anteriores que marca "Acima do normal" (%).
  LIMITE_ACIMA_DO_NORMAL: 20,

  // Quantos remetentes guardar por semana (os que mais enviaram dados sensíveis).
  MAX_REMETENTES_POR_SEMANA: 50,

  // Semanas carregadas no início (carregarHistorico) e exibidas na página.
  SEMANAS_INICIAIS: 4,
  SEMANAS_NA_PAGINA: 12,

  // Contas ativas sem login há mais desta quantidade de meses entram na lista de inativas.
  MESES_SEM_LOGIN: 2,

  // Hora da atualização automática de segunda-feira (fuso do projeto).
  HORA_ATUALIZACAO: 6,

  NOME_PLANILHA: 'DLP – Histórico semanal',

  // Apps aprovados: não pedem revisão e aparecem só no bloco de aprovados da aba Apps.
  // Basta o nome do app conter um destes termos (maiúsculas não importam).
  // Acrescente as ferramentas oficiais da sua empresa, ex.: 'Slack', 'Zoom'.
  APPS_APROVADOS: ['Google', 'Gmail', 'YouTube', 'Android', 'Chrome'],
  APPS_APROVADOS_TEXTO: 'Google',

  // Regras que não aparecem no painel (continuam guardadas na planilha).
  // Basta o nome da regra conter um destes termos (maiúsculas não importam).
  // Ex.: ['Endereço IP', 'Telefone']
  REGRAS_OCULTAS: []
};

// Acessos considerados sensíveis em apps de terceiros, pelo escopo pedido.
const ESCOPOS_SENSIVEIS = [
  { rotulo: 'E-mail', padroes: ['mail.google.com', '/auth/gmail'] },
  { rotulo: 'Drive', padroes: ['/auth/drive', '/auth/documents', '/auth/spreadsheets'],
    excecoes: ['/auth/drive.file', '/auth/drive.appdata', '/auth/drive.install'] },
  { rotulo: 'Admin', padroes: ['/auth/admin.', '/auth/apps.', '/auth/cloud-platform'] },
  { rotulo: 'Agenda', padroes: ['/auth/calendar'] },
  { rotulo: 'Contatos', padroes: ['/auth/contacts', '/auth/directory.readonly'] }
];

const ABA = {
  REGRAS: 'Resumo semanal',
  REMETENTES: 'Remetentes sensíveis',
  APPS: 'Apps autorizados',
  APPS_CONHECIDOS: 'Apps conhecidos',
  CONTROLE: 'Controle',
  DECISOES: 'Decisões de apps',
  DIAS: 'Progresso diário'
};

// ===================== PÁGINA WEB =====================
function doGet() {
  const t = HtmlService.createTemplateFromFile('Pagina');
  t.dadosJson = JSON.stringify(lerDadosParaPagina_()).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle('Painel DLP – Auditoria Google')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    // Permite exibir o painel dentro do Google Sites. O acesso continua
    // controlado pela implantação ("Quem pode acessar").
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===================== ATUALIZAÇÃO SEMANAL =====================
// Limite de segurança por execução (o Google corta em 6 minutos).
const LIMITE_EXECUCAO_MS = 4 * 60 * 1000;

// Chamada toda segunda pelo agendamento. Se não der tempo de ler a semana
// inteira, agenda a continuação para 1 minuto depois, até terminar.
function atualizarSemanaAnterior() {
  const inicioExecucao = Date.now();
  const planilha = obterPlanilha_();
  const semana = calcularSemana_(new Date(), 1);

  if (semanasGravadas_(planilha)[semana.inicioTxt]) {
    removerContinuacao_('continuarAtualizacao');
    Logger.log('A semana %s a %s já está gravada.', semana.inicioTxt, semana.fimTxt);
    return;
  }

  if (processarSemana_(planilha, semana, inicioExecucao)) {
    removerContinuacao_('continuarAtualizacao');
  } else {
    agendarContinuacao_('continuarAtualizacao');
  }
}

function continuarAtualizacao() {
  atualizarSemanaAnterior();
}

// Carrega as semanas que ainda faltam, da mais antiga para a mais recente.
// Se o tempo ficar perto do limite do Google, para e pede para executar de novo.
function carregarHistorico() {
  const inicioExecucao = Date.now();
  const planilha = obterPlanilha_();
  const gravadas = semanasGravadas_(planilha);

  const faltam = [];
  for (let i = CONFIG.SEMANAS_INICIAIS; i >= 1; i--) {
    const semana = calcularSemana_(new Date(), i);
    if (!gravadas[semana.inicioTxt]) faltam.push(semana);
  }

  while (faltam.length) {
    if (!processarSemana_(planilha, faltam[0], inicioExecucao)) {
      agendarContinuacao_('continuarHistorico');
      Logger.log('Faltam %s semana(s). O carregamento continua sozinho em 1 minuto: acompanhe em Execuções.',
        String(faltam.length));
      return;
    }
    faltam.shift();
  }
  removerContinuacao_('continuarHistorico');
  Logger.log('Histórico carregado. Planilha: %s', planilha.getUrl());
}

function continuarHistorico() {
  carregarHistorico();
}

function agendarContinuacao_(funcao) {
  removerContinuacao_(funcao);
  ScriptApp.newTrigger(funcao).timeBased().after(60 * 1000).create();
  Logger.log('Continuação agendada para daqui a 1 minuto.');
}

function removerContinuacao_(funcao) {
  ScriptApp.getProjectTriggers().forEach(function (g) {
    if (g.getHandlerFunction() === funcao) ScriptApp.deleteTrigger(g);
  });
}

// Semanas lidas por completo (DLP + apps). As demais são refeitas.
function semanasGravadas_(ss) {
  const mapa = {};
  linhas_(ss.getSheetByName(ABA.CONTROLE), 1).forEach(function (l) { mapa[l[0]] = true; });
  return mapa;
}

// Lê a semana um dia por vez e guarda cada dia na aba "Progresso diário".
// Quando os 7 dias estão lidos, soma tudo, lê os apps e grava a semana.
// Retorna false se o tempo acabar antes; a próxima execução continua de onde parou.
function processarSemana_(planilha, semana, inicioExecucao) {
  const abaDias = planilha.getSheetByName(ABA.DIAS);
  const tz = Session.getScriptTimeZone();
  const dias = [];
  for (let d = 0; d < 7; d++) dias.push(somarDias_(semana.inicio, d));
  const chaves = dias.map(function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); });

  Logger.log('Semana %s a %s...', semana.inicioTxt, semana.fimTxt);
  const feitos = diasConcluidos_(abaDias);

  for (let i = 0; i < dias.length; i++) {
    if (feitos[chaves[i]]) continue;
    if (Date.now() - inicioExecucao > LIMITE_EXECUCAO_MS) {
      Logger.log('  Tempo da execução no limite: %s de 7 dias lidos.', String(i));
      return false;
    }
    const fimDia = somarDias_(dias[i], 1);
    const dlp = buscarEventosDlp_(dias[i], fimDia);
    const apps = buscarApps_(dias[i], fimDia);
    gravarDia_(abaDias, chaves[i], dlp, apps);
    Logger.log('  Dia %s: %s eventos DLP, %s apps.', formatarData_(dias[i]), String(dlp.total), String(apps.length));
  }

  const dlp = agregarDias_(abaDias, chaves);
  const apps = consolidarApps_(dlp.apps);

  gravarRegras_(planilha, semana, dlp.porRegra);
  gravarRemetentes_(planilha, semana, dlp.porRemetente);
  gravarApps_(planilha, semana, apps);
  marcarConcluida_(planilha, semana);
  limparDias_(abaDias, chaves);
  Logger.log('Semana %s a %s gravada: %s eventos DLP, %s apps.',
    semana.inicioTxt, semana.fimTxt, String(dlp.total), String(apps.length));
  return true;
}

function gravarDia_(aba, chave, dlp, apps) {
  limparDias_(aba, [chave]);
  const linhas = [];
  Object.keys(dlp.porRegra).forEach(function (regra) {
    linhas.push([chave, 'regra', regra, '', dlp.porRegra[regra]]);
  });
  Object.keys(dlp.porRemetente).forEach(function (email) {
    Object.keys(dlp.porRemetente[email]).forEach(function (palavra) {
      linhas.push([chave, 'remetente', email, palavra, dlp.porRemetente[email][palavra]]);
    });
  });
  apps.forEach(function (a) {
    linhas.push([chave, 'app', a.id, a.nome, a.autorizacoes]);
    if (a.rotulos.length) linhas.push([chave, 'app_acesso', a.id, a.rotulos.join(', '), '']);
    a.listaUsuarios.forEach(function (email) { linhas.push([chave, 'app_usuario', a.id, email, '']); });
  });
  linhas.push([chave, MARCADOR_DIA, '', '', dlp.total]); // marcador: dia lido por completo
  acrescentar_(aba, linhas);
}

// Mudar este texto faz o script reler os dias gravados por versões anteriores.
const MARCADOR_DIA = 'dia_completo';

function diasConcluidos_(aba) {
  const mapa = {};
  linhas_(aba, 2).forEach(function (l) { if (l[1] === MARCADOR_DIA) mapa[l[0]] = true; });
  return mapa;
}

function agregarDias_(aba, chaves) {
  const alvo = {};
  chaves.forEach(function (c) { alvo[c] = true; });
  const porRegra = {};
  const porRemetente = {};
  const apps = {};
  let total = 0;
  function app_(id) {
    if (!apps[id]) apps[id] = { nome: id, autorizacoes: 0, usuarios: {}, rotulos: {} };
    return apps[id];
  }
  linhas_(aba, 5).forEach(function (l) {
    if (!alvo[l[0]]) return;
    const n = numero_(l[4]);
    if (l[1] === 'regra') {
      porRegra[l[2]] = (porRegra[l[2]] || 0) + n;
    } else if (l[1] === 'remetente') {
      if (!porRemetente[l[2]]) porRemetente[l[2]] = {};
      porRemetente[l[2]][l[3]] = (porRemetente[l[2]][l[3]] || 0) + n;
    } else if (l[1] === 'app') {
      const a = app_(l[2]);
      a.nome = l[3] || l[2];
      a.autorizacoes += n;
    } else if (l[1] === 'app_acesso') {
      l[3].split(', ').forEach(function (r) { if (r) app_(l[2]).rotulos[r] = true; });
    } else if (l[1] === 'app_usuario') {
      app_(l[2]).usuarios[l[3]] = true;
    } else if (l[1] === MARCADOR_DIA) {
      total += n;
    }
  });
  return { total: total, porRegra: porRegra, porRemetente: porRemetente, apps: apps };
}

function limparDias_(aba, chaves) {
  if (aba.getLastRow() < 2) return;
  const remover = {};
  chaves.forEach(function (c) { remover[c] = true; });
  const todas = aba.getRange(2, 1, aba.getLastRow() - 1, 5).getDisplayValues();
  const ficam = todas.filter(function (l) { return !remover[l[0]]; });
  aba.getRange(2, 1, todas.length, 5).clearContent();
  if (ficam.length) {
    aba.getRange(2, 1, ficam.length, 2).setNumberFormat('@');
    aba.getRange(2, 1, ficam.length, 5).setValues(ficam);
  }
}

function marcarConcluida_(ss, semana) {
  const aba = ss.getSheetByName(ABA.CONTROLE);
  removerSemana_(aba, semana.inicioTxt);
  acrescentar_(aba, [[semana.inicioTxt, semana.fimTxt,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')]]);
}

// ===================== LOG DE REGRAS DLP =====================
function buscarEventosDlp_(inicio, fim) {
  const porRegra = {};
  const porRemetente = {}; // email -> { CPF: n, Cartão: n }
  let total = 0;
  let pageToken;

  do {
    const resposta = AdminReports.Activities.list('all', 'rules', {
      startTime: inicio.toISOString(),
      endTime: fim.toISOString(),
      maxResults: 1000,
      pageToken: pageToken,
      // Só os campos usados: reduz muito a memória e o tempo.
      fields: 'nextPageToken,items(actor/email,events(parameters(name,value)))'
    });

    (resposta.items || []).forEach(function (atividade) {
      const ator = ((atividade.actor && atividade.actor.email) || '').toLowerCase();
      (atividade.events || []).forEach(function (evento) {
        const regra = nomeDaRegra_(evento.parameters);
        porRegra[regra] = (porRegra[regra] || 0) + 1;
        total++;

        const palavra = palavraSensivel_(regra);
        if (palavra && ator.indexOf('@') > -1) {
          if (!porRemetente[ator]) porRemetente[ator] = {};
          porRemetente[ator][palavra] = (porRemetente[ator][palavra] || 0) + 1;
        }
      });
    });

    pageToken = resposta.nextPageToken;
  } while (pageToken);

  return { total: total, porRegra: porRegra, porRemetente: porRemetente };
}

function nomeDaRegra_(parametros) {
  const lista = parametros || [];
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].name === 'rule_name') return lista[i].value || '(sem nome)';
  }
  return '(sem nome)';
}

function palavraSensivel_(regra) {
  const nome = String(regra).toLowerCase();
  const achou = CONFIG.SENSIVEIS.filter(function (s) {
    return nome.indexOf(s.palavra.toLowerCase()) > -1;
  })[0];
  return achou ? achou.palavra : null;
}

// ===================== APPS DE TERCEIROS =====================
function buscarApps_(inicio, fim) {
  const apps = {};
  let pageToken;

  do {
    const resposta = AdminReports.Activities.list('all', 'token', {
      startTime: inicio.toISOString(),
      endTime: fim.toISOString(),
      eventName: 'authorize',
      maxResults: 1000,
      pageToken: pageToken,
      fields: 'nextPageToken,items(actor/email,events(parameters(name,value,multiValue)))'
    });

    (resposta.items || []).forEach(function (atividade) {
      const usuario = ((atividade.actor && atividade.actor.email) || '').toLowerCase();
      (atividade.events || []).forEach(function (evento) {
        const nome = valorParametro_(evento.parameters, 'app_name')[0] || '';
        const id = valorParametro_(evento.parameters, 'client_id')[0] || nome || '(desconhecido)';
        if (!apps[id]) apps[id] = { id: id, nome: nome || id, usuarios: {}, autorizacoes: 0, escopos: {} };
        const app = apps[id];
        app.autorizacoes++;
        if (usuario) app.usuarios[usuario] = true;
        valorParametro_(evento.parameters, 'scope').forEach(function (e) { app.escopos[e] = true; });
      });
    });

    pageToken = resposta.nextPageToken;
  } while (pageToken);

  return Object.keys(apps).map(function (id) {
    const app = apps[id];
    return {
      id: id,
      nome: app.nome,
      listaUsuarios: Object.keys(app.usuarios),
      autorizacoes: app.autorizacoes,
      rotulos: classificarEscopos_(Object.keys(app.escopos))
    };
  });
}

// Junta apps de vários dias no formato gravado na planilha.
function consolidarApps_(mapa) {
  return Object.keys(mapa).map(function (id) {
    const a = mapa[id];
    const usuarios = Object.keys(a.usuarios).sort();
    const rotulos = ESCOPOS_SENSIVEIS.map(function (g) { return g.rotulo; })
      .filter(function (r) { return a.rotulos[r]; });
    return {
      id: id,
      nome: a.nome,
      usuarios: usuarios.length,
      amostra: usuarios.slice(0, 3).join(', '),
      autorizacoes: a.autorizacoes,
      sensiveis: rotulos.join(', ')
    };
  }).sort(function (a, b) { return b.usuarios - a.usuarios; });
}

function classificarEscopos_(escopos) {
  return ESCOPOS_SENSIVEIS.filter(function (grupo) {
    return escopos.some(function (escopo) {
      const casa = grupo.padroes.some(function (p) { return escopo.indexOf(p) > -1; });
      const exceto = (grupo.excecoes || []).some(function (x) { return escopo.indexOf(x) > -1; });
      return casa && !exceto;
    });
  }).map(function (grupo) { return grupo.rotulo; });
}

// ===================== USUÁRIOS E MFA (situação atual) =====================
// Chamada pela página quando as abas Usuários ou MFA são abertas.
function obterUsuarios() {
  // O cache é só para acelerar: se o armazenamento do Google falhar, segue sem ele.
  let cache = null;
  try {
    cache = CacheService.getScriptCache();
    const emCache = cache.get('usuarios_v2');
    if (emCache) return JSON.parse(emCache);
  } catch (e) {
    Logger.log('Cache indisponível, lendo as contas direto: %s', e);
    cache = null;
  }

  const contas = [];
  let pageToken;
  do {
    const resposta = AdminDirectory.Users.list({
      customer: 'my_customer',
      maxResults: 500,
      orderBy: 'email',
      projection: 'basic',
      pageToken: pageToken
    });
    (resposta.users || []).forEach(function (u) { contas.push(u); });
    pageToken = resposta.nextPageToken;
  } while (pageToken);

  const agora = new Date();
  const limiteInativo = new Date(agora.getTime());
  limiteInativo.setMonth(limiteInativo.getMonth() - CONFIG.MESES_SEM_LOGIN);
  const datasSuspensao = datasDeSuspensao_();

  const suspensas = [];
  const inativas = [];
  const semMfa = [];
  let ativas = 0;
  let comMfa = 0;

  contas.forEach(function (u) {
    const email = u.primaryEmail;
    const unidade = nomeUnidade_(u.orgUnitPath);
    const ultimo = dataValida_(u.lastLoginTime);

    if (u.suspended || u.archived) {
      const desde = datasSuspensao[email.toLowerCase()];
      suspensas.push({
        email: email,
        unidade: unidade,
        desde: desde ? formatarData_(new Date(desde)) : '',
        duracao: desde ? duracao_(new Date(desde), agora) : '',
        ordem: desde ? new Date(desde).getTime() : 0
      });
      return;
    }

    ativas++;

    const referencia = ultimo || dataValida_(u.creationTime);
    if (!ultimo || ultimo < limiteInativo) {
      if (referencia && referencia < limiteInativo) {
        inativas.push({
          email: email,
          unidade: unidade,
          ultimo: ultimo ? formatarData_(ultimo) : 'nunca acessou',
          meses: Math.floor((agora - referencia) / (30 * 864e5)),
          ordem: referencia.getTime()
        });
      }
    }

    if (u.isEnrolledIn2Sv) {
      comMfa++;
    } else {
      semMfa.push({
        email: email,
        unidade: unidade,
        admin: !!(u.isAdmin || u.isDelegatedAdmin),
        ultimo: ultimo ? formatarData_(ultimo) : 'nunca',
        situacao: u.isEnforcedIn2Sv ? 'inscrição pendente' : 'não inscrito'
      });
    }
  });

  suspensas.sort(function (a, b) { return b.ordem - a.ordem; });
  inativas.sort(function (a, b) { return a.ordem - b.ordem; });
  semMfa.sort(function (a, b) {
    if (a.admin !== b.admin) return a.admin ? -1 : 1;
    return a.email < b.email ? -1 : 1;
  });

  const resultado = {
    total: contas.length,
    ativas: ativas,
    suspensas: suspensas,
    inativas: inativas,
    mesesSemLogin: CONFIG.MESES_SEM_LOGIN,
    comMfa: comMfa,
    semMfa: semMfa,
    lidoEm: Utilities.formatDate(agora, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
  };

  try {
    if (cache) cache.put('usuarios_v2', JSON.stringify(resultado), 900); // 15 minutos
  } catch (e) {
    // Cache indisponível ou resultado grande demais: segue sem cache.
  }
  return resultado;
}

// Data da suspensão mais recente de cada conta (log de admin, últimos 180 dias).
function datasDeSuspensao_() {
  const mapa = {};
  try {
    let pageToken;
    do {
      const resposta = AdminReports.Activities.list('all', 'admin', {
        eventName: 'SUSPEND_USER',
        startTime: somarDias_(new Date(), -180).toISOString(),
        maxResults: 1000,
        pageToken: pageToken,
        fields: 'nextPageToken,items(id/time,events(parameters(name,value)))'
      });
      (resposta.items || []).forEach(function (atividade) {
        (atividade.events || []).forEach(function (evento) {
          const email = (valorParametro_(evento.parameters, 'USER_EMAIL')[0] || '').toLowerCase();
          if (email && !mapa[email]) mapa[email] = atividade.id.time;
        });
      });
      pageToken = resposta.nextPageToken;
    } while (pageToken);
  } catch (e) {
    Logger.log('Não foi possível ler as datas de suspensão: %s', e);
  }
  return mapa;
}

function nomeUnidade_(caminho) {
  const limpo = String(caminho || '/').replace(/^\//, '');
  return limpo ? limpo.split('/').join(' · ') : 'Raiz da organização';
}

function dataValida_(texto) {
  if (!texto) return null;
  const d = new Date(texto);
  return isNaN(d) || d.getFullYear() < 1980 ? null : d;
}

function duracao_(desde, agora) {
  const dias = Math.round((agora - desde) / 864e5);
  return dias < 60 ? dias + ' dias' : Math.floor(dias / 30) + ' meses';
}

// ===================== DECISÕES SOBRE APPS (botões da página) =====================
// decisao: 'Aprovado', 'Reprovado' ou '' (desfaz a decisão).
function decidirApp(id, nome, decisao) {
  if (['Aprovado', 'Reprovado', ''].indexOf(decisao) === -1) throw new Error('Decisão inválida.');
  if (!id) throw new Error('App sem identificação.');

  const trava = LockService.getScriptLock();
  trava.waitLock(10000);
  try {
    const aba = obterPlanilha_().getSheetByName(ABA.DECISOES);
    const linhas = linhas_(aba, 1);
    for (let i = linhas.length - 1; i >= 0; i--) {
      if (linhas[i][0] === id) aba.deleteRow(i + 2);
    }
    if (decisao) {
      const quem = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
      aba.appendRow([id, nome, decisao, quem,
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')]);
    }
  } finally {
    trava.releaseLock();
  }
  return { ok: true };
}

function lerDecisoes_(ss) {
  const mapa = {};
  linhas_(ss.getSheetByName(ABA.DECISOES), 3).forEach(function (l) { mapa[l[0]] = l[2]; });
  return mapa;
}

// ===================== PLANILHA DE HISTÓRICO =====================
function obterPlanilha_() {
  const props = PropertiesService.getScriptProperties();
  const id = comTentativas_(function () { return props.getProperty('PLANILHA_ID'); });
  let ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.NOME_PLANILHA);
    comTentativas_(function () { props.setProperty('PLANILHA_ID', ss.getId()); });
  }

  obterAba_(ss, ABA.REGRAS, ['Semana (início)', 'Semana (fim)', 'Regra', 'Eventos']);
  obterAba_(ss, ABA.REMETENTES, ['Semana (início)', 'Semana (fim)', 'Remetente', 'Tipo de dado', 'Eventos']);
  obterAba_(ss, ABA.APPS, ['Semana (início)', 'Semana (fim)', 'App', 'ID do app', 'Usuários',
    'Autorizações', 'Acesso sensível', 'Situação', 'Usuários (amostra)']);
  obterAba_(ss, ABA.APPS_CONHECIDOS, ['ID do app', 'App', 'Visto pela primeira vez (semana)', 'Acesso sensível']);
  obterAba_(ss, ABA.CONTROLE, ['Semana (início)', 'Semana (fim)', 'Concluída em']);
  obterAba_(ss, ABA.DECISOES, ['ID do app', 'App', 'Decisão', 'Por', 'Em']);
  obterAba_(ss, ABA.DIAS, ['Dia', 'Tipo', 'Chave', 'Tipo de dado', 'Eventos']);

  // Remove a aba vazia padrão de planilhas novas.
  const padrao = ss.getSheetByName('Página1') || ss.getSheetByName('Sheet1');
  if (padrao && ss.getSheets().length > 1 && padrao.getLastRow() === 0) ss.deleteSheet(padrao);

  return ss;
}

function obterAba_(ss, nome, cabecalho) {
  let aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.appendRow(cabecalho);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, cabecalho.length)
      .setFontWeight('bold')
      .setBackground('#1E3A5F')
      .setFontColor('#FFFFFF');
  }
  return aba;
}

function gravarRegras_(ss, semana, porRegra) {
  const aba = ss.getSheetByName(ABA.REGRAS);
  removerSemana_(aba, semana.inicioTxt);
  const linhas = Object.keys(porRegra).map(function (regra) {
    return [semana.inicioTxt, semana.fimTxt, regra, porRegra[regra]];
  });
  if (!linhas.length) linhas.push([semana.inicioTxt, semana.fimTxt, '(nenhum evento)', 0]);
  acrescentar_(aba, linhas);
}

function gravarRemetentes_(ss, semana, porRemetente) {
  const aba = ss.getSheetByName(ABA.REMETENTES);
  removerSemana_(aba, semana.inicioTxt);

  const pessoas = Object.keys(porRemetente).map(function (email) {
    const v = porRemetente[email];
    const total = Object.keys(v).reduce(function (s, k) { return s + v[k]; }, 0);
    return { email: email, valores: v, total: total };
  }).sort(function (a, b) { return b.total - a.total; })
    .slice(0, CONFIG.MAX_REMETENTES_POR_SEMANA);

  const linhas = [];
  pessoas.forEach(function (p) {
    Object.keys(p.valores).forEach(function (palavra) {
      linhas.push([semana.inicioTxt, semana.fimTxt, p.email, palavra, p.valores[palavra]]);
    });
  });
  if (linhas.length) acrescentar_(aba, linhas);
}

function gravarApps_(ss, semana, apps) {
  const aba = ss.getSheetByName(ABA.APPS);
  const abaConhecidos = ss.getSheetByName(ABA.APPS_CONHECIDOS);

  const conhecidos = {};
  if (abaConhecidos.getLastRow() > 1) {
    abaConhecidos.getRange(2, 1, abaConhecidos.getLastRow() - 1, 3).getDisplayValues()
      .forEach(function (l) { conhecidos[l[0]] = l[2]; });
  }

  removerSemana_(aba, semana.inicioTxt);

  const novos = [];
  const linhas = apps.map(function (app) {
    const primeiraVez = conhecidos[app.id];
    const situacao = (!primeiraVez || primeiraVez === semana.inicioTxt) ? 'Novo' : 'Conhecido';
    if (!primeiraVez) novos.push([app.id, app.nome, semana.inicioTxt, app.sensiveis]);
    return [semana.inicioTxt, semana.fimTxt, app.nome, app.id, app.usuarios,
      app.autorizacoes, app.sensiveis, situacao, app.amostra];
  });

  if (linhas.length) acrescentar_(aba, linhas);
  if (novos.length) {
    const l = abaConhecidos.getLastRow() + 1;
    abaConhecidos.getRange(l, 3, novos.length, 1).setNumberFormat('@');
    abaConhecidos.getRange(l, 1, novos.length, 4).setValues(novos);
  }
}

// Acrescenta linhas mantendo as duas primeiras colunas (datas) como texto.
function acrescentar_(aba, linhas) {
  const l = aba.getLastRow() + 1;
  aba.getRange(l, 1, linhas.length, 2).setNumberFormat('@');
  aba.getRange(l, 1, linhas.length, linhas[0].length).setValues(linhas);
}

function removerSemana_(aba, inicioTxt) {
  if (aba.getLastRow() < 2) return;
  const coluna = aba.getRange(2, 1, aba.getLastRow() - 1, 1).getDisplayValues();
  for (let i = coluna.length - 1; i >= 0; i--) {
    if (coluna[i][0] === inicioTxt) aba.deleteRow(i + 2);
  }
}

// ===================== DADOS PARA A PÁGINA =====================
function lerDadosParaPagina_() {
  const ss = obterPlanilha_();
  const semanas = {};

  function semana_(inicio, fim) {
    if (!semanas[inicio]) {
      semanas[inicio] = { inicio: inicio, fim: fim, regras: {}, sens: {}, pessoas: {}, apps: [] };
      CONFIG.SENSIVEIS.forEach(function (s) { semanas[inicio].sens[s.palavra] = 0; });
    }
    return semanas[inicio];
  }

  linhas_(ss.getSheetByName(ABA.REGRAS), 4).forEach(function (l) {
    const s = semana_(l[0], l[1]);
    if (l[2] === '(nenhum evento)' || regraOculta_(l[2])) return;
    const n = numero_(l[3]);
    s.regras[l[2]] = n;
    const palavra = palavraSensivel_(l[2]);
    if (palavra) s.sens[palavra] += n;
  });

  const primeiraVezPessoa = {};
  linhas_(ss.getSheetByName(ABA.REMETENTES), 5).forEach(function (l) {
    const s = semana_(l[0], l[1]);
    const email = l[2];
    if (!s.pessoas[email]) s.pessoas[email] = { email: email, valores: {}, total: 0 };
    s.pessoas[email].valores[l[3]] = numero_(l[4]);
    s.pessoas[email].total += numero_(l[4]);
    if (!primeiraVezPessoa[email] || ordem_(l[0]) < ordem_(primeiraVezPessoa[email])) {
      primeiraVezPessoa[email] = l[0];
    }
  });

  const decisoes = lerDecisoes_(ss);
  linhas_(ss.getSheetByName(ABA.APPS), 9).forEach(function (l) {
    const decisao = decisoes[l[3]];
    let situacao = l[7];
    if (decisao === 'Aprovado' || decisao === 'Reprovado') situacao = decisao;
    else if (appAprovado_(l[2])) situacao = 'Aprovado';
    semana_(l[0], l[1]).apps.push({
      nome: l[2], usuarios: numero_(l[4]), autorizacoes: numero_(l[5]),
      sensiveis: l[6] ? l[6].split(', ') : [],
      situacao: situacao, manual: !!decisao,
      amostra: l[8], id: l[3]
    });
  });

  const todas = Object.keys(semanas).sort(function (a, b) { return ordem_(a) - ordem_(b); });
  const primeiraSemana = todas[0];
  const lista = todas.slice(-CONFIG.SEMANAS_NA_PAGINA).map(function (k) {
    const s = semanas[k];
    s.pessoas = Object.keys(s.pessoas).map(function (email) {
      const p = s.pessoas[email];
      p.novo = primeiraVezPessoa[email] === k && k !== primeiraSemana;
      return p;
    }).sort(function (a, b) { return b.total - a.total; });
    const ordemSituacao = { Reprovado: 0, Novo: 1, Conhecido: 2, Aprovado: 3 };
    s.apps.sort(function (a, b) {
      const d = (ordemSituacao[a.situacao] || 0) - (ordemSituacao[b.situacao] || 0);
      return d || b.usuarios - a.usuarios;
    });
    return s;
  });

  return {
    semanas: lista,
    sensiveis: CONFIG.SENSIVEIS,
    limite: CONFIG.LIMITE_ACIMA_DO_NORMAL,
    aprovadosTexto: CONFIG.APPS_APROVADOS_TEXTO,
    urlPlanilha: ss.getUrl(),
    geradoEm: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')
  };
}

function regraOculta_(regra) {
  const n = String(regra).toLowerCase();
  return CONFIG.REGRAS_OCULTAS.some(function (t) { return n.indexOf(t.toLowerCase()) > -1; });
}

function appAprovado_(nome) {
  const n = String(nome).toLowerCase();
  return CONFIG.APPS_APROVADOS.some(function (t) { return n.indexOf(t.toLowerCase()) > -1; });
}

function linhas_(aba, colunas) {
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, colunas).getDisplayValues();
}

function numero_(texto) {
  return Number(String(texto).replace(/\./g, '').replace(',', '.')) || 0;
}

function ordem_(ddmmyyyy) {
  const p = String(ddmmyyyy).split('/');
  return Number(p[2] + p[1] + p[0]);
}

// ===================== AGENDAMENTO =====================
function instalar() {
  desinstalar();
  ScriptApp.newTrigger('atualizarSemanaAnterior')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(CONFIG.HORA_ATUALIZACAO)
    .create();
  Logger.log('Agendado: toda segunda-feira por volta das %sh (fuso %s).',
    CONFIG.HORA_ATUALIZACAO, Session.getScriptTimeZone());
}

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (gatilho) {
    const nome = gatilho.getHandlerFunction();
    if (['atualizarSemanaAnterior', 'enviarRelatorioSemanal',
         'continuarAtualizacao', 'continuarHistorico'].indexOf(nome) > -1) {
      ScriptApp.deleteTrigger(gatilho);
    }
  });
  Logger.log('Agendamentos anteriores removidos.');
}

// ===================== TESTE =====================
function testarConexao() {
  const fim = new Date();

  const dlp = AdminReports.Activities.list('all', 'rules', {
    startTime: somarDias_(fim, -1).toISOString(), endTime: fim.toISOString(), maxResults: 5
  });
  Logger.log('DLP OK. Amostra das últimas 24h: %s eventos', (dlp.items || []).length);
  (dlp.items || []).forEach(function (a) {
    (a.events || []).forEach(function (e) {
      Logger.log('  Regra: %s | Ator: %s | Parâmetros: %s',
        valorParametro_(e.parameters, 'rule_name')[0] || '(sem nome)',
        (a.actor && a.actor.email) || '-',
        (e.parameters || []).map(function (p) { return p.name; }).join(', '));
    });
  });

  const apps = AdminReports.Activities.list('all', 'token', {
    startTime: somarDias_(fim, -7).toISOString(), endTime: fim.toISOString(),
    eventName: 'authorize', maxResults: 5
  });
  Logger.log('Apps OK. Autorizações nos últimos 7 dias (amostra): %s', String((apps.items || []).length));

  const contas = AdminDirectory.Users.list({ customer: 'my_customer', maxResults: 5, projection: 'basic' });
  Logger.log('Diretório OK. Amostra de contas: %s', (contas.users || []).length);
}

// ===================== UTILITÁRIOS =====================
function valorParametro_(parametros, nome) {
  const p = (parametros || []).filter(function (x) { return x.name === nome; })[0];
  if (!p) return [];
  if (p.multiValue) return p.multiValue;
  if (p.value !== undefined) return [p.value];
  if (p.intValue !== undefined) return [String(p.intValue)];
  return [];
}

// semanasAtras = 1 -> semana passada (segunda a domingo); 2 -> retrasada; etc.
function calcularSemana_(referencia, semanasAtras) {
  const tz = Session.getScriptTimeZone();
  const hoje = Utilities.parseDate(
    Utilities.formatDate(referencia, tz, 'yyyy-MM-dd') + ' 00:00:00', tz, 'yyyy-MM-dd HH:mm:ss');
  const diaSemana = Number(Utilities.formatDate(referencia, tz, 'u')); // 1 = segunda ... 7 = domingo
  const segundaAtual = somarDias_(hoje, -(diaSemana - 1));
  const inicio = somarDias_(segundaAtual, -7 * semanasAtras);
  const fim = somarDias_(inicio, 7);
  return {
    inicio: inicio,
    fim: fim,
    inicioTxt: formatarData_(inicio),
    fimTxt: formatarData_(somarDias_(fim, -1))
  };
}

// Repete uma operação algumas vezes quando o Google responde com erro passageiro.
function comTentativas_(fn, vezes) {
  const total = vezes || 3;
  for (let i = 1; i <= total; i++) {
    try {
      return fn();
    } catch (e) {
      if (i === total) throw e;
      Utilities.sleep(600 * i);
    }
  }
}

function somarDias_(data, dias) {
  return new Date(data.getTime() + dias * 864e5);
}

function formatarData_(data) {
  return Utilities.formatDate(data, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}
