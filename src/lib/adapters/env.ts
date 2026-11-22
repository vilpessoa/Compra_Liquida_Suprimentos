/**
 * Leitura de escolha de adapter por variável de ambiente. Fica em arquivo próprio (e não em registry.ts) para
 * que os `index.ts` dos adapters não importem o registry, que por sua vez importa os `create*()` deles.
 */
export function envChoice<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = process.env[name];
  if (!v) return fallback;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  throw new Error(`Valor inválido para ${name}: "${v}". Permitidos: ${allowed.join(", ")}`);
}
