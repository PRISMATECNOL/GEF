# v20 – Cadastro e login SEM email, SEM código, pronto para muitos cadastros em simultâneo

## 1. Ordem de instalação
1. **SQL** (Supabase → SQL Editor): `migracao_cadastro_sem_email_v20.sql` (depois da v19; idempotente, pode repetir).
2. **Authentication → Providers → Email**: «Confirm email» **desligado** (já pedido na v19). Não é preciso SMTP.
3. **Edge Function** (limites novos + pedido repetido tolerado): `supabase functions deploy customer-auth --no-verify-jwt`
4. Publicar o front-end (`sw.js` passou a `gef-v20`).
5. `LOGIN_DOMAIN` em `js/config.js`, `fn_login_domain()` no SQL e o segredo `CUSTOMER_LOGIN_DOMAIN` têm de ser **iguais** (por omissão `cliente.invalid`). Se o Supabase recusar este domínio, mude os três para um domínio seu — nunca é enviado email para ele.

## 2. O que mudou
| Quem | Antes | Agora |
|---|---|---|
| Cliente da loja | já sem email (v19) | igual; formulário abre vazio e sem preenchimento automático |
| Lojista (link do embaixador) | email + código de confirmação | **nome da loja, nome, contacto, endereço, palavra-passe**. Email, cidade, NUIT são opcionais |
| Login do sistema (admin, gerente, caixa, embaixador…) | email | **telemóvel** + palavra-passe (contas antigas continuam a entrar com o email) |
| Super-admin / embaixador a criar utilizadores | email | telemóvel (ou email) |

- O email, quando indicado, fica em `profiles.contact_email` / `stores.email` e só serve para promoções (`email_optin` guarda a autorização).
- Internamente o telemóvel vira `s<9 últimos dígitos>@cliente.invalid` (clientes: `p…`, para nunca colidirem com utilizadores do sistema).
- Formulários de login e de adesão: sem valores, sem exemplos, `autocomplete` desligado e limpeza ao voltar atrás no navegador.

## 3. Carga alta (testado)
- Limitador só com `INSERT` (sem contadores partilhados): pedidos não esperam uns pelos outros. Só pedidos do **mesmo telemóvel** se serializam.
- Pedido repetido (duplo clique, rede lenta) com o mesmo telemóvel+palavra-passe devolve a mesma conta — nunca cria duplicados nem dá erro.
- Limites (ajustáveis): adesão da loja 300/hora por IP e 20/dia por telemóvel (`fn_public_store_signup`); clientes 600 contas/hora por IP, 10/dia por telemóvel, 8 falhas de login/15 min por telemóvel, 500 por IP (`customer-auth/index.ts`). Valores largos de propósito: muitas pessoas partilham o IP da operadora móvel.
- Teste feito em PostgreSQL com cadastros em paralelo: 500 cadastros com 100 em simultâneo → 500 sucessos; 150 pedidos misturados (50 telemóveis × 3) → exactamente 50 contas, 0 erros, 0 bloqueios pendentes.
- **Fora do alcance do código:** o plano do Supabase (CPU, ligações, limites do Auth/Edge Functions) é o tecto real. Para picos grandes, escolha um plano com margem e ligue o Cloudflare/Turnstile à frente se houver ataque automatizado.

## 4. Notas
- Sem email não há «esqueci a palavra-passe»: o Super Administrador repõe a palavra-passe (Lojas → utilizadores).
- O formulário de compra como convidado (carrinho) continua a lembrar os dados do cliente com sessão; só os formulários de conta e adesão abrem sempre vazios.
- Gerenciadores que listavam emails mostram agora o telemóvel (`displayLogin`).
