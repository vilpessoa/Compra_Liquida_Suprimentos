/**
 * Parser seguro de NF-e / NFC-e (layout com grupos da reforma tributária).
 *
 * Fonte dos nomes de campo: XSD oficial da Receita Federal (ver public/xsd/README.md):
 *   - leiauteNFe_v4.00.xsd: det/imposto (IS, IBSCBS), total (ISTot, IBSCBSTot), ide/gCompraGov
 *   - DFeTiposBasicos_v1.00.xsd: tipos TTribNFe, TIS, TCIBS, TMonofasia, TIBSCBSMonoTot etc.
 *
 * Regras:
 *   - Campo ausente vira undefined. Nunca se presume 0 ou "".
 *   - Valores decimais são strings exatamente como estão no XML (sem conversão numérica).
 *   - Sem DTD: rejeita DOCTYPE. Não expande entidades. Só decodifica as 5 entidades
 *     predefinidas do XML e referências numéricas (&#..;), uma única passada.
 *   - Limite de 5 MB (UTF-8).
 *
 * Raízes aceitas: enviNFe (com 1 NFe), nfeProc, NFe e infNFe (fragmento de grupos,
 * como os XMLs de teste "grupo" e "entradas" do repositório oficial).
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const LIMITE_BYTES_XML = 5 * 1024 * 1024;

export type CodigoErroParse =
  | "XML_VAZIO"
  | "XML_MUITO_GRANDE"
  | "DTD_NAO_PERMITIDO"
  | "XML_MALFORMADO"
  | "RAIZ_DESCONHECIDA"
  | "INFNFE_NAO_ENCONTRADO"
  | "LOTE_NAO_SUPORTADO"
  | "ELEMENTO_REPETIDO"
  | "ID_INVALIDO";

export class ErroParseNfe extends Error {
  constructor(
    readonly codigo: CodigoErroParse,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroParseNfe";
  }
}

// ---------------------------------------------------------------------------
// Tipos (nomes de campo = nomes do XSD)
// ---------------------------------------------------------------------------

export interface TCompraGov {
  tpEnteGov?: string;
  pRedutor?: string;
  tpOperGov?: string;
}

export interface TIS {
  CSTIS?: string;
  cClassTribIS?: string;
  vBCIS?: string;
  pIS?: string;
  pISEspec?: string;
  uTrib?: string;
  qTrib?: string;
  vIS?: string;
}

export interface TISTot {
  vIS?: string;
}

export interface TDif {
  pDif?: string;
  vDif?: string;
}

export interface TDevTrib {
  vDevTrib?: string;
}

export interface TRed {
  pRedAliq?: string;
  pAliqEfet?: string;
}

export interface TCIBSUF {
  pIBSUF?: string;
  gDif?: TDif;
  gDevTrib?: TDevTrib;
  gRed?: TRed;
  vIBSUF?: string;
}

export interface TCIBSMun {
  pIBSMun?: string;
  gDif?: TDif;
  gDevTrib?: TDevTrib;
  gRed?: TRed;
  vIBSMun?: string;
}

export interface TCCBS {
  pCBS?: string;
  gDif?: TDif;
  gDevTrib?: TDevTrib;
  gRed?: TRed;
  vCBS?: string;
}

export interface TTribRegular {
  CSTReg?: string;
  cClassTribReg?: string;
  pAliqEfetRegIBSUF?: string;
  vTribRegIBSUF?: string;
  pAliqEfetRegIBSMun?: string;
  vTribRegIBSMun?: string;
  pAliqEfetRegCBS?: string;
  vTribRegCBS?: string;
}

export interface TTribCompraGov {
  pAliqIBSUF?: string;
  vTribIBSUF?: string;
  pAliqIBSMun?: string;
  vTribIBSMun?: string;
  pAliqCBS?: string;
  vTribCBS?: string;
}

export interface TCIBS {
  vBC?: string;
  gIBSUF?: TCIBSUF;
  gIBSMun?: TCIBSMun;
  vIBS?: string;
  gCBS?: TCCBS;
  gTribRegular?: TTribRegular;
  gTribCompraGov?: TTribCompraGov;
}

export interface TMonoPadrao {
  qBCMono?: string;
  adRemIBS?: string;
  adRemCBS?: string;
  vIBSMono?: string;
  vCBSMono?: string;
}

export interface TMonoReten {
  qBCMonoReten?: string;
  adRemIBSReten?: string;
  vIBSMonoReten?: string;
  adRemCBSReten?: string;
  vCBSMonoReten?: string;
}

export interface TMonoRet {
  qBCMonoRet?: string;
  adRemIBSRet?: string;
  vIBSMonoRet?: string;
  adRemCBSRet?: string;
  vCBSMonoRet?: string;
}

export interface TMonoDif {
  pDifIBS?: string;
  vIBSMonoDif?: string;
  pDifCBS?: string;
  vCBSMonoDif?: string;
}

export interface TMonofasia {
  gMonoPadrao?: TMonoPadrao;
  gMonoReten?: TMonoReten;
  gMonoRet?: TMonoRet;
  gMonoDif?: TMonoDif;
  vTotIBSMonoItem?: string;
  vTotCBSMonoItem?: string;
}

export interface TTransfCred {
  vIBS?: string;
  vCBS?: string;
}

export interface TAjusteCompet {
  competApur?: string;
  vIBS?: string;
  vCBS?: string;
}

export interface TEstornoCred {
  vIBSEstCred?: string;
  vCBSEstCred?: string;
}

export interface TCredPres {
  pCredPres?: string;
  vCredPres?: string;
  vCredPresCondSus?: string;
}

export interface TCredPresOper {
  vBCCredPres?: string;
  cCredPres?: string;
  gIBSCredPres?: TCredPres;
  gCBSCredPres?: TCredPres;
}

export interface TCredPresIBSZFM {
  competApur?: string;
  tpCredPresIBSZFM?: string;
  vCredPresIBSZFM?: string;
}

/** Tributação IBS/CBS do item (XSD: TTribNFe, elemento imposto/IBSCBS). */
export interface TTribNFe {
  CST?: string;
  cClassTrib?: string;
  indDoacao?: string;
  gIBSCBS?: TCIBS;
  gIBSCBSMono?: TMonofasia;
  gTransfCred?: TTransfCred;
  gAjusteCompet?: TAjusteCompet;
  gEstornoCred?: TEstornoCred;
  gCredPresOper?: TCredPresOper;
  gCredPresIBSZFM?: TCredPresIBSZFM;
}

