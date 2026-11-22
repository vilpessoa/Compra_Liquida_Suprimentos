import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { ArquivoInvalidoError, CsvTextExtractor, DocxTextExtractor, PdfTextExtractor, TAMANHO_MAXIMO_BYTES, XlsxTextExtractor, extrairTextoDeArquivo } from "./file-extractors";
import { HeuristicQuoteExtractor } from "./heuristic-extractor";

// Binários de teste são gerados programaticamente (fixtures de teste), nada em disco.
const enc = (s: string) => new TextEncoder().encode(s);

function xlsxFixture(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Fornecedor", "Acme Teste Ltda"],
    [],
    ["Descrição", "Qtd", "Un", "Valor Unitário"],
    ["Cabo de rede", 100, "m", 2.5],
    ["Conector", 1000, "UN", 0.8],
  ]), "Proposta");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Obs"], ["Frete CIF"]]), "Notas");
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/** DOCX mínimo (zip) montado com o próprio xlsx/cfb? Não: usa JSZip embutido no mammoth via zip manual. */
async function docxFixture(): Promise<Uint8Array> {
  // mammoth depende de jszip; reutilizamos para construir um .docx válido mínimo.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (c: string[]) => `<w:tr>${c.map(cell).join("")}</w:tr>`;
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fornecedor: Docx Teste SA</w:t></w:r></w:p><w:tbl>${row(["Descrição", "Qtd", "Valor Unitário"])}${row(["Mangueira", "10", "R$ 5,00"])}</w:tbl></w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("extratores de arquivo", () => {
  it("XLSX: uma seção TSV por aba, cabeçalhos preservados, números em notação BR", async () => {
    const texto = await new XlsxTextExtractor().extrairTexto({ nome: "p.xlsx", mime: "", bytes: xlsxFixture() });
    expect(texto).toContain("## Aba: Proposta");
    expect(texto).toContain("Descrição\tQtd\tUn\tValor Unitário");
    expect(texto).toContain("Cabo de rede\t100\tm\t2,5");
    expect(texto).toContain("## Aba: Notas");
    const p = await new HeuristicQuoteExtractor().extrair(texto);
    expect(p.fornecedor.valor).toBe("Acme Teste Ltda");
    expect(p.itens.map((i) => i.valorUnitario.valor)).toEqual(["2.5", "0.8"]);
  });

  it("CSV com ; aspas e vírgula decimal vira TSV", async () => {
    const csv = 'Descrição;Qtd;Valor Unitário\n"Fita, larga";10;"1.234,50"\n';
    const texto = await new CsvTextExtractor().extrairTexto({ nome: "a.csv", mime: "text/csv", bytes: enc(csv) });
    expect(texto).toBe("Descrição\tQtd\tValor Unitário\nFita, larga\t10\t1.234,50");
  });

  it("CSV em windows-1252 é decodificado", async () => {
    const bytes = Uint8Array.from([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f, 0x3b, 0x51, 0x74, 0x64]); // "Descrição;Qtd"
    const texto = await new CsvTextExtractor().extrairTexto({ nome: "a.csv", mime: "", bytes });
    expect(texto).toBe("Descrição\tQtd");
  });

  it("DOCX: parágrafos e tabelas (TSV)", async () => {
    const texto = await new DocxTextExtractor().extrairTexto({ nome: "p.docx", mime: "", bytes: await docxFixture() });
    expect(texto).toContain("Fornecedor: Docx Teste SA");
    expect(texto).toContain("Descrição\tQtd\tValor Unitário");
    expect(texto).toContain("Mangueira\t10\tR$ 5,00");
  });

  it("rejeita arquivo > 5 MB (413), vazio (400) e extensão desconhecida (415)", async () => {
    const grande = new Uint8Array(TAMANHO_MAXIMO_BYTES + 1);
    await expect(extrairTextoDeArquivo({ nome: "a.pdf", mime: "", bytes: grande })).rejects.toMatchObject({ status: 413 });
    await expect(extrairTextoDeArquivo({ nome: "a.pdf", mime: "", bytes: new Uint8Array(0) })).rejects.toMatchObject({ status: 400 });
    await expect(extrairTextoDeArquivo({ nome: "a.exe", mime: "", bytes: enc("MZ") })).rejects.toMatchObject({ status: 415 });
    await expect(extrairTextoDeArquivo({ nome: "a.doc", mime: "", bytes: enc("x") })).rejects.toMatchObject({ status: 415 });
  });

  it("magic bytes: extensão não confere com o conteúdo => 415", async () => {
    await expect(new PdfTextExtractor().extrairTexto({ nome: "a.pdf", mime: "", bytes: enc("não sou pdf") })).rejects.toBeInstanceOf(ArquivoInvalidoError);
    await expect(new XlsxTextExtractor().extrairTexto({ nome: "a.xlsx", mime: "", bytes: enc("texto") })).rejects.toMatchObject({ status: 415 });
    await expect(new DocxTextExtractor().extrairTexto({ nome: "a.docx", mime: "", bytes: xlsxFixture() })).rejects.toMatchObject({ status: 415 });
    await expect(new CsvTextExtractor().extrairTexto({ nome: "a.csv", mime: "", bytes: xlsxFixture() })).rejects.toMatchObject({ status: 415 });
  });

  it("PDF corrompido com cabeçalho válido => 400 legível", async () => {
    await expect(new PdfTextExtractor().extrairTexto({ nome: "a.pdf", mime: "", bytes: enc("%PDF-1.4\nlixo") })).rejects.toMatchObject({ status: 400 });
  });
});
