/**
 * Extratores de texto de arquivos de proposta (PDF, XLSX/XLS, CSV, DOCX).
 * 100% em memória: recebem bytes, devolvem texto. Nenhum arquivo é gravado em disco.
 */
import type { FileTextExtractorPort } from "@/lib/ports/quote-extractor";

export const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
const MAX_LINHAS_POR_ABA = 20000;
const MAX_ABAS = 50;

export class ArquivoInvalidoError extends Error {
  constructor(
    public readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "ArquivoInvalidoError";
  }
}

type Arquivo = { nome: string; mime: string; bytes: Uint8Array };
type Extensao = "pdf" | "xlsx" | "xls" | "csv" | "docx";

const MIME_POR_EXT: Record<Extensao, string[]> = {
  pdf: ["application/pdf"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: ["application/vnd.ms-excel"],
  csv: ["text/csv", "application/csv", "text/plain"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

export function extensaoDe(nome: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(nome.trim());
  return m ? m[1].toLowerCase() : "";
}

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  return sig.every((v, i) => b[offset + i] === v);
}

function contem(b: Uint8Array, texto: string, ate = b.length): boolean {
  return Buffer.from(b.buffer, b.byteOffset, Math.min(ate, b.length)).includes(texto, 0, "latin1");
}

function validarTamanho(a: Arquivo): void {
  if (a.bytes.length === 0) throw new ArquivoInvalidoError(400, "Arquivo vazio.");
  if (a.bytes.length > TAMANHO_MAXIMO_BYTES)
    throw new ArquivoInvalidoError(413, "Arquivo excede o limite de 5 MB.");
}

/** Confere se o conteúdo (magic bytes) é compatível com a extensão declarada. */
function validarAssinatura(ext: Extensao, b: Uint8Array): void {
  const ruim = (rotulo: string) =>
    new ArquivoInvalidoError(415, `O conteúdo do arquivo não corresponde a um ${rotulo} válido (extensão .${ext}).`);
  switch (ext) {
    case "pdf":
      // O cabeçalho %PDF- pode vir até o byte 1024 (ISO 32000).
      if (!contem(b, "%PDF-", 1024)) throw ruim("PDF");
      return;
    case "xls":
      if (!startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw ruim("XLS");
      return;
    case "xlsx":
      if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || !contem(b, "xl/")) throw ruim("XLSX");
      return;
    case "docx":
      if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || !contem(b, "word/")) throw ruim("DOCX");
      return;
    case "csv": {
      // CSV não tem assinatura: rejeita binários (byte NUL) e assinaturas de ZIP/PDF/OLE.
      const amostra = b.subarray(0, 8192);
      if (amostra.includes(0) || startsWith(b, [0x50, 0x4b]) || startsWith(b, [0x25, 0x50, 0x44, 0x46]) || startsWith(b, [0xd0, 0xcf]))
        throw ruim("CSV de texto");
      return;
    }
  }
}

function suportaExt(ext: string, mime: string, nome: string, alvo: Extensao[]): boolean {
  const e = extensaoDe(nome);
  if (e) return (alvo as string[]).includes(e);
  return alvo.some((x) => MIME_POR_EXT[x].includes(mime.toLowerCase()));
}

function limparCelula(s: string): string {
  return s.replace(/[\t\r\n ]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/* -------------------------------- PDF -------------------------------- */

export class PdfTextExtractor implements FileTextExtractorPort {
  readonly id = "pdf-parse";
  suporta(mime: string, nome: string) {
    return suportaExt("pdf", mime, nome, ["pdf"]);
  }
  async extrairTexto(a: Arquivo): Promise<string> {
    validarTamanho(a);
    validarAssinatura("pdf", a.bytes);
    // import dinâmico do caminho interno: evita o código de debug do index.js do pdf-parse.
    const { default: pdf } = await import("pdf-parse/lib/pdf-parse.js");
    let texto: string;
    try {
      const r = await pdf(Buffer.from(a.bytes));
      texto = r.text ?? "";
    } catch {
      throw new ArquivoInvalidoError(400, "Não foi possível ler o PDF (arquivo corrompido ou protegido por senha).");
    }
    texto = texto.replace(/\r\n?/g, "\n").trim();
    if (!texto)
      throw new ArquivoInvalidoError(400, "O PDF não contém texto selecionável (provavelmente é imagem escaneada). OCR não é suportado.");
    return texto;
  }
}

/* ------------------------------ XLSX / XLS ------------------------------ */

export class XlsxTextExtractor implements FileTextExtractorPort {
  readonly id = "xlsx";
  suporta(mime: string, nome: string) {
    return suportaExt("xlsx", mime, nome, ["xlsx", "xls"]);
  }
  async extrairTexto(a: Arquivo): Promise<string> {
    validarTamanho(a);
    const ext = extensaoDe(a.nome) === "xls" ? "xls" : "xlsx";
    validarAssinatura(ext, a.bytes);
    const XLSX = await import("xlsx");
    let wb: import("xlsx").WorkBook;
    try {
      wb = XLSX.read(Buffer.from(a.bytes), { type: "buffer", cellDates: true, cellFormula: false, sheetRows: MAX_LINHAS_POR_ABA });
    } catch {
      throw new ArquivoInvalidoError(400, "Não foi possível ler a planilha (arquivo corrompido ou protegido por senha).");
    }
    const partes: string[] = [];
    for (const nomeAba of wb.SheetNames.slice(0, MAX_ABAS)) {
      const ws = wb.Sheets[nomeAba];
      if (!ws || !ws["!ref"]) continue;
      const range = XLSX.utils.decode_range(ws["!ref"]);
      const linhas: string[] = [];
      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + MAX_LINHAS_POR_ABA - 1); r++) {
        const celulas: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cel = ws[XLSX.utils.encode_cell({ r, c })];
          celulas.push(cel ? textoDaCelula(cel) : "");
        }
        while (celulas.length && celulas[celulas.length - 1] === "") celulas.pop();
        linhas.push(celulas.join("\t"));
      }
      // no máximo uma linha em branco seguida (a heurística usa linha em branco como fim de tabela)
      const compactas = linhas.filter((l, i) => l !== "" || (i > 0 && linhas[i - 1] !== ""));
      const corpo = compactas.join("\n").trim();
      if (corpo) partes.push(`## Aba: ${limparCelula(nomeAba)}\n${corpo}`);
    }
    const texto = partes.join("\n\n");
    if (!texto.trim()) throw new ArquivoInvalidoError(400, "A planilha não contém dados.");
    return texto;
  }
}

