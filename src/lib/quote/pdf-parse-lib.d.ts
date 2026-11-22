// pdf-parse/lib/pdf-parse.js evita o código de debug do index.js (que lê um arquivo de teste do disco).
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdf from "pdf-parse";
  export default pdf;
}
