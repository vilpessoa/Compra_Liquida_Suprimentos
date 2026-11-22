/**
 * Extrator heurístico local (regex), sem rede. Regra de ouro: nunca inventar.
 * Campo sem evidência literal e inequívoca no texto => null + aviso. Todo campo preenchido
 * carrega `trecho`, que é substring literal do texto de entrada.
 */
import type {
  CampoExtraido,
  ItemPropostaExtraido,
  PropostaExtraida,
  QuoteExtractorPort,
} from "@/lib/ports/quote-extractor";
import {
  UFS_VALIDAS,
  cnpjValido,
  formatarCnpj,
  parseNumeroBr,
  semAcentos,
  soDigitos,
} from "./text-utils";

const MAX_ITENS = 500;

const nulo = (): CampoExtraido<never> => ({ valor: null, trecho: null });
const campo = <T>(valor: T, trecho: string): CampoExtraido<T> => ({ valor, trecho });
const curto = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

function itemVazio(): ItemPropostaExtraido {
  return { descricao: nulo(), ncm: nulo(), nbs: nulo(), quantidade: nulo(), unidade: nulo(), valorUnitario: nulo() };
}

/* ----------------------- parsers de valores de célula ----------------------- */

interface Qtd { canonico: string; ambiguo: boolean; unidade: string | null }

export function parseQuantidade(raw: string): Qtd | null {
  const m = /^(\d[\d.,]*?)[.,]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ./²³]{0,14})?$/.exec(raw.trim());
  if (!m) return null;
  const n = parseNumeroBr(m[1]);
  if (!n) return null;
  return { canonico: n.canonico, ambiguo: n.ambiguo, unidade: m[2]?.replace(/\.$/, "") ?? null };
}

export function parseValorUnitario(raw: string): { canonico: string; ambiguo: boolean } | null {
  const m = /^(?:R\$\s*)?(\d[\d.,]*?)[.,]?\s*(?:\/\s*[A-Za-zÀ-ÿ.]{1,10}|cada|por\s+[A-Za-zÀ-ÿ.]{1,12})?$/i.exec(raw.trim());
  if (!m) return null;
  return parseNumeroBr(m[1]);
}

function parseNcm(raw: string): string | null {
  const m = /^(\d{4}\.?\d{2}\.?\d{2})$/.exec(raw.trim());
  return m ? soDigitos(m[1]) : null;
}

function parseNbs(raw: string): string | null {
  const m = /^(\d\.?\d{4}\.?\d{2}\.?\d{2})$/.exec(raw.trim());
  return m ? soDigitos(m[1]) : null;
}

/* ------------------------------- cabeçalhos ------------------------------- */

function extrairCnpj(texto: string, avisos: string[]): CampoExtraido<string> {
  const achados = new Map<string, string>(); // dígitos -> trecho literal
  const invalidos = new Set<string>();
  const registrar = (literal: string) => {
    const d = soDigitos(literal);
    if (cnpjValido(d)) { if (!achados.has(d)) achados.set(d, literal); } else invalidos.add(literal);
  };
  for (const m of texto.matchAll(/(?<![\d./-])(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})(?!\d)/g)) registrar(m[1]);
  for (const m of texto.matchAll(/CNPJ(?:\/MF)?\s*(?:n[º°o.]*)?\s*[:\-]?\s*(\d{14})(?!\d)/gi)) registrar(m[1]);
  for (const inv of invalidos) avisos.push(`CNPJ "${inv}" descartado: dígitos verificadores inválidos.`);
  if (achados.size === 1) {
    const [d, trecho] = [...achados][0];
    return campo(formatarCnpj(d), trecho);
  }
  if (achados.size > 1) avisos.push("Mais de um CNPJ válido no documento: não foi possível determinar o do fornecedor (CNPJ não preenchido).");
  else if (invalidos.size === 0) avisos.push("CNPJ não encontrado no documento.");
  return nulo();
}

function extrairUf(texto: string, avisos: string[]): CampoExtraido<string> {
  const achados = new Map<string, string>();
  for (const m of texto.matchAll(/\b(?:UF|Estado)\s*[:\t]\s*([A-Z]{2})(?![\w])/g)) {
    if (UFS_VALIDAS.has(m[1]) && !achados.has(m[1])) achados.set(m[1], m[0].trim());
  }
  for (const linha of texto.split("\n")) {
    if (!/\bCEP\b|\d{5}-?\d{3}|\b(?:Cidade|Munic[ií]pio|Endere[cç]o|Localidade)\b/i.test(linha)) continue;
    for (const m of linha.matchAll(/([A-Za-zÀ-ÿ'.]+(?: [A-Za-zÀ-ÿ'.]+){0,3} ?[-/] ?([A-Z]{2}))(?![\w-])/g)) {
      if (UFS_VALIDAS.has(m[2]) && !achados.has(m[2])) achados.set(m[2], m[1]);
    }
  }
  if (achados.size === 1) {
    const [uf, trecho] = [...achados][0];
    return campo(uf, trecho);
  }
  avisos.push(
    achados.size > 1
      ? "Mais de uma UF no documento: UF do fornecedor não preenchida."
      : "UF não encontrada de forma explícita (UF:/Estado:/Cidade-UF).",
  );
  return nulo();
}