/**
 * Células numéricas saem em notação BR (vírgula decimal) a partir do valor bruto — evita
 * ambiguidade entre "1.234" (mil) e 1.234 (decimal) e não depende do formato de exibição.
 */
function textoDaCelula(cel: import("xlsx").CellObject): string {
  if (cel.t === "n" && typeof cel.v === "number") {
    return Number(cel.v.toPrecision(15)).toString().replace(".", ",");
  }
  if (cel.t === "d" && cel.v instanceof Date) {
    return limparCelula(cel.w ?? cel.v.toISOString().slice(0, 10));
  }
  if (cel.t === "b") return cel.v ? "VERDADEIRO" : "FALSO";
  return limparCelula(String(cel.w ?? cel.v ?? ""));
}

/* --------------------------------- CSV --------------------------------- */

export class CsvTextExtractor implements FileTextExtractorPort {
  readonly id = "csv";
  suporta(mime: string, nome: string) {
    return suportaExt("csv", mime, nome, ["csv"]);
  }
  async extrairTexto(a: Arquivo): Promise<string> {
    validarTamanho(a);
    validarAssinatura("csv", a.bytes);
    let texto: string;
    try {
      texto = new TextDecoder("utf-8", { fatal: true }).decode(a.bytes);
    } catch {
      texto = new TextDecoder("windows-1252").decode(a.bytes); // CSVs de Excel BR costumam ser ANSI
    }
    texto = texto.replace(/^﻿/, "");
    const linhas = parseCsv(texto);
    const saida = linhas.map((l) => {
      const c = l.map(limparCelula);
      while (c.length && c[c.length - 1] === "") c.pop();
      return c.join("\t");
    });
    const corpo = saida.filter((l, i) => l !== "" || (i > 0 && saida[i - 1] !== "")).join("\n").trim();
    if (!corpo) throw new ArquivoInvalidoError(400, "O CSV não contém dados.");
    return corpo;
  }
}

