import type { QuoteExtractorPort } from "@/lib/ports/quote-extractor";
import { HeuristicQuoteExtractor } from "./heuristic-extractor";
import { AnthropicQuoteExtractor, MODELO_PADRAO, OpenAICompatibleQuoteExtractor } from "./llm-extractors";

export * from "./file-extractors";
export { HeuristicQuoteExtractor } from "./heuristic-extractor";
export { AnthropicQuoteExtractor, OpenAICompatibleQuoteExtractor, AVISO_IA_INDISPONIVEL } from "./llm-extractors";
export { posValidarProposta } from "./validation";

export interface QuoteExtractorSelection {
  extractor: QuoteExtractorPort;
  /** Para a UI: "IA" ou "Heurística local". */
  tipo: "ia" | "heuristica";
  rotulo: "IA" | "Heurística local";
  /** id do adapter configurado: "anthropic" | "openai-compatible" | "heuristic". */
  id: string;
  /** Preenchido quando a config pedia IA mas estava incompleta (a rota repassa como aviso). */
  avisoConfig?: string;
}

type Env = Record<string, string | undefined>;

const heuristica = (avisoConfig?: string): QuoteExtractorSelection => ({
  extractor: new HeuristicQuoteExtractor(),
  tipo: "heuristica",
  rotulo: "Heurística local",
  id: "heuristic",
  avisoConfig,
});

/**
 * LLM_PROVIDER: "anthropic" | "openai-compatible" | "none".
 * Padrão: "anthropic" se LLM_API_KEY existir, senão "none" (heurística local, sem rede).
 */
export function createQuoteExtractor(env: Env = process.env): QuoteExtractorSelection {
  const apiKey = env.LLM_API_KEY?.trim();
  const informado = env.LLM_PROVIDER?.trim().toLowerCase();
  const provider = informado || (apiKey ? "anthropic" : "none");
  if (provider === "none") return heuristica();
  if (!apiKey) return heuristica("IA não configurada (LLM_API_KEY ausente) — extração heurística");
  const model = env.LLM_MODEL?.trim() || undefined;
  const baseUrl = env.LLM_BASE_URL?.trim() || undefined;
  try {
    if (provider === "anthropic") {
      return {
        extractor: new AnthropicQuoteExtractor({ apiKey, model: model ?? MODELO_PADRAO, baseURL: baseUrl }),
        tipo: "ia", rotulo: "IA", id: "anthropic",
      };
    }
    if (provider === "openai-compatible") {
      if (!baseUrl || !model) return heuristica("IA não configurada (LLM_BASE_URL e LLM_MODEL são obrigatórios) — extração heurística");
      return {
        extractor: new OpenAICompatibleQuoteExtractor({ apiKey, baseUrl, model }),
        tipo: "ia", rotulo: "IA", id: "openai-compatible",
      };
    }
  } catch {
    return heuristica("IA não configurada (configuração inválida) — extração heurística");
  }
  return heuristica(`LLM_PROVIDER "${provider}" desconhecido — extração heurística`);
}