export interface TTotIBSUF {
  vDif?: string;
  vDevTrib?: string;
  vIBSUF?: string;
}

export interface TTotIBSMun {
  vDif?: string;
  vDevTrib?: string;
  vIBSMun?: string;
}

export interface TTotIBS {
  gIBSUF?: TTotIBSUF;
  gIBSMun?: TTotIBSMun;
  vIBS?: string;
  vCredPres?: string;
  vCredPresCondSus?: string;
}

export interface TTotCBS {
  vDif?: string;
  vDevTrib?: string;
  vCBS?: string;
  vCredPres?: string;
  vCredPresCondSus?: string;
}

export interface TTotMono {
  vIBSMono?: string;
  vCBSMono?: string;
  vIBSMonoReten?: string;
  vCBSMonoReten?: string;
  vIBSMonoRet?: string;
  vCBSMonoRet?: string;
}

export interface TTotEstornoCred {
  vIBSEstCred?: string;
  vCBSEstCred?: string;
}

/** Totais IBS/CBS (XSD: TIBSCBSMonoTot, elemento total/IBSCBSTot). */
export interface TIBSCBSMonoTot {
  vBCIBSCBS?: string;
  gIBS?: TTotIBS;
  gCBS?: TTotCBS;
  gMono?: TTotMono;
  gEstornoCred?: TTotEstornoCred;
}

