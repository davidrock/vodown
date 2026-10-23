using System.Text.Json;
using Stripe;
using Vodown.Service.Billing;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
namespace Vodown.Repository.Billing;

public sealed class StripeGateway(StripeSettings settings,Lazy<IStripeClient> stripeClient) : IBillingGateway
{
    private IStripeClient client => stripeClient.Value;
    public bool IsConfigured => settings.SecretKey.StartsWith("sk_test_",StringComparison.Ordinal)
        && !string.IsNullOrWhiteSpace(settings.MonthlyPriceId) && !string.IsNullOrWhiteSpace(settings.AnnualPriceId) && !string.IsNullOrWhiteSpace(settings.LifetimePriceId);
    private void EnsureConfigured()
    { if(!IsConfigured)throw new BillingUnavailableException("Cobrança de testes ainda não configurada."); }
    private string PriceId(BillingPlan plan) => plan switch { BillingPlan.Monthly=>settings.MonthlyPriceId,BillingPlan.Annual=>settings.AnnualPriceId,BillingPlan.Lifetime=>settings.LifetimePriceId,_=>throw new DomainException("Plano inválido.") };
    public async Task<IReadOnlyList<PlanPrice>> GetPricesAsync(CancellationToken ct)
    {
        EnsureConfigured();
        var prices=new List<PlanPrice>();
        foreach(var plan in Enum.GetValues<BillingPlan>())
        {
            var price=await new PriceService(client).GetAsync(PriceId(plan),cancellationToken:ct);
            var expected=plan==BillingPlan.Monthly?"month":"year";
            var expectedAmount=plan switch {BillingPlan.Monthly=>500L,BillingPlan.Annual=>2500L,_=>10000L};
            if(price.Livemode || !price.Active || price.Currency!="eur" || price.UnitAmount!=expectedAmount
                || (plan==BillingPlan.Lifetime ? price.Type!="one_time" : price.Recurring?.Interval!=expected || price.Recurring.IntervalCount!=1))
                throw new BillingUnavailableException("O catálogo de preços Stripe não corresponde aos planos configurados.");
            prices.Add(new(plan.ToString().ToLowerInvariant(),price.Currency,price.UnitAmount.Value));
        }
        return prices;
    }
    public async Task<string> CreateCustomerAsync(UserId userId,CancellationToken ct)
    {
        EnsureConfigured();
        return (await new CustomerService(client).CreateAsync(new(){Metadata=new(){{"vodown_user_id",userId.Value.ToString()}}},
            new(){IdempotencyKey=$"vodown/customer/{userId.Value}"},ct)).Id;
    }
    public async Task<BillingState> GetStateAsync(BillingCustomer customer,CancellationToken ct)
    {
        EnsureConfigured();
        BillingSnapshot? selected=null;
        await foreach(var subscription in new SubscriptionService(client).ListAutoPagingAsync(new(){Customer=customer.StripeCustomerId,Status="all",Limit=100},cancellationToken:ct))
        {
            if(subscription.Livemode || !Owns(subscription.Metadata,customer.UserId))continue;
            var items=subscription.Items.Data;
            if(items.Count!=1 || items[0].Quantity!=1 || !new[]{settings.MonthlyPriceId,settings.AnnualPriceId}.Contains(items[0].Price.Id))continue;
            var status=subscription.Status switch {"active"=>SubscriptionStatus.Active,"trialing"=>SubscriptionStatus.Trialing,"past_due"=>SubscriptionStatus.PastDue,"unpaid"=>SubscriptionStatus.Unpaid,"canceled"=>SubscriptionStatus.Canceled,_=>SubscriptionStatus.Inactive};
            var current=new BillingSnapshot(subscription.Id,customer.StripeCustomerId,status,new DateTimeOffset(DateTime.SpecifyKind(items[0].CurrentPeriodEnd,DateTimeKind.Utc)),subscription.CancelAtPeriodEnd,
                subscription.Status is "active" or "trialing" or "past_due" or "unpaid" or "incomplete" or "paused");
            if(selected is null || (current.BlocksNewCheckout && !selected.BlocksNewCheckout) || (current.BlocksNewCheckout==selected.BlocksNewCheckout && current.PaidThrough>selected.PaidThrough))selected=current;
        }
        var purchases=new List<LifetimePurchaseSnapshot>();
        await foreach(var session in new Stripe.Checkout.SessionService(client).ListAutoPagingAsync(new(){Customer=customer.StripeCustomerId,Status="complete",Limit=100},cancellationToken:ct))
        {
            if(session.Livemode || session.Mode!="payment" || !Owns(session.Metadata,customer.UserId) || string.IsNullOrWhiteSpace(session.PaymentIntentId))continue;
            var lines=await new Stripe.Checkout.SessionLineItemService(client).ListAsync(session.Id,new(){Limit=2},cancellationToken:ct);
            if(lines.HasMore || lines.Data.Count!=1 || lines.Data[0].Price?.Id!=settings.LifetimePriceId || lines.Data[0].Quantity!=1)continue;
            var payment=await new PaymentIntentService(client).GetAsync(session.PaymentIntentId,new(){Expand=["latest_charge"]},cancellationToken:ct);
            var charge=payment.LatestCharge;
            var disputeCleared=charge is not null && !charge.Disputed;
            if(charge?.Disputed==true)
            {
                var disputes=await new DisputeService(client).ListAsync(new(){PaymentIntent=payment.Id,Limit=100},cancellationToken:ct);
                disputeCleared=!disputes.HasMore && disputes.Data.Count>0 && disputes.Data.All(x=>x.Status is "won" or "warning_closed");
            }
            var valid=session.PaymentStatus=="paid" && payment.Status=="succeeded" && payment.CustomerId==customer.StripeCustomerId
                && charge is not null && charge.Paid && charge.AmountRefunded==0 && disputeCleared;
            purchases.Add(new(session.Id,payment.Id,valid));
        }
        return new(selected,purchases);
    }
    public async Task<CheckoutLink?> GetOpenCheckoutAsync(string checkoutId,CancellationToken ct)
    {
        var session=await new Stripe.Checkout.SessionService(client).GetAsync(checkoutId,cancellationToken:ct);
        return session.Status=="open" ? Link(session):null;
    }
    public async Task ExpireCheckoutAsync(string checkoutId,CancellationToken ct)
    { await new Stripe.Checkout.SessionService(client).ExpireAsync(checkoutId,cancellationToken:ct); }
    public async Task<CheckoutLink> CreateCheckoutAsync(BillingCustomer customer,BillingPlan plan,Guid requestId,CancellationToken ct)
    {
        EnsureConfigured();
        await GetPricesAsync(ct);
        var metadata=new Dictionary<string,string>{{"vodown_user_id",customer.UserId.Value.ToString()},{"vodown_plan",plan.ToString().ToLowerInvariant()}};
        var session=await new Stripe.Checkout.SessionService(client).CreateAsync(new()
        {
            Customer=customer.StripeCustomerId, Mode=plan==BillingPlan.Lifetime?"payment":"subscription",
            LineItems=[new(){Price=PriceId(plan),Quantity=1}], ClientReferenceId=customer.UserId.Value.ToString(), Metadata=metadata,
            SubscriptionData=plan==BillingPlan.Lifetime?null:new(){Metadata=metadata},
            PaymentIntentData=plan==BillingPlan.Lifetime?new(){Metadata=metadata}:null,
            SuccessUrl=$"{settings.WebBaseUrl.TrimEnd('/')}/conta?checkout=success",CancelUrl=$"{settings.WebBaseUrl.TrimEnd('/')}/conta?checkout=canceled",
            AllowPromotionCodes=false
        },new(){IdempotencyKey=$"vodown/checkout/{customer.UserId.Value}/{plan}/{requestId}"},ct);
        return Link(session);
    }
    public async Task<string> CreatePortalAsync(BillingCustomer customer,Guid requestId,CancellationToken ct)
    {
        EnsureConfigured();
        var session=await new Stripe.BillingPortal.SessionService(client).CreateAsync(new(){Customer=customer.StripeCustomerId,
            Configuration=string.IsNullOrWhiteSpace(settings.PortalConfigurationId)?null:settings.PortalConfigurationId,
            ReturnUrl=$"{settings.WebBaseUrl.TrimEnd('/')}/conta"},new(){IdempotencyKey=$"vodown/portal/{customer.UserId.Value}/{requestId}"},ct);
        return session.Url;
    }
    public BillingEvent VerifyEvent(string payload,string signature)
    {
        if(string.IsNullOrWhiteSpace(settings.WebhookSecret))throw new BillingUnavailableException("Webhook Stripe não configurado.");
        try
        {
            var verified=EventUtility.ConstructEvent(payload,signature,settings.WebhookSecret,300,false);
            using var document=JsonDocument.Parse(payload);
            var data=document.RootElement.GetProperty("data").GetProperty("object");
            string? Read(string key)=>data.TryGetProperty(key,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString():null;
            return new(verified.Id,verified.Type,verified.Livemode,Read("customer"),Read("payment_intent"));
        }
        catch(Exception e) when(e is StripeException or JsonException or KeyNotFoundException or ArgumentException)
        { throw new InvalidBillingEventException(); }
    }
    public async Task<string?> ResolveCustomerAsync(BillingEvent billingEvent,CancellationToken ct)
    {
        if(billingEvent.CustomerId is not null)return billingEvent.CustomerId;
        if(billingEvent.PaymentIntentId is null)return null;
        return (await new PaymentIntentService(client).GetAsync(billingEvent.PaymentIntentId,cancellationToken:ct)).CustomerId;
    }
    private static bool Owns(Dictionary<string,string> metadata,UserId userId)=>metadata.TryGetValue("vodown_user_id",out var owner)&&owner==userId.Value.ToString();
    private static CheckoutLink Link(Stripe.Checkout.Session session)=>new(session.Id,session.Url,new DateTimeOffset(DateTime.SpecifyKind(session.ExpiresAt,DateTimeKind.Utc)));
}
