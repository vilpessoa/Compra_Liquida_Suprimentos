/**
 * Validação de XML contra os XSDs oficiais da Receita Federal, via xmllint-wasm.
 *
 * Os XSDs são lidos do disco em runtime, de <diretorio>/{nfe,nfse}/ (padrão:
 * process.cwd()/public/xsd). A origem dos arquivos está em public/xsd/README.md.
 *
 * A escolha do XSD de entrada segue a raiz do documento, como o TipoXml do repositório
 * oficial (GRUPO -> grupo.xsd, NOTA -> nota.xsd):
 *   NFe / enviNFe / nfeProc -> nota.xsd     infNFe  -> grupo.xsd
 *   NFSe                    -> nota.xsd     infNFSe -> grupo.xsd
 *
 * Nenhuma requisição de rede é feita: xmllint-wasm recebe todos os arquivos já carregados.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { memoryPages, validateXML } from "xmllint-wasm";
import type { XmlValidationResult, XmlValidatorPort } from "@/lib/ports/xml-validator";
import { LIMITE_BYTES_XML } from "@/lib/nfe/parser";

export type TipoXsd = "nfe" | "nfse";

/** Raiz do documento -> arquivo XSD de entrada, dentro de <diretorio>/<tipo>/. */
const ESQUEMA_POR_RAIZ: Record<TipoXsd, Record<string, string>> = {
  nfe: { NFe: "nota.xsd", enviNFe: "nota.xsd", nfeProc: "nota.xsd", infNFe: "grupo.xsd" },
  nfse: { NFSe: "nota.xsd", infNFSe: "grupo.xsd" },
};

type ArquivoXsd = { fileName: string; contents: string };

function raizDoXml(xml: string): string | undefined {
  const semProlog = xml.replace(/^﻿/, "").replace(/^(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->)*/, "");
  const m = /^<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)/.exec(semProlog);
  return m?.[1];
}

async function listarXsd(base: string, relDir = ""): Promise<ArquivoXsd[]> {
  const entradas = await readdir(path.join(base, relDir), { withFileTypes: true });
  const saida: ArquivoXsd[] = [];
  for (const e of entradas) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      saida.push(...(await listarXsd(base, rel)));
    } else if (e.name.endsWith(".xsd")) {
      saida.push({ fileName: rel, contents: await readFile(path.join(base, rel), "utf8") });
    }
  }
  return saida;
}

export class XsdXmlValidator implements XmlValidatorPort {
  readonly id = "xsd-oficial-rfb";
  private readonly cache = new Map<TipoXsd, Promise<ArquivoXsd[]>>();

  constructor(private readonly diretorio: string = path.join(process.cwd(), "public", "xsd")) {}

  private arquivos(tipo: TipoXsd): Promise<ArquivoXsd[]> {
    let p = this.cache.get(tipo);
    if (!p) {
      p = listarXsd(path.join(this.diretorio, tipo));
      this.cache.set(tipo, p);
    }
    return p;
  }

  async validar(xml: string, tipo: TipoXsd): Promise<XmlValidationResult> {
    if (typeof xml !== "string" || xml.trim() === "") {
      return { valido: false, erros: ["XML vazio"], schema: "" };
    }
    if (Buffer.byteLength(xml, "utf8") > LIMITE_BYTES_XML) {
      return { valido: false, erros: [`XML acima do limite de ${LIMITE_BYTES_XML} bytes`], schema: "" };
    }
    if (/<!DOCTYPE/i.test(xml)) {
      return { valido: false, erros: ["DOCTYPE não é permitido"], schema: "" };
    }

    const raiz = raizDoXml(xml);
    const esquema = raiz ? ESQUEMA_POR_RAIZ[tipo][raiz] : undefined;
    if (!esquema) {
      return {
        valido: false,
        erros: [`raiz "${raiz ?? ""}" não é suportada para ${tipo}`],
        schema: "",
      };
    }

    const todos = await this.arquivos(tipo);
    const principal = todos.find((f) => f.fileName === esquema);
    if (!principal) {
      return { valido: false, erros: [`XSD ${tipo}/${esquema} não encontrado em ${this.diretorio}`], schema: "" };
    }
    const dependencias = todos.filter((f) => f.fileName !== esquema);

    const res = await validateXML({
      xml: [{ fileName: "documento.xml", contents: xml }],
      schema: [{ fileName: esquema, contents: principal.contents }],
      preload: dependencias,
      maxMemoryPages: memoryPages.GiB / 8,
    });

    return {
      valido: res.valid,
      erros: res.errors.map((e) => e.message.trim()),
      schema: `${tipo}/${esquema}`,
    };
  }
}
