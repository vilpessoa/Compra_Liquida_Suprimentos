import { NextResponse } from "next/server";
import type { PropostaExtraida } from "@/lib/ports/quote-extractor";
import { AVISO_IA_INDISPONIVEL, ArquivoInvalidoError, TAMANHO_MAXIMO_BYTES, createQuoteExtractor, extrairTextoDeArquivo } from "@/lib/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TEXTO_CHARS = 500_000;
const MAX_TEXTO_RESPOSTA = 20_000;
const HEADERS = { "Cache-Control": "no-store" };

const erro = (status: number, mensagem: string) => NextResponse.json({ erro: mensagem }, { status, headers: HEADERS });

/**
 * POST multipart (campo `file`) ou JSON `{ texto }`.
 * Zero retenção: nada é gravado em disco nem logado (nem conteúdo, nem nome de arquivo).
 */
export async function POST(req: Request) {
  try {
    const tipo = (req.headers.get("content-type") ?? "").toLowerCase();
    const declarado = Number(req.headers.get("content-length") ?? 0);
    let texto: string;

    if (tipo.includes("multipart/form-data")) {
      if (declarado > TAMANHO_MAXIMO_BYTES + 512 * 1024) return erro(413, "Arquivo excede o limite de 5 MB.");
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return erro(400, "Corpo multipart inválido.");
      }
      const arq = form.get("file");
      if (!(arq instanceof File)) return erro(400, 'Envie o arquivo no campo "file".');
      if (arq.size > TAMANHO_MAXIMO_BYTES) return erro(413, "Arquivo excede o limite de 5 MB.");
      const bytes = new Uint8Array(await arq.arrayBuffer());
      ({ texto } = await extrairTextoDeArquivo({ nome: arq.name, mime: arq.type, bytes }));
    } else if (tipo.includes("application/json")) {
      if (declarado > MAX_TEXTO_CHARS * 4) return erro(413, "Texto grande demais.");
      let corpo: unknown;
      try {
        corpo = await req.json();
      } catch {
        return erro(400, "JSON inválido.");
      }
      const t = (corpo as { texto?: unknown } | null)?.texto;
      if (typeof t !== "string" || !t.trim()) return erro(400, 'Envie { "texto": "..." } com o texto da proposta.');
      if (t.length > MAX_TEXTO_CHARS) return erro(413, `Texto excede o limite de ${MAX_TEXTO_CHARS} caracteres.`);
      texto = t;
    } else {
      return erro(415, 'Use multipart/form-data (campo "file") ou application/json ({ "texto": "..." }).');
    }

    const sel = createQuoteExtractor();
    const proposta: PropostaExtraida = await sel.extractor.extrair(texto);
    if (sel.avisoConfig) proposta.avisos.unshift(sel.avisoConfig);
    const caiuParaHeuristica = proposta.avisos.includes(AVISO_IA_INDISPONIVEL);
    const adapter =
      sel.tipo === "ia" && !caiuParaHeuristica
        ? { id: sel.id, tipo: "ia" as const, rotulo: "IA" as const }
        : { id: "heuristic", tipo: "heuristica" as const, rotulo: "Heurística local" as const };

    return NextResponse.json(
      {
        adapter,
        proposta,
        textoExtraido: texto.length > MAX_TEXTO_RESPOSTA ? `${texto.slice(0, MAX_TEXTO_RESPOSTA)}\n[… truncado para conferência]` : texto,
      },
      { headers: HEADERS },
    );
  } catch (e) {
    if (e instanceof ArquivoInvalidoError) return erro(e.status, e.message);
    // Apenas o tipo do erro: mensagens podem conter trechos do documento.
    console.error("parse-quote: falha inesperada:", e instanceof Error ? e.name : "desconhecido");
    return erro(500, "Falha interna ao processar a proposta.");
  }
}
