export interface XmlValidationResult { valido: boolean; erros: string[]; schema: string }
/** Validação de XML contra os XSDs oficiais. */
export interface XmlValidatorPort {
  readonly id: string;
  validar(xml: string, tipo: "nfe" | "nfse"): Promise<XmlValidationResult>;
}