export interface NfeProd {
  cProd?: string;
  xProd?: string;
  NCM?: string;
  CFOP?: string;
  qCom?: string;
  vUnCom?: string;
  vProd?: string;
}

export interface NfeImposto {
  IS?: TIS;
  IBSCBS?: TTribNFe;
}

export interface NfeItem {
  /** Atributo det/@nItem. */
  nItem?: string;
  prod: NfeProd;
  imposto: NfeImposto;
}

export interface NfeIde {
  natOp?: string;
  mod?: string;
  serie?: string;
  nNF?: string;
  tpAmb?: string;
  gCompraGov?: TCompraGov;
}

export interface NfeEmitente {
  cnpj?: string;
  nome?: string;
  uf?: string;
  cMun?: string;
  crt?: string;
}

export interface NfeDestinatario {
  cnpj?: string;
  cpf?: string;
  idEstrangeiro?: string;
  nome?: string;
  uf?: string;
  cMun?: string;
  indIEDest?: string;
}

export interface NfeTotal {
  ISTot?: TISTot;
  IBSCBSTot?: TIBSCBSMonoTot;
}

export interface NfeDocumento {
  /** Raiz de onde o infNFe foi extraído. */
  origemRaiz: "enviNFe" | "nfeProc" | "NFe" | "infNFe";
  /** Chave de acesso (44 dígitos) extraída de infNFe/@Id. Ausente em fragmentos sem Id. */
  chave?: string;
  dhEmi?: string;
  ide: NfeIde;
  emitente?: NfeEmitente;
  destinatario?: NfeDestinatario;
  itens: NfeItem[];
  total: NfeTotal;
}

// ---------------------------------------------------------------------------
// Especificação de leitura (tipada: o TS exige todas as chaves de T)
// ---------------------------------------------------------------------------

type Spec<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string ? true : Spec<NonNullable<T[K]>>;
};

const SPEC_COMPRA_GOV: Spec<TCompraGov> = { tpEnteGov: true, pRedutor: true, tpOperGov: true };

const SPEC_IS: Spec<TIS> = {
  CSTIS: true,
  cClassTribIS: true,
  vBCIS: true,
  pIS: true,
  pISEspec: true,
  uTrib: true,
  qTrib: true,
  vIS: true,
};

const SPEC_ISTOT: Spec<TISTot> = { vIS: true };

const SPEC_DIF: Spec<TDif> = { pDif: true, vDif: true };
const SPEC_DEVTRIB: Spec<TDevTrib> = { vDevTrib: true };
const SPEC_RED: Spec<TRed> = { pRedAliq: true, pAliqEfet: true };

const SPEC_CIBS_UF: Spec<TCIBSUF> = {
  pIBSUF: true,
  gDif: SPEC_DIF,
  gDevTrib: SPEC_DEVTRIB,
  gRed: SPEC_RED,
  vIBSUF: true,
};

const SPEC_CIBS_MUN: Spec<TCIBSMun> = {
  pIBSMun: true,
  gDif: SPEC_DIF,
  gDevTrib: SPEC_DEVTRIB,
  gRed: SPEC_RED,
  vIBSMun: true,
};

const SPEC_CCBS: Spec<TCCBS> = {
  pCBS: true,
  gDif: SPEC_DIF,
  gDevTrib: SPEC_DEVTRIB,
  gRed: SPEC_RED,
  vCBS: true,
};

const SPEC_TRIB_REGULAR: Spec<TTribRegular> = {
  CSTReg: true,
  cClassTribReg: true,
  pAliqEfetRegIBSUF: true,
  vTribRegIBSUF: true,
  pAliqEfetRegIBSMun: true,
  vTribRegIBSMun: true,
  pAliqEfetRegCBS: true,
  vTribRegCBS: true,
};

const SPEC_TRIB_COMPRA_GOV: Spec<TTribCompraGov> = {
  pAliqIBSUF: true,
  vTribIBSUF: true,
  pAliqIBSMun: true,
  vTribIBSMun: true,
  pAliqCBS: true,
  vTribCBS: true,
};