function extrairRegime(texto: string, avisos: string[]): CampoExtraido<"REGULAR" | "SIMPLES_NACIONAL"> {
  const simples = /(?<!n[ãa]o\s)(?<!n[ãa]o-)\boptante\s+(?:pel[oa]|do|da)\s+Simples\s+Nacional\b|\bRegime\s+(?:Tribut[áa]rio\s*)?[:\-]?\s*Simples\s+Nacional\b/i.exec(texto);
  const regular = /\bRegime\s+(?:Tribut[áa]rio\s*)?[:\-]?\s*(?:Lucro\s+Presumido|Lucro\s+Real|Normal|Regular)\b/i.exec(texto);
  const naoOptante = /\bn[ãa]o[\s-]+optante\s+(?:pel[oa]|do|da)\s+Simples\s+Nacional\b/i.exec(texto);
  if (simples && !regular && !naoOptante) return campo("SIMPLES_NACIONAL", simples[0]);
  if (regular && !simples && !naoOptante) return campo("REGULAR", regular[0]);
  if ((simples ? 1 : 0) + (regular ? 1 : 0) + (naoOptante ? 1 : 0) > 1)
    avisos.push("Declarações conflitantes sobre o regime tributário: não preenchido.");
  else if (naoOptante) avisos.push('Documento diz "não optante pelo Simples Nacional", mas não declara o regime: regime tributário não preenchido.');
  else if (/Simples\s+Nacional|Lucro\s+(?:Presumido|Real)/i.test(texto))
    avisos.push("Menção a regime tributário sem declaração explícita de enquadramento do fornecedor: não preenchido.");
  else avisos.push("Regime tributário não declarado no documento.");
  return nulo();
}

function extrairFornecedor(texto: string, avisos: string[]): CampoExtraido<string> {
  const achados = new Map<string, string>();
  for (const m of texto.matchAll(/(?:^|\|)[ \t]*(Fornecedor|Raz[ãa]o\s+Social|Proponente)[ \t]*(?::[ \t]*|\t)([^\t\n|]+)/gim)) {
    const bruto = m[2];
    const valor = bruto.replace(/\s+(?:CNPJ|CPF|I\.?E\.?|Inscri[çc][ãa]o)\b.*$/i, "").replace(/[\s,;-]+$/, "").trim();
    if (valor.length < 2) continue;
    const fim = m[0].indexOf(bruto) + valor.length;
    const trecho = m[0].slice(0, fim).replace(/^\|/, "").trim();
    if (!achados.has(valor.toLowerCase())) achados.set(valor.toLowerCase(), JSON.stringify([valor, trecho]));
  }
  if (achados.size === 1) {
    const [valor, trecho] = JSON.parse([...achados.values()][0]) as [string, string];
    return campo(valor, trecho);
  }
  avisos.push(
    achados.size > 1
      ? "Mais de um nome de fornecedor rotulado: fornecedor não preenchido."
      : 'Fornecedor não identificado (sem rótulo "Fornecedor:" / "Razão Social:").',
  );
  return nulo();
}

/* --------------------------------- tabelas --------------------------------- */

interface Colunas { desc: number; qtd?: number; un?: number; vu?: number; ncm?: number; nbs?: number }

function celulasDe(linha: string): string[] | null {
  if (linha.includes("\t")) return linha.split("\t").map((c) => c.trim());
  if ((linha.match(/\|/g) ?? []).length >= 2) {
    const c = linha.split("|").map((x) => x.trim());
    if (c[0] === "") c.shift();
    if (c.length && c[c.length - 1] === "") c.pop();
    return c;
  }
  return null;
}

