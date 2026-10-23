using Vodown.Shared.Domain;
namespace Vodown.Service.Billing;
public sealed class BillingService(IBillingRepository repository,IBillingGateway gateway,TimeProvider clock)
{
    private static readonly HashSet<string> HandledEvents = ["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted","customer.subscription.paused","customer.subscription.resumed","invoice.paid","invoice.payment_failed","checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed","charge.refunded","charge.dispute.created","charge.dispute.closed","charge.dispute.funds_withdrawn","charge.dispute.funds_reinstated","payment_intent.succeeded"];
    public async Task<CheckoutLink> CheckoutAsync(UserId userId,BillingPlan interval,Guid requestId,CancellationToken cancellationToken)
    {
        AssertionConcern.Require(Enum.IsDefined(interval),"Periodicidade inválida.");
        AssertionConcern.Require(requestId!=Guid.Empty,"Idempotency-Key deve ser um UUID válido.");
        var result=await repository.WithUserLockAsync<CheckoutLink?>(userId,async ct=>
        {
            var customer=await repository.FindCustomerAsync(userId,ct);
            if(customer is null) { customer=new(userId,await gateway.CreateCustomerAsync(userId,ct)); repository.AddCustomer(customer); }
            var current=await gateway.GetStateAsync(customer,ct);
            await repository.SaveStateAsync(userId,current,clock.GetUtcNow(),ct);
            if(current.HasLifetime || current.Subscription?.BlocksNewCheckout==true)return null;
            if(customer.CheckoutId is not null)
            {
                var open=await gateway.GetOpenCheckoutAsync(customer.CheckoutId,ct);
                if(open is not null && open.ExpiresAt>clock.GetUtcNow())
                {
                    if(customer.CheckoutInterval==interval)return open;
                    await gateway.ExpireCheckoutAsync(open.Id,ct);
                }
            }
            var checkout=await gateway.CreateCheckoutAsync(customer,interval,requestId,ct);
            customer.RememberCheckout(checkout,interval);
            return checkout;
        },cancellationToken);
        return result ?? throw new BillingConflictException("Você já possui PRO. Use Gerenciar assinatura para consultar sua cobrança.");
    }
    public async Task<string> PortalAsync(UserId userId,Guid requestId,CancellationToken cancellationToken)
    {
        AssertionConcern.Require(requestId!=Guid.Empty,"Idempotency-Key deve ser um UUID válido.");
        var customer=await repository.FindCustomerAsync(userId,cancellationToken)
            ?? throw new BillingConflictException("Sua conta ainda não possui cadastro de cobrança.");
        return await gateway.CreatePortalAsync(customer,requestId,cancellationToken);
    }
    public Task<bool> ReconcileAsync(UserId userId,CancellationToken cancellationToken) => repository.WithUserLockAsync(userId,async ct=>
    {
        var customer=await repository.FindCustomerAsync(userId,ct);
        if(customer is null)return false;
        var snapshot=await gateway.GetStateAsync(customer,ct);
        await repository.SaveStateAsync(userId,snapshot,clock.GetUtcNow(),ct);
        return true;
    },cancellationToken);

    public async Task<bool> HandleEventAsync(string payload,string signature,CancellationToken cancellationToken)
    {
        var billingEvent=gateway.VerifyEvent(payload,signature);
        if(billingEvent.LiveMode)throw new InvalidBillingEventException();
        if(!HandledEvents.Contains(billingEvent.Type))return false;
        var customerId=await gateway.ResolveCustomerAsync(billingEvent,cancellationToken);
        if(customerId is null)return false;
        var customer=await repository.FindByStripeCustomerAsync(customerId,cancellationToken);
        if(customer is null)return false;
        return await repository.WithUserLockAsync(customer.UserId,async ct=>
        {
            if(await repository.WasProcessedAsync(billingEvent.Id,ct))return false;
            var snapshot=await gateway.GetStateAsync(customer,ct);
            await repository.SaveStateAsync(customer.UserId,snapshot,clock.GetUtcNow(),ct);
            repository.RecordEvent(new(billingEvent.Id,clock.GetUtcNow()));
            return true;
        },cancellationToken);
    }
}