const SPEC_CIBS: Spec<TCIBS> = {
  vBC: true,
  gIBSUF: SPEC_CIBS_UF,
  gIBSMun: SPEC_CIBS_MUN,
  vIBS: true,
  gCBS: SPEC_CCBS,
  gTribRegular: SPEC_TRIB_REGULAR,
  gTribCompraGov: SPEC_TRIB_COMPRA_GOV,
};

const SPEC_MONOFASIA: Spec<TMonofasia> = {
  gMonoPadrao: {
    qBCMono: true,
    adRemIBS: true,
    adRemCBS: true,
    vIBSMono: true,
    vCBSMono: true,
  },
  gMonoReten: {
    qBCMonoReten: true,
    adRemIBSReten: true,
    vIBSMonoReten: true,
    adRemCBSReten: true,
    vCBSMonoReten: true,
  },
  gMonoRet: {
    qBCMonoRet: true,
    adRemIBSRet: true,
    vIBSMonoRet: true,
    adRemCBSRet: true,
    vCBSMonoRet: true,
  },
  gMonoDif: { pDifIBS: true, vIBSMonoDif: true, pDifCBS: true, vCBSMonoDif: true },
  vTotIBSMonoItem: true,
  vTotCBSMonoItem: true,
};

const SPEC_CRED_PRES: Spec<TCredPres> = {
  pCredPres: true,
  vCredPres: true,
  vCredPresCondSus: true,
};

const SPEC_TRIB_NFE: Spec<TTribNFe> = {
  CST: true,
  cClassTrib: true,
  indDoacao: true,
  gIBSCBS: SPEC_CIBS,
  gIBSCBSMono: SPEC_MONOFASIA,
  gTransfCred: { vIBS: true, vCBS: true },
  gAjusteCompet: { competApur: true, vIBS: true, vCBS: true },
  gEstornoCred: { vIBSEstCred: true, vCBSEstCred: true },
  gCredPresOper: {
    vBCCredPres: true,
    cCredPres: true,
    gIBSCredPres: SPEC_CRED_PRES,
    gCBSCredPres: SPEC_CRED_PRES,
  },
  gCredPresIBSZFM: { competApur: true, tpCredPresIBSZFM: true, vCredPresIBSZFM: true },
};

const SPEC_TOT_IBSCBS: Spec<TIBSCBSMonoTot> = {
  vBCIBSCBS: true,
  gIBS: {
    gIBSUF: { vDif: true, vDevTrib: true, vIBSUF: true },
    gIBSMun: { vDif: true, vDevTrib: true, vIBSMun: true },
    vIBS: true,
    vCredPres: true,
    vCredPresCondSus: true,
  },
  gCBS: { vDif: true, vDevTrib: true, vCBS: true, vCredPres: true, vCredPresCondSus: true },
  gMono: {
    vIBSMono: true,
    vCBSMono: true,
    vIBSMonoReten: true,
    vCBSMonoReten: true,
    vIBSMonoRet: true,
    vCBSMonoRet: true,
  },
  gEstornoCred: { vIBSEstCred: true, vCBSEstCred: true },
};