function mapearCabecalho(cells: string[]): Colunas | null {
  const col: Partial<Colunas> = {};
  cells.forEach((bruto, i) => {
    const c = semAcentos(bruto.toLowerCase()).replace(/[.:]/g, "").replace(/\s+/g, " ").trim();
    if (!c) return;
    if (col.desc === undefined && /^(descri|produto|material|servico|especifica)/.test(c)) col.desc = i;
    else if (col.qtd === undefined && /^(qtd|qtde|qde|quant)/.test(c) && !/total|unit/.test(c)) col.qtd = i;
    else if (col.un === undefined && /^(un|und|unid|unidade|um|u m|medida|unidade de medida|unid medida)$/.test(c)) col.un = i;
    else if (col.vu === undefined && ((c.includes("unit") && !c.includes("total")) || c === "preco")) col.vu = i;
    else if (col.ncm === undefined && /^ncm/.test(c)) col.ncm = i;
    else if (col.nbs === undefined && /^nbs/.test(c)) col.nbs = i;
  });
  if (col.desc === undefined || (col.qtd === undefined && col.vu === undefined)) return null;
  return col as Colunas;
}

function linhaDaTabela(
  cells: string[],
  col: Colunas,
  n: number,
  avisos: string[],
): ItemPropostaExtraido | null {
  const at = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
  const desc = at(col.desc);
  if (!desc) return null;
  const item = itemVazio();
  item.descricao = campo(desc, desc);

  const q = at(col.qtd);
  if (q) {
    const p = parseQuantidade(q);
    if (p) {
      item.quantidade = campo(p.canonico, q);
      if (p.ambiguo) avisos.push(`Item ${n}: quantidade "${q}" ambígua (milhar ou decimal); interpretada como milhar — confira.`);
      if (p.unidade && col.un === undefined) item.unidade = campo(p.unidade, q);
    } else avisos.push(`Item ${n}: quantidade "${curto(q)}" não reconhecida — não preenchida.`);
  }
  const u = at(col.un);
  if (u) {
    if (u.length <= 30) item.unidade = campo(u, u);
    else avisos.push(`Item ${n}: unidade "${curto(u)}" longa demais — não preenchida.`);
  }
  const v = at(col.vu);
  if (v) {
    const p = parseValorUnitario(v);
    if (p) {
      item.valorUnitario = campo(p.canonico, v);
      if (p.ambiguo) avisos.push(`Item ${n}: valor unitário "${v}" ambíguo (milhar ou decimal); interpretado como milhar — confira.`);
    } else avisos.push(`Item ${n}: valor unitário "${curto(v)}" não reconhecido — não preenchido.`);
  }
  const ncm = at(col.ncm);
  if (ncm) {
    const d = parseNcm(ncm);
    if (d) item.ncm = campo(d, ncm);
    else avisos.push(`Item ${n}: NCM "${curto(ncm)}" não tem 8 dígitos — não preenchido.`);
  }
  const nbs = at(col.nbs);
  if (nbs) {
    const d = parseNbs(nbs);
    if (d) item.nbs = campo(d, nbs);
    else avisos.push(`Item ${n}: NBS "${curto(nbs)}" não tem 9 dígitos — não preenchido.`);
  }
  return item;
}

/* ------------------------------ texto corrido ------------------------------ */

const ROTULOS: Array<[keyof ItemPropostaExtraido, string]> = [
  ["valorUnitario", String.raw`(?:Valor|Pre[çc]o|Vl\.?|Vlr\.?)\s*(?:Unit[aá]rio|Unit\.?|Unid\.?|Un\.?)|Unit[aá]rio`],
  ["descricao", String.raw`Descri[çc][ãa]o(?:\s+do\s+(?:item|produto))?|Produto|Material|Servi[çc]o|Item(?:\s*(?:n[º°o.]*\s*)?\d+)?`],
  ["quantidade", String.raw`Quantidade|Qtde?\.?|Qtd\.?|Qde\.?`],
  ["unidade", String.raw`Unidade|Unid\.?|Und\.?|UN`],
  ["ncm", String.raw`NCM(?:\/SH)?`],
  ["nbs", String.raw`NBS`],
];
const RE_ROTULO = new RegExp(
  `(?<![\\p{L}\\d])(?:${ROTULOS.map(([k, r]) => `(?<${k}>${r})`).join("|")})\\s*:\\s*`,
  "giu",
);

const UNIDADES = String.raw`un|und|unid|unidades?|p[çc]s?|pe[çc]as?|cx|caixas?|kg|g|mt|m|lt|l|pct|pacotes?|rolos?|pares?|par|kits?|jg|sacos?|gal[ãa]o|fardos?|resmas?|ton`;
const RE_LINHA_ITEM = new RegExp(
  String.raw`^\s*(?:[-*•–]\s*|\d+[.)]\s+)?(?<qu>(?<q>\d+(?:[.,]\d+)*)\s*(?:x\s*)?(?<u>${UNIDADES})\b\.?)\s+(?<resto>.+)$`,
  "iu",
);

