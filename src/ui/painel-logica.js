/* Lógica pura do painel (index.html): formatação, variação, mini-gráfico, telas e projeção do mapa.
   Fica em PainelLogica (global no navegador; module.exports no Node, para teste). */
(function () {
  const fmt = (v, casas = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

  // Valor em R$ mil -> unidade legível pelo tamanho (bi, mi ou mil).
  function escalaMoeda(valorMil) {
    const a = Math.abs(valorMil);
    return a >= 1e6 ? { k: 1e-6, unidade: "R$ bi" } : a >= 1e3 ? { k: 1e-3, unidade: "R$ mi" } : { k: 1, unidade: "R$ mil" };
  }

  // Série [[rótulo, valor], ...] -> dado do cartão (último ponto, anterior e série na unidade de exibição).
  // Pontos sem número válido são ignorados (RF-55: ausente nunca vira zero); sem nenhum ponto válido, devolve null.
  function dadoDe(ind, serie) {
    const pts = serie.filter((p) => Array.isArray(p) && typeof p[1] === "number" && Number.isFinite(p[1]));
    if (!pts.length) return null;
    const [per, v] = pts[pts.length - 1], ant = pts[pts.length - 2];
    const { k, unidade } = ind.moeda ? escalaMoeda(v) : { k: 1, unidade: ind.unidade || "" };
    return { v: v * k, per, ant: ant ? ant[1] * k : null, perAnt: ant ? ant[0] : null, serie: pts.map((p) => p[1] * k), unidade };
  }

  function variacao(ind, dado) {
    if (dado.ant == null) return null;
    const d = ind.varUni ? dado.v - dado.ant : dado.ant ? ((dado.v - dado.ant) / dado.ant) * 100 : NaN;
    if (!Number.isFinite(d)) return null;
    const sinal = Math.abs(d) < 0.05 ? 0 : Math.sign(d);
    const varFmt = !sinal ? "estável" : (sinal > 0 ? "+" : "−") + fmt(Math.abs(d), 1) + (ind.varUni ? " " + ind.varUni : "%");
    const aval = !ind.sentido || ind.sentido === "neutro" || !sinal ? "neutro"
      : (sinal > 0) === (ind.sentido === "maior_melhor") ? "bom" : "ruim";
    return {
      temVar: true, varFmt, aval, vs: "vs. " + dado.perAnt,
      seta: sinal > 0 ? "ph-arrow-up-right" : sinal < 0 ? "ph-arrow-down-right" : "ph-minus",
      leitura: { bom: ", variação favorável", ruim: ", variação desfavorável", neutro: "" }[aval],
    };
  }

  function spark(s) {
    const pontos = s.map((v, j) => [j, v]).filter(([, v]) => typeof v === "number" && Number.isFinite(v));
    if (pontos.length < 2) return {};
    const vs = pontos.map(([, v]) => v), hi = Math.max(...vs), lo = Math.min(...vs);
    const faixa = Math.max(hi - lo, Math.abs(hi) * 0.08, 1e-9), base = (hi + lo) / 2 - faixa / 2;
    const xy = pontos.map(([j, v]) => [2 + (j * 68) / (s.length - 1), 22 - ((v - base) / faixa) * 20]);
    const ult = xy[xy.length - 1];
    return { temSerie: true, pts: xy.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "), ux: ult[0].toFixed(1), uy: ult[1].toFixed(1) };
  }

  // Cartão de link (task 37): fonte que o painel não coleta (ou ainda não coleta) mostra título, órgão, descrição e o
  // link da consulta oficial, em vez de "Não coletado". O link só vale se for https em domínio .gov.br (ou tceto.tc.br,
  // o do TCE-TO): qualquer outra coisa é descartada e o cartão cai para "Não coletado" (um erro de configuração visível).
  // O endereço vai para o DOM como atributo, nunca como HTML.
  const DOMINIOS_LINK = ["gov.br", "tceto.tc.br"]; // o domínio e os subdomínios dele (portaldocidadao.tceto.tc.br)
  function linkValido(l) {
    if (!l || typeof l !== "object" || typeof l.url !== "string" || l.url.length === 0 || l.url.length > 300) return null;
    let u;
    try { u = new URL(l.url); } catch (e) { return null; }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!DOMINIOS_LINK.some((d) => h === d || h.endsWith("." + d))) return null;
    const implantacao = l.tipo === "implantacao";
    const tarefa = implantacao && Number.isInteger(l.tarefa) ? " (task " + l.tarefa + ")" : "";
    return {
      url: u.href,
      tag: implantacao ? "Em implantação" + tarefa : "Consulta externa",
      nota: implantacao ? "O painel ainda não coleta esta fonte: coleta em implantação." : "O painel não coleta esta fonte.",
    };
  }

  function cartaoLink(ind, link) {
    return {
      ...ind, temVar: false, temSerie: false, temDado: false, temLink: true, numClasse: "num-vazio", unidade: "",
      valorFmt: link.tag, fonteFmt: ind.orgao || ind.fonte, descricaoFmt: ind.descricao || "", notaFmt: link.nota, linkUrl: link.url,
    };
  }

  // serie: null = "Não coletado" (sem coletor); undefined = carregando; [] ou sem ponto válido = "Sem dado" (a fonte não tem).
  // Com `link` válido e sem dado real, o cartão é de link (nunca "Não coletado", nem "Carregando").
  function cartao(ind, serie) {
    const vazio = (valorFmt) => ({ ...ind, temVar: false, temSerie: false, temDado: false, temLink: false, numClasse: "num-vazio", unidade: "", valorFmt, fonteFmt: ind.fonte });
    const link = linkValido(ind.link);
    const dado = Array.isArray(serie) ? dadoDe(ind, serie) : null;
    if (link && !dado) return cartaoLink(ind, link);
    if (serie === undefined) return vazio("Carregando");
    if (serie === null) return vazio("Não coletado");
    if (!dado) return vazio("Sem dado");
    const casas = ind.moeda ? (dado.unidade === "R$ mil" ? 0 : 1) : ind.casas || 0;
    return {
      ...ind, temVar: false, temSerie: false, temDado: true, temLink: false, numClasse: "", unidade: dado.unidade,
      valorFmt: ind.texto ? String(dado.v) : fmt(dado.v, casas), fonteFmt: ind.fonte + ", " + dado.per,
      ...(variacao(ind, dado) || {}), ...spark(dado.serie),
    };
  }

  const montarBlocos = (blocos, achar) => blocos.map((b) => ({ ...b, itens: b.itens.map((i) => cartao(i, achar(i))) }));

  // Y = cartões de dado (com valor, "Sem dado" ou "Não coletado"); cartões de link ficam fora de X e de Y e entram no sufixo.
  function aviso(blocos, erro) {
    if (erro) return erro;
    const cs = blocos.flatMap((b) => b.itens);
    const links = cs.filter((c) => c.temLink).length;
    const dados = cs.filter((c) => !c.temLink);
    const n = dados.filter((c) => c.temDado).length;
    if (!dados.length && links) return links + (links === 1 ? " indicador" : " indicadores") + " para consultar na fonte oficial";
    const base = n ? n + " de " + dados.length + " indicadores com dados reais" : "Nenhum indicador coletado nesta visão";
    return links ? base + " · " + links + " para consultar na fonte oficial" : base;
  }

  // Telas de até L cartões. Tenta categorias inteiras; se isso exigir mais telas que o mínimo,
  // preenche cada tela até L em ordem e divide a categoria que não couber.
  function montarTelas(blocos, L) {
    const total = blocos.reduce((s, b) => s + b.itens.length, 0);
    const parte = (b, i, n) => ({ ...b, base: b.nome, nome: b.nome + (i ? " (continuação)" : ""), itens: b.itens.slice(i, i + n) });
    const inteiras = [];
    for (const b of blocos) for (let i = 0, min = 0; i < b.itens.length; i += L) {
      const p = parte(b, i, L);
      let k = inteiras.findIndex((x, j) => j >= min && x.total + p.itens.length <= L);
      if (k < 0) k = inteiras.push({ blocos: [], total: 0 }) - 1;
      inteiras[k].blocos.push(p); inteiras[k].total += p.itens.length; min = k + 1;
    }
    if (inteiras.length <= Math.ceil(total / L)) return inteiras;
    const telas = [];
    for (const b of blocos) for (let i = 0; i < b.itens.length;) {
      let t = telas[telas.length - 1];
      if (!t || t.total === L) telas.push((t = { blocos: [], total: 0 }));
      const n = Math.min(L - t.total, b.itens.length - i);
      t.blocos.push(parte(b, i, n)); t.total += n; i += n;
    }
    return telas;
  }

  // GeoJSON dos municípios -> [{ cod, d }] em coordenadas do SVG 360x592; só os códigos presentes em `censo`.
  function projetar(geo, censo) {
    const x0 = -50.7416081857, y1 = -5.1679984383, sx = 5.0444945195, sy = 8.2992791811;
    const k = Math.min((360 - 16) / sx, (592 - 16) / sy);
    const ox = (360 - sx * k) / 2, oy = (592 - sy * k) / 2;
    const pt = ([lon, lat]) => ((lon - x0) * k + ox).toFixed(1) + "," + ((y1 - lat) * k + oy).toFixed(1);
    return geo.features.filter((f) => f && f.geometry && f.properties && censo[f.properties.cod_ibge]).map((f) => {
      const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      const d = polys.map((p) => p.map((anel) => "M" + anel.map(pt).join("L") + "Z").join("")).join("");
      return { cod: f.properties.cod_ibge, d };
    });
  }

  // Nome de urna do TSE (maiúsculas) -> iniciais maiúsculas; partículas no meio do nome ficam minúsculas.
  const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);
  const inicial = (p) => p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1);
  const nomeProprio = (s) => s.toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean)
    .map((p, i) => (i && PARTICULAS.has(p) ? p : p.split("-").map(inicial).join("-"))).join(" ");

  // Titular eleito do painel_dados.json (TO-GER-01, TSE) -> { nome, legenda } ou null se ausente ou inválido.
  // Só aceita texto curto e não vazio (S2); o runtime exibe como texto, nunca como HTML.
  function titular(t) {
    if (!t || typeof t !== "object" || typeof t.nome !== "string") return null;
    const nome = t.nome.trim();
    if (!nome || nome.length > 80) return null;
    const ano = Number.isInteger(t.ano_eleicao) ? "Eleito(a) em " + t.ano_eleicao + " · " : "";
    return { nome: nomeProprio(nome), legenda: ano + "Fonte: TSE" };
  }

  // Situação das fontes (estado_fontes.json, escrito pelo robô diário) -> dados do rodapé, ou null se o arquivo não servir.
  // O texto de status e o ícone dizem a situação; a cor só reforça. Mensagens de erro vão como texto, nunca como HTML.
  const FONTES_ROTULO = {
    "TO-ECO-03": ["População residente", "IBGE"],
    "TO-ECO-01": ["PIB dos municípios", "IBGE"],
    "TO-ECO-02": ["PIB do estado", "IBGE"],
    "TO-TER-02": ["Área territorial", "IBGE"],
    "TO-AGR-01": ["Produção agrícola municipal", "IBGE"],
    "TO-AGR-02": ["Pecuária municipal (rebanho bovino)", "IBGE"],
    "TO-TRA-01": ["Taxa de desocupação", "IBGE"],
    "TO-FIS-04": ["Receita corrente líquida", "Tesouro Nacional"],
    "TO-FIS-02": ["Despesa paga do Estado", "Portal da Transparência TO"],
    "TO-GER-01": ["Prefeitos e governador eleitos", "TSE"],
  };
  const STATUS_FONTE = {
    ok: { rotulo: "Atualizada", icone: "ph-check-circle" },
    defasado: { rotulo: "Defasada", icone: "ph-clock-countdown" },
    erro: { rotulo: "Com falha", icone: "ph-warning" },
    suspeito: { rotulo: "Em análise", icone: "ph-magnifying-glass" },
  };

  const dataHoraBrasilia = (iso) => {
    const d = new Date(iso);
    if (typeof iso !== "string" || isNaN(d)) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]));
    return p.day + "/" + p.month + "/" + p.year + " às " + p.hour + ":" + p.minute;
  };

  // "2023" -> "2023"; "202602" (trimestre) -> "2º trim. 2026"; ausente -> "sem dado".
  const periodoFonte = (p) => (typeof p !== "string" || !p ? "sem dado" : /^\d{6}$/.test(p) ? Number(p.slice(4)) + "º trim. " + p.slice(0, 4) : p);

  function situacaoFontes(estado) {
    if (!estado || typeof estado !== "object" || !estado.fontes || typeof estado.fontes !== "object") return null;
    const verificado = dataHoraBrasilia(estado.ultima_execucao_orquestrador);
    if (!verificado) return null;
    const itens = Object.keys(FONTES_ROTULO).map((id) => {
      const f = estado.fontes[id];
      const st = f && STATUS_FONTE[f.status] ? f.status : "erro";
      const msg = f && st !== "ok" && typeof f.mensagem_erro === "string" ? f.mensagem_erro.slice(0, 300) : "";
      return {
        id, nome: FONTES_ROTULO[id][0], orgao: FONTES_ROTULO[id][1], status: st,
        statusRotulo: STATUS_FONTE[st].rotulo, icone: STATUS_FONTE[st].icone,
        periodo: periodoFonte(f && f.ultimo_periodo_coletado), mensagem: msg, temMensagem: !!msg,
      };
    });
    const ok = itens.filter((i) => i.status === "ok").length;
    const resumo = ok === itens.length ? ok + " de " + itens.length + " fontes atualizadas"
      : ok + " de " + itens.length + " fontes atualizadas, " + (itens.length - ok) + " com atenção";
    return { verificado, resumo, todasOk: ok === itens.length, itens };
  }

  globalThis.PainelLogica = { fmt, escalaMoeda, dadoDe, variacao, spark, cartao, montarBlocos, aviso, montarTelas, projetar, titular, situacaoFontes };
  if (typeof module !== "undefined") module.exports = globalThis.PainelLogica;
})();