/** Parser CSV (aspas RFC 4180) com detecção de delimitador entre ; , tab |. */
export function parseCsv(texto: string): string[][] {
  const primeiras = texto.split(/\r?\n/).slice(0, 10).join("\n");
  const delim = [";", ",", "\t", "|"]
    .map((d) => ({ d, n: primeiras.split(d).length - 1 }))
    .sort((x, y) => y.n - x.n)[0];
  const sep = delim.n > 0 ? delim.d : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cel = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { cel += '"'; i++; } else aspas = false;
      } else cel += ch;
    } else if (ch === '"' && cel === "") aspas = true;
    else if (ch === sep) { linha.push(cel); cel = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(cel); cel = "";
      linhas.push(linha); linha = [];
      if (linhas.length >= MAX_LINHAS_POR_ABA) return linhas;
    } else cel += ch;
  }
  if (cel !== "" || linha.length) { linha.push(cel); linhas.push(linha); }
  return linhas;
}

/* --------------------------------- DOCX --------------------------------- */

export class DocxTextExtractor implements FileTextExtractorPort {
  readonly id = "mammoth";
  suporta(mime: string, nome: string) {
    return suportaExt("docx", mime, nome, ["docx"]);
  }
  async extrairTexto(a: Arquivo): Promise<string> {
    validarTamanho(a);
    validarAssinatura("docx", a.bytes);
    const mammoth = await import("mammoth");
    let html: string;
    try {
      html = (await mammoth.convertToHtml({ buffer: Buffer.from(a.bytes) })).value;
    } catch {
      throw new ArquivoInvalidoError(400, "Não foi possível ler o DOCX (arquivo corrompido).");
    }
    const texto = htmlParaTexto(html);
    if (!texto) throw new ArquivoInvalidoError(400, "O documento DOCX não contém texto.");
    return texto;
  }
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}
const semTags = (s: string) => s.replace(/<[^>]+>/g, " ");

/** HTML do mammoth -> texto; tabelas viram TSV (uma linha por <tr>, cabeçalhos preservados). */
export function htmlParaTexto(html: string): string {
  const comTabelas = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, corpo: string) => {
    const linhas = [...corpo.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
      [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((td) => limparCelula(decodificarEntidades(semTags(td[1].replace(/<\/p>|<br\s*\/?>/gi, " ")))))
        .join("\t"),
    );
    return `\n${linhas.join("\n")}\n`;
  });
  const texto = decodificarEntidades(
    semTags(comTabelas.replace(/<\/(p|h[1-6]|li|div)>|<br\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "- ")).replace(/[  ]+\n/g, "\n"),
  );
  return texto
    .split("\n")
    .map((l) => (l.includes("\t") ? l.trim() : l.replace(/[  ]+/g, " ").trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------ Dispatcher ------------------------------ */

export const EXTRATORES_DE_ARQUIVO: FileTextExtractorPort[] = [
  new PdfTextExtractor(),
  new XlsxTextExtractor(),
  new CsvTextExtractor(),
  new DocxTextExtractor(),
];

export const EXTENSOES_SUPORTADAS = ["pdf", "xlsx", "xls", "csv", "docx"] as const;

/** Escolhe o extrator pelo tipo, valida e extrai. Lança ArquivoInvalidoError (400/413/415). */
export async function extrairTextoDeArquivo(a: Arquivo): Promise<{ texto: string; extrator: string }> {
  validarTamanho(a);
  const ext = extensaoDe(a.nome);
  if (ext === "doc" || ext === "ppt" || ext === "pptx")
    throw new ArquivoInvalidoError(415, `Formato .${ext} não é suportado. Use PDF, XLSX, XLS, CSV ou DOCX, ou cole o texto.`);
  const ex = EXTRATORES_DE_ARQUIVO.find((e) => e.suporta(a.mime, a.nome));
  if (!ex)
    throw new ArquivoInvalidoError(415, "Tipo de arquivo não suportado. Use PDF, XLSX, XLS, CSV ou DOCX, ou cole o texto.");
  return { texto: await ex.extrairTexto(a), extrator: ex.id };
}
