import { CODIGOS_VSN, type CodigoValidacaoSimples } from "./codigos";
import type { ErroDetalhe, EstadoItemSimples } from "./official-types";

/** Port de `ItemCollectorSimples`: acumula erros RFC 7807 do item e decide o estado. */
export class ItemCollector {
  readonly erros: ErroDetalhe[] = [];
  estado: EstadoItemSimples = "CALCULADO";

  constructor(
    readonly index: number,
    private readonly baseURL: string,
  ) {}

  private tipo(codigo: string): string {
    return `${this.baseURL}/calculadora/observabilidade/simples-nacional/erros?codigo=${codigo}`;
  }

  /** Erro de validação de entrada: promove `CALCULADO` a `INCONSISTENCIA_ENTRADA`. */
  addErroValidacao(codigo: CodigoValidacaoSimples, campo: string | null, detail: string): void {
    if (this.estado === "CALCULADO") this.estado = "INCONSISTENCIA_ENTRADA";
    const pointer = campo == null ? `#/itens/${this.index}` : `#/itens/${this.index}/${campo}`;
    this.erros.push({ type: this.tipo(codigo.code), title: codigo.titulo, code: codigo.code, pointer, detail });
  }

  /** Erro cujo campo fica fora do item (ex.: `#/aliquotasEfetivas/anexoIII/pCBSSN`). */
  addErroValidacaoNoPonteiro(codigo: CodigoValidacaoSimples, ponteiro: string, detail: string): void {
    if (this.estado === "CALCULADO") this.estado = "INCONSISTENCIA_ENTRADA";
    this.erros.push({ type: this.tipo(codigo.code), title: codigo.titulo, code: codigo.code, pointer: ponteiro, detail });
  }

  /** VSN-027: estado atribuído INCONDICIONALMENTE (prevalece sobre inconsistências já acumuladas). */
  addNaoImplementado(codigo: CodigoValidacaoSimples, campo: string | null, detail: string): void {
    this.estado = "NAO_IMPLEMENTADO";
    const pointer = campo == null ? `#/itens/${this.index}` : `#/itens/${this.index}/${campo}`;
    this.erros.push({ type: this.tipo(codigo.code), title: codigo.titulo, code: codigo.code, pointer, detail });
  }

  addFalhaTecnica(mensagem: string): void {
    this.estado = "FALHA_TECNICA";
    const c = CODIGOS_VSN.FALHA_TECNICA;
    this.erros.push({ type: this.tipo(c.code), title: c.titulo, code: c.code, pointer: `#/itens/${this.index}`, detail: mensagem });
  }

  hasErros(): boolean {
    return this.erros.length > 0;
  }
}