const SPEC_PROD: Spec<NfeProd> = {
  cProd: true,
  xProd: true,
  NCM: true,
  CFOP: true,
  qCom: true,
  vUnCom: true,
  vProd: true,
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type No = Record<string, unknown>;

const ehNo = (v: unknown): v is No => typeof v === "object" && v !== null && !Array.isArray(v);

const ENTIDADES = new Map<string, string>([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

function cpValido(cp: number): boolean {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
}

/** Decodifica somente as entidades predefinidas e referências numéricas, em uma passada. */
export function decodificarEntidadesXml(texto: string): string {
  return texto.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m: string, corpo: string) => {
    if (corpo[0] === "#") {
      const cp = corpo[1] === "x" ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
      return cpValido(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES.get(corpo) ?? m;
  });
}

function textoDe(v: unknown): string | undefined {
  if (typeof v === "string") return decodificarEntidadesXml(v);
  if (ehNo(v) && typeof v["#text"] === "string") return decodificarEntidadesXml(v["#text"]);
  return undefined;
}

function campo(no: unknown, nome: string): string | undefined {
  return ehNo(no) ? textoDe(no[nome]) : undefined;
}

function filho(no: unknown, nome: string): No {
  const v = ehNo(no) ? no[nome] : undefined;
  if (Array.isArray(v)) {
    throw new ErroParseNfe("ELEMENTO_REPETIDO", `elemento ${nome} aparece mais de uma vez`);
  }
  return ehNo(v) ? v : {};
}

/**
 * Projeta um nó XML segundo a especificação. Grupo presente sem conteúdo vira {}.
 * Elemento repetido onde o XSD espera um só lança erro (não descarta dado em silêncio).
 */
function projetar<T>(no: unknown, spec: Spec<T>): T | undefined {
  if (no === undefined || no === null) return undefined;
  if (typeof no === "string") return {} as T;
  if (!ehNo(no)) return undefined;
  const saida: Record<string, unknown> = {};
  for (const [nome, sub] of Object.entries(spec as unknown as Record<string, true | Spec<unknown>>)) {
    const valor = no[nome];
    if (valor === undefined) continue;
    if (Array.isArray(valor)) {
      throw new ErroParseNfe("ELEMENTO_REPETIDO", `elemento ${nome} aparece mais de uma vez`);
    }
    if (sub === true) {
      const t = textoDe(valor);
      if (t !== undefined) saida[nome] = t;
    } else {
      const g = projetar(valor, sub);
      if (g !== undefined) saida[nome] = g;
    }
  }
  return saida as T;
}

function lerEmitente(no: unknown): NfeEmitente | undefined {
  if (!ehNo(no)) return undefined;
  const ender = filho(no, "enderEmit");
  return {
    cnpj: campo(no, "CNPJ"),
    nome: campo(no, "xNome"),
    uf: campo(ender, "UF"),
    cMun: campo(ender, "cMun"),
    crt: campo(no, "CRT"),
  };
}

function lerDestinatario(no: unknown): NfeDestinatario | undefined {
  if (!ehNo(no)) return undefined;
  const ender = filho(no, "enderDest");
  return {
    cnpj: campo(no, "CNPJ"),
    cpf: campo(no, "CPF"),
    idEstrangeiro: campo(no, "idEstrangeiro"),
    nome: campo(no, "xNome"),
    uf: campo(ender, "UF"),
    cMun: campo(ender, "cMun"),
    indIEDest: campo(no, "indIEDest"),
  };
}

function lerItem(det: unknown): NfeItem {
  const imposto = filho(det, "imposto");
  return {
    nItem: campo(det, "@_nItem"),
    prod: projetar(filho(det, "prod"), SPEC_PROD) ?? {},
    imposto: {
      IS: projetar(imposto.IS, SPEC_IS),
      IBSCBS: projetar(imposto.IBSCBS, SPEC_TRIB_NFE),
    },
  };
}

/** Localiza o infNFe conforme a raiz. NFe/enviNFe/nfeProc podem chegar como array (isArray). */
function localizarInfNFe(arvore: No): { origemRaiz: NfeDocumento["origemRaiz"]; inf: No } {
  const raizes = Object.keys(arvore).filter((k) => !k.startsWith("?") && !k.startsWith("!"));
  if (raizes.length !== 1) {
    throw new ErroParseNfe("RAIZ_DESCONHECIDA", "documento deve ter exatamente um elemento raiz");
  }
  const raiz = raizes[0];

  const umaNFe = (lista: unknown): No => {
    const itens = Array.isArray(lista) ? lista : [lista];
    if (itens.length !== 1) {
      throw new ErroParseNfe(
        "LOTE_NAO_SUPORTADO",
        `lote com ${itens.length} NF-e não é suportado por este parser (uma por vez)`,
      );
    }
    const inf = filho(itens[0], "infNFe");
    if (Object.keys(inf).length === 0) {
      throw new ErroParseNfe("INFNFE_NAO_ENCONTRADO", "elemento infNFe ausente");
    }
    return inf;
  };

  switch (raiz) {
    case "enviNFe":
      return { origemRaiz: "enviNFe", inf: umaNFe(filho(arvore, "enviNFe")["NFe"]) };
    case "nfeProc":
      return { origemRaiz: "nfeProc", inf: umaNFe(ehNo(arvore.nfeProc) ? arvore.nfeProc["NFe"] : undefined) };
    case "NFe":
      return { origemRaiz: "NFe", inf: umaNFe(arvore.NFe) };
    case "infNFe": {
      const inf = arvore.infNFe;
      if (!ehNo(inf)) {
        throw new ErroParseNfe("INFNFE_NAO_ENCONTRADO", "elemento infNFe ausente");
      }
      return { origemRaiz: "infNFe", inf };
    }
    default:
      throw new ErroParseNfe("RAIZ_DESCONHECIDA", `raiz "${raiz}" não é NF-e (esperado enviNFe, nfeProc, NFe ou infNFe)`);
  }
}

function validarEntrada(xml: unknown): asserts xml is string {
  if (typeof xml !== "string" || xml.trim() === "") {
    throw new ErroParseNfe("XML_VAZIO", "XML vazio");
  }
  if (Buffer.byteLength(xml, "utf8") > LIMITE_BYTES_XML) {
    throw new ErroParseNfe("XML_MUITO_GRANDE", `XML acima do limite de ${LIMITE_BYTES_XML} bytes`);
  }
  // Sem DTD: impede entidades externas e expansão de entidades internas.
  if (/<!DOCTYPE/i.test(xml)) {
    throw new ErroParseNfe("DTD_NAO_PERMITIDO", "DOCTYPE não é permitido em NF-e");
  }
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  maxNestedTags: 100,
  // Só det e NFe são repetíveis no layout; demais elementos são singulares.
  isArray: (nome: string) => nome === "det" || nome === "NFe",
});

/**
 * Faz o parse de uma NF-e/NFC-e. Lança ErroParseNfe em caso de entrada inválida.
 * Não valida contra o XSD: para isso use o adapter XsdXmlValidator.
 */
export function parseNfe(xml: string): NfeDocumento {
  validarEntrada(xml);

  const bem = XMLValidator.validate(xml);
  if (bem !== true) {
    throw new ErroParseNfe("XML_MALFORMADO", `XML malformado: ${bem.err.msg} (linha ${bem.err.line})`);
  }

  const arvore = PARSER.parse(xml) as No;
  const { origemRaiz, inf } = localizarInfNFe(arvore);

  let chave: string | undefined;
  const id = campo(inf, "@_Id");
  if (id !== undefined) {
    const m = /^NFe(\d{44})$/.exec(id);
    if (!m) {
      throw new ErroParseNfe("ID_INVALIDO", `infNFe/@Id inválido: esperado "NFe" + 44 dígitos`);
    }
    chave = m[1];
  }

  const ide = filho(inf, "ide");
  const total = filho(inf, "total");
  const dets = inf.det;

  return {
    origemRaiz,
    chave,
    dhEmi: campo(ide, "dhEmi"),
    ide: {
      natOp: campo(ide, "natOp"),
      mod: campo(ide, "mod"),
      serie: campo(ide, "serie"),
      nNF: campo(ide, "nNF"),
      tpAmb: campo(ide, "tpAmb"),
      gCompraGov: projetar(ide.gCompraGov, SPEC_COMPRA_GOV),
    },
    emitente: lerEmitente(inf.emit),
    destinatario: lerDestinatario(inf.dest),
    itens: Array.isArray(dets) ? dets.map(lerItem) : [],
    total: {
      ISTot: projetar(total.ISTot, SPEC_ISTOT),
      IBSCBSTot: projetar(total.IBSCBSTot, SPEC_TOT_IBSCBS),
    },
  };
}
