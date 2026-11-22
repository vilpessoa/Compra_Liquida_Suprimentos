import { describe, expect, it } from "vitest";
import { POST } from "./route";

// Fixtures de teste; sem LLM_API_KEY o adapter é a heurística local.
const TEXTO = "Fornecedor: Acme Teste Ltda\nCNPJ: 11.222.333/0001-81";

describe("POST /api/parse-quote", () => {
  it("JSON {texto}", async () => {
    const res = await POST(new Request("http://x/api/parse-quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texto: TEXTO }) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.adapter.rotulo).toBe("Heurística local");
    expect(j.proposta.cnpj.valor).toBe("11.222.333/0001-81");
    expect(j.textoExtraido).toBe(TEXTO);
  });
  it("multipart com CSV", async () => {
    const fd = new FormData();
    fd.append("file", new File(["Descrição;Qtd;Valor Unitário\nFita;10;2,50\n"], "p.csv", { type: "text/csv" }));
    const res = await POST(new Request("http://x/api/parse-quote", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    expect((await res.json()).proposta.itens[0].valorUnitario.valor).toBe("2.5");
  });
  it("erros 400/413/415", async () => {
    const post = (init: RequestInit) => POST(new Request("http://x/api/parse-quote", { method: "POST", ...init }));
    expect((await post({ headers: { "content-type": "text/plain" }, body: "x" })).status).toBe(415);
    expect((await post({ headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    const fd = new FormData();
    fd.append("file", new File(["x"], "a.exe"));
    expect((await post({ body: fd })).status).toBe(415);
    const grande = new FormData();
    grande.append("file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.pdf"));
    expect((await post({ body: grande })).status).toBe(413);
  });
});
