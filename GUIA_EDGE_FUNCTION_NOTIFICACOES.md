# Guia: pôr a função `send-push` a funcionar (para quem nunca fez)

**O que ela faz:** quando nasce uma notificação (campanha, pagamento validado, encomenda pronta), o Supabase chama esta função, e ela envia a notificação ao telemóvel do cliente **mesmo com a app fechada**. Se não a instalar, tudo continua a funcionar com a app aberta.

Precisa de: acesso ao painel do Supabase, o site em **HTTPS**, e um computador com **Node.js** (só para o passo 1).

## Passo 1 — Gerar as chaves VAPID (a «identidade» do seu sistema de push)
1. Instale o Node.js (versão LTS) em nodejs.org.
2. Abra o terminal (Windows: «Prompt de comandos»; Mac: «Terminal») e escreva:
   `npx web-push generate-vapid-keys`
3. Aparecem duas linhas: **Public Key** e **Private Key**. Copie-as para um bloco de notas.
   - A **pública** vai para o site (passo 3). A **privada é segredo**: nunca a ponha no site nem a envie a ninguém.

## Passo 2 — SQL
No Supabase → **SQL Editor** → cole e execute `migracao_push_v23.sql` (depois da v22). Aparece «Success».

## Passo 3 — Chave pública no site
Abra `js/config.js`, ponha a **Public Key** em `VAPID_PUBLIC_KEY = '...'` e publique o site outra vez.

## Passo 4 — Criar a função (sem instalar nada)
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nome: `send-push` (exactamente assim).
3. Apague o código de exemplo, cole **todo** o conteúdo de `supabase/functions/send-push/index.ts` e clique **Deploy**.
4. Abra a função → **Details/Settings** → desligue **«Verify JWT»** (Enforce JWT verification) e guarde. (A segurança é o segredo do passo 5.)
5. Copie o endereço da função: `https://SEU-PROJETO.supabase.co/functions/v1/send-push` (o «SEU-PROJETO» está em Project Settings → General → Reference ID).

## Passo 5 — Segredos
Supabase → **Edge Functions → Secrets** (ou Project Settings → Edge Functions) → **Add new secret**. Crie 4:
| Nome | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | a Public Key do passo 1 |
| `VAPID_PRIVATE_KEY` | a Private Key do passo 1 |
| `VAPID_SUBJECT` | `mailto:o-seu-email@exemplo.com` |
| `PUSH_SECRET` | uma palavra longa inventada por si (ex.: 30 letras e números aleatórios). **Guarde-a**, vai precisar dela no passo 6 |

(`SUPABASE_URL` e a chave de serviço já existem sozinhas.)

## Passo 6 — Ligar o «gatilho» (Database Webhook)
Supabase → **Database → Webhooks → Create a new hook**:
- Name: `push-notificacoes`
- Table: `customer_notifications` · Events: só **Insert**
- Type: **HTTP Request** · Method: **POST** · URL: o endereço do passo 4.5
- **HTTP Headers:** adicione `x-push-secret` com o valor do `PUSH_SECRET`. (Pode apagar o cabeçalho `Authorization` se aparecer.)
- Guarde.

## Passo 7 — Testar
1. No telemóvel, abra a loja, **instale a app**, entre na conta e ative em **Perfil → Notificações** («Ativar neste aparelho» → Permitir).
2. **Feche a app por completo.**
3. No painel (Loja virtual → Campanhas) crie uma campanha de notificação para si e envie. Em segundos aparece a notificação.

## Se não funcionar
- **Ver o que a função diz:** Edge Functions → `send-push` → **Logs**.
- Resposta **401** → o valor do cabeçalho `x-push-secret` é diferente do segredo `PUSH_SECRET`.
- `processed: 1, sent: 0` → o cliente não tem aparelho registado: na tabela `push_subscriptions` tem de haver uma linha com `active = true`. Ative as notificações no aparelho (passo 7.1), com a chave pública já publicada (passo 3).
- Nada nos Logs → o Webhook não disparou: veja Database → Webhooks → o hook → histórico.
- **iPhone:** só funciona com a app **instalada** (Partilhar → Adicionar ao ecrã principal) e iOS 16.4 ou superior.
- Para reenviar pendentes (últimas 24 h): faça POST com o cabeçalho `x-push-secret` e corpo `{}` ao endereço da função.
- O cliente que desativa as notificações deixa de receber: a função confirma a autorização antes de cada envio.
