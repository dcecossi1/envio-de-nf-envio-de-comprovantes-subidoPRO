/**
 * Autoriza uma conta Google a enviar os e-mails (uma vez só).
 *
 *   npm run autorizar
 *
 * Abre o consentimento do Google no navegador, recebe o retorno num servidor
 * local e grava o refresh token em `.google-token.json` (fora do Git).
 * Depois disso o envio funciona sozinho, sem abrir navegador de novo.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { ARQUIVO_TOKEN, lerConfig } from "../src/config.js";
import { ESCOPO_ENVIO, ESCOPO_PLANILHA } from "../src/google.js";

const PORTA = 5599;
const REDIRECT = `http://localhost:${PORTA}`;

function base64url(b: Buffer): string {
  return b.toString("base64url");
}

function abrirNoNavegador(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    // Sem navegador (servidor, WSL): o link impresso no terminal resolve.
  }
}

function pagina(titulo: string, texto: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${titulo}</title>
<body style="font:16px system-ui;margin:15vh auto;max-width:32rem;text-align:center">
<h1 style="font-size:1.3rem">${titulo}</h1><p>${texto}</p></body>`;
}

async function main() {
  const config = lerConfig();
  const escopos = [ESCOPO_ENVIO];
  if (config.planilhaId) escopos.push(ESCOPO_PLANILHA);

  // PKCE: protege o código de autorização caso ele vaze na volta do navegador.
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: escopos.join(" "),
      access_type: "offline",
      prompt: "consent", // força o Google a devolver o refresh token
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });

  const codigo = await new Promise<string>((ok, falhou) => {
    const servidor = createServer((req, res) => {
      const recebido = new URL(req.url ?? "/", REDIRECT);
      const code = recebido.searchParams.get("code");
      const erro = recebido.searchParams.get("error");
      const responder = (html: string) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      };
      if (erro || recebido.searchParams.get("state") !== state) {
        responder(pagina("Não deu certo", "Volte ao terminal e rode de novo."));
        servidor.close();
        falhou(new Error(erro ?? "state diferente do enviado"));
        return;
      }
      if (!code) return responder(pagina("Aguardando…", "Pode fechar esta aba."));
      responder(pagina("Pronto", "Conta autorizada. Pode fechar esta aba e voltar ao terminal."));
      servidor.close();
      ok(code);
    });
    servidor.listen(PORTA, () => {
      console.log(`\nAbrindo o consentimento do Google no navegador.`);
      console.log(`Se não abrir sozinho, cole este endereço:\n\n${url}\n`);
      abrirNoNavegador(url);
    });
    servidor.on("error", falhou);
  });

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code: codigo,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  if (!resp.ok) throw new Error(`Google: ${await resp.text()}`);
  const token = (await resp.json()) as { refresh_token?: string; access_token: string; scope: string };
  if (!token.refresh_token) {
    throw new Error("o Google não devolveu refresh token — remova o acesso do app em myaccount.google.com/permissions e rode de novo");
  }

  const perfil = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const conta = perfil.ok ? (((await perfil.json()) as { email?: string }).email ?? "?") : "?";

  writeFileSync(
    ARQUIVO_TOKEN,
    `${JSON.stringify(
      { refresh_token: token.refresh_token, escopos: token.scope.split(" "), conta, criado_em: new Date().toISOString() },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log(`Conta ${conta} autorizada. Token salvo em .google-token.json (fora do Git).`);
}

main().catch((e) => {
  console.error(`\nErro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
