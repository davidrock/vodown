# Contrato de cobrança Vodown

Todos os endpoints de conta exigem Bearer JWT Supabase validado. O ambiente atual aceita somente Stripe **test**. Retorno do Checkout nunca concede PRO por si só.

| Método / caminho | Entrada | Resultado |
|---|---|---|
| GET `/v1/billing/plans` | Público | `available`, `testMode`, `prices` com `interval`, `currency`, `amountMinor` |
| POST `/v1/billing/checkout` | `{ "plan": "monthly" \| "annual" \| "lifetime" }`, `Idempotency-Key: UUID` | `id`, URL HTTPS Stripe, `expiresAt` |
| POST `/v1/billing/portal` | `Idempotency-Key: UUID` | URL de gestão da conta autenticada |
| POST `/v1/billing/reconcile` | Sem corpo | Consulta Stripe e retorna as permissões atuais |
| POST `/v1/billing/webhook` | Corpo bruto Stripe, `Stripe-Signature` | `{received:true,processed:boolean}` |

Erros usam ProblemDetails: 400 entrada/assinatura inválida; 401 sem sessão válida; 403 membro não autorizado; 409 conta já possui PRO ou não tem cadastro de cobrança; 503 dependência indisponível/configuração incompleta. Em falha temporária, refaça um checkout com a mesma Idempotency-Key. Não envie customerId, userId, preço ou URL de retorno: o servidor determina esses valores.

Catálogo acordado: EUR 5 mensal, EUR 25 anual e EUR 100 compra única para os recursos PRO. Compra única é licença do Vodown e não modifica direitos sobre os cursos. Reembolso ou contestação revoga a licença; o estado é reconciliado novamente quando Stripe informar mudança.

Uma transação PostgreSQL com advisory lock por usuário serializa checkout e webhook entre instâncias da API. Sessões abertas são reutilizadas; ao trocar de plano, a sessão anterior é expirada. O identificador de cada evento é único e salvo atomicamente com o estado reconciliado. Eventos atrasados consultam o Stripe atual, sem reaplicar snapshots antigos.

Os únicos dados enviados a Stripe automaticamente para criar o cliente são um UUID interno em metadata. O cliente fornece seus próprios dados de cobrança no Checkout hospedado.

Fontes do adaptador: SDK oficial Stripe.net, documentação de Checkout Sessions, Billing Portal, Subscription Items e Payment Intents. Brief público Orbit confirmou o endpoint de portal. A simulação local usa um subconjunto desses contratos; não implica homologação de todos os comportamentos Stripe.
