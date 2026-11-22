/**
 * Registro central de adapters. A troca de qualquer integração (ex.: motor local -> motor
 * oficial RFB hospedado internamente) é feita SOMENTE por variáveis de ambiente.
 * Ver docs/API_MAP.md. Cada WP registra seu adapter aqui.
 */
export function envChoice<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = process.env[name];
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`Valor inválido para ${name}: "${v}". Permitidos: ${allowed.join(", ")}`);
}