function processarLinhaRotulada(
  linha: string,
  atual: { item: ItemPropostaExtraido | null },
  itens: ItemPropostaExtraido[],
  avisos: string[],
): boolean {
  const ms = [...linha.matchAll(RE_ROTULO)];
  if (!ms.length) return false;
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k];
    const chave = (Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0] ?? "") as keyof ItemPropostaExtraido;
    const ini = (m.index ?? 0) + m[0].length;
    const fim = k + 1 < ms.length ? (ms[k + 1].index ?? linha.length) : linha.length;
    const bruto = linha.slice(ini, fim).split(/\t|\s*[|;]\s*/)[0].replace(/[\s,;–-]+$/, "").trim();
    if (!bruto) continue;
    const trecho = linha.slice(m.index ?? 0, ini + linha.slice(ini, fim).indexOf(bruto) - 0 + bruto.length).trim();
    if (!atual.item || atual.item[chave].valor !== null) {
      if (itens.length >= MAX_ITENS) return true;
      atual.item = itemVazio();
      itens.push(atual.item);
    }
    const it = atual.item;
    const n = itens.length;
    switch (chave) {
      case "descricao": it.descricao = campo(bruto, trecho); break;
      case "quantidade": {
        const p = parseQuantidade(bruto);
        if (p) {
          it.quantidade = campo(p.canonico, trecho);
          if (p.unidade && it.unidade.valor === null) it.unidade = campo(p.unidade, trecho);
          if (p.ambiguo) avisos.push(`Item ${n}: quantidade "${bruto}" ambígua (milhar ou decimal); interpretada como milhar — confira.`);
        } else avisos.push(`Item ${n}: quantidade "${curto(bruto)}" não reconhecida — não preenchida.`);
        break;
      }
      case "unidade":
        if (bruto.length <= 30) it.unidade = campo(bruto, trecho);
        break;
      case "valorUnitario": {
        const p = parseValorUnitario(bruto);
        if (p) {
          it.valorUnitario = campo(p.canonico, trecho);
          if (p.ambiguo) avisos.push(`Item ${n}: valor unitário "${bruto}" ambíguo (milhar ou decimal); interpretado como milhar — confira.`);
        } else avisos.push(`Item ${n}: valor unitário "${curto(bruto)}" não reconhecido — não preenchido.`);
        break;
      }
      case "ncm": {
        const d = parseNcm(bruto);
        if (d) it.ncm = campo(d, trecho);
        else avisos.push(`Item ${n}: NCM "${curto(bruto)}" não tem 8 dígitos — não preenchido.`);
        break;
      }
      case "nbs": {
        const d = parseNbs(bruto);
        if (d) it.nbs = campo(d, trecho);
        else avisos.push(`Item ${n}: NBS "${curto(bruto)}" não tem 9 dígitos — não preenchido.`);
        break;
      }
    }
  }
  return true;
}

/** "10 un Caneta azul R$ 1,25 cada" — só aceita preço como unitário com cue explícito. */
function processarLinhaLivre(
  linha: string,
  atual: { item: ItemPropostaExtraido | null },
  itens: ItemPropostaExtraido[],
  avisos: string[],
): boolean {
  const m = RE_LINHA_ITEM.exec(linha);
  if (!m?.groups || itens.length >= MAX_ITENS) return false;
  const q = parseNumeroBr(m.groups.q);
  if (!q) return false;
  let resto = m.groups.resto;
  let preco: { canonico: string; ambiguo: boolean; trecho: string; unitario: boolean } | null = null;
  const pm = /R\$\s*(\d[\d.,]*\d|\d)/.exec(resto);
  if (pm && pm.index !== undefined) {
    const n = parseNumeroBr(pm[1]);
    const antes = resto.slice(0, pm.index);
    const depois = resto.slice(pm.index + pm[0].length);
    const cueDepois = /^\s*(cada\b|\/\s*(?:un|und|unid|p[çc]|pc|cx|kg|m|l|lt)\w*|(?:por|\/)\s*unidade|unit[aá]ri\w*)/i.exec(depois);
    const cueAntes = /(unit[aá]ri\w*|cada|valor\s+unit\w*|pre[çc]o\s+unit\w*)\s*[:\-–]?\s*$/i.exec(antes);
    if (n) {
      const iniT = cueAntes ? cueAntes.index : pm.index;
      const fimT = pm.index + pm[0].length + (cueDepois && !cueAntes ? cueDepois[0].length : 0);
      preco = { ...n, trecho: resto.slice(iniT, fimT).trim(), unitario: Boolean(cueDepois || cueAntes) };
    }
    resto = (cueAntes ? antes.slice(0, cueAntes.index) : antes);
  }
  const desc = resto.replace(/\s+(?:a|à|por|cada|de)?\s*[-–:]*\s*$/i, "").replace(/[\s,;–:-]+$/, "").trim();
  if (!desc) return false;
  const item = itemVazio();
  itens.push(item);
  atual.item = item;
  const n = itens.length;
  item.descricao = campo(desc, desc);
  item.quantidade = campo(q.canonico, m.groups.qu);
  item.unidade = campo(m.groups.u, m.groups.qu);
  if (q.ambiguo) avisos.push(`Item ${n}: quantidade "${m.groups.q}" ambígua (milhar ou decimal); interpretada como milhar — confira.`);
  if (preco) {
    if (preco.unitario) item.valorUnitario = campo(preco.canonico, preco.trecho);
    else avisos.push(`Item ${n}: preço "${preco.trecho}" na linha "${curto(linha)}" sem indicação de unitário ou total — valor unitário não preenchido.`);
  }
  return true;
}

/* -------------------------------- extrator -------------------------------- */

export class HeuristicQuoteExtractor implements QuoteExtractorPort {
  readonly id = "heuristic";

  async extrair(texto: string): Promise<PropostaExtraida> {
    return extrairHeuristico(texto);
  }
}

export function extrairHeuristico(textoBruto: string): PropostaExtraida {
  const texto = textoBruto.replace(/\r\n?/g, "\n");
  const avisos: string[] = [];
  const cnpj = extrairCnpj(texto, avisos);
  const uf = extrairUf(texto, avisos);
  const regimeTributario = extrairRegime(texto, avisos);
  const fornecedor = extrairFornecedor(texto, avisos);

  const linhas = texto.split("\n");
  const itens: ItemPropostaExtraido[] = [];
  const atual: { item: ItemPropostaExtraido | null } = { item: null };
  let tabelaNaoReconhecida = false;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) { atual.item = null; continue; }
    const cells = celulasDe(linha);
    if (cells && cells.length >= 2) {
      const col = mapearCabecalho(cells);
      if (col) {
        let j = i + 1;
        for (; j < linhas.length; j++) {
          const lj = linhas[j];
          const cj = celulasDe(lj);
          if (!lj.trim() || !cj) break;
          const primeira = cj.find((c) => c) ?? "";
          if (/^(sub\s*)?total\b|^valor\s+total\b/i.test(semAcentos(primeira))) break;
          if (itens.length >= MAX_ITENS) break;
          const item = linhaDaTabela(cj, col, itens.length + 1, avisos);
          if (item) itens.push(item);
        }
        i = j - 1;
        atual.item = null;
        continue;
      }
      if ((linha.match(/\t/g) ?? []).length >= 2 || (linha.match(/\|/g) ?? []).length >= 2) {
        // linha tabular sem cabeçalho reconhecível: não tenta adivinhar colunas
        if (/descri|produto|material|qtd|quant|unit/i.test(semAcentos(linha))) tabelaNaoReconhecida = true;
        continue;
      }
    }
    if (processarLinhaRotulada(linha, atual, itens, avisos)) continue;
    processarLinhaLivre(linha, atual, itens, avisos);
  }

  if (tabelaNaoReconhecida && itens.length === 0)
    avisos.push("Há uma tabela cujos cabeçalhos não foram reconhecidos (esperado: Descrição + Qtd/Valor Unitário). Itens não extraídos.");
  if (itens.length === 0) avisos.push("Nenhum item identificado de forma confiável — preencha a grade manualmente.");

  const semNcm = itens.filter((it) => it.ncm.valor === null).length;
  const semNbs = itens.filter((it) => it.nbs.valor === null).length;
  if (semNcm) avisos.push(`NCM não informado explicitamente em ${semNcm} item(ns) — mantido em branco (nunca deduzido da descrição).`);
  if (semNbs) avisos.push(`NBS não informado explicitamente em ${semNbs} item(ns) — mantido em branco (nunca deduzido da descrição).`);
  itens.forEach((it, idx) => {
    const falta: string[] = [];
    if (it.descricao.valor === null) falta.push("descrição");
    if (it.quantidade.valor === null) falta.push("quantidade");
    if (it.valorUnitario.valor === null) falta.push("valor unitário");
    if (falta.length) avisos.push(`Item ${idx + 1}: ${falta.join(", ")} não identificado(s).`);
  });

  return { fornecedor, cnpj, uf, regimeTributario, itens, avisos };
}
