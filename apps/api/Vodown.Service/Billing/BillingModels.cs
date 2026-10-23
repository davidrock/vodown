using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
namespace Vodown.Service.Billing;

public enum BillingPlan { Monthly, Annual, Lifetime }
public sealed record CheckoutLink(string Id, string Url, DateTimeOffset ExpiresAt);
public sealed record PlanPrice(string Interval, string Currency, long AmountMinor);
public sealed record BillingSnapshot(string SubscriptionId, string CustomerId, SubscriptionStatus Status,
    DateTimeOffset PaidThrough, bool CancelAtPeriodEnd, bool BlocksNewCheckout);
public sealed record BillingEvent(string Id, string Type, bool LiveMode, string? CustomerId, string? PaymentIntentId);
public sealed record LifetimePurchaseSnapshot(string CheckoutId,string PaymentIntentId,bool IsValid);
public sealed record BillingState(BillingSnapshot? Subscription,IReadOnlyList<LifetimePurchaseSnapshot> Purchases)
{
    public bool HasLifetime => Purchases.Any(x=>x.IsValid);
}
public sealed class LifetimeLicense
{
    public string CheckoutId { get; private set; } = null!;
    public UserId UserId { get; private set; } = null!;
    public string PaymentIntentId { get; private set; } = null!;
    public bool IsValid { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    private LifetimeLicense() { }
    public LifetimeLicense(UserId userId,string checkoutId,string paymentIntentId)
    { UserId=userId;CheckoutId=AssertionConcern.NotBlank(checkoutId,"Compra inválida.");PaymentIntentId=AssertionConcern.NotBlank(paymentIntentId,"Pagamento inválido."); }
    public void Synchronize(bool valid,DateTimeOffset observedAt) { IsValid=valid;UpdatedAt=observedAt; }
}
public sealed class BillingConflictException(string message) : Exception(message);
public sealed class BillingUnavailableException(string message) : Exception(message);
public sealed class InvalidBillingEventException() : Exception("Assinatura de webhook inválida.");

public sealed class BillingCustomer
{
    public UserId UserId { get; private set; } = null!;
    public string StripeCustomerId { get; private set; } = null!;
    public string? CheckoutId { get; private set; }
    public string? CheckoutUrl { get; private set; }
    public DateTimeOffset? CheckoutExpiresAt { get; private set; }
    public BillingPlan? CheckoutInterval { get; private set; }
    private BillingCustomer() { }
    public BillingCustomer(UserId userId, string stripeCustomerId)
    {
        UserId = userId;
        StripeCustomerId = AssertionConcern.NotBlank(stripeCustomerId,"Cliente de cobrança inválido.");
    }
    public void RememberCheckout(CheckoutLink link, BillingPlan interval)
    {
        AssertionConcern.Require(Enum.IsDefined(interval),"Periodicidade inválida.");
        AssertionConcern.Require(Uri.TryCreate(link.Url,UriKind.Absolute,out var uri) && uri.Scheme=="https" && uri.Host=="checkout.stripe.com","URL de checkout inválida.");
        CheckoutId=link.Id; CheckoutUrl=link.Url; CheckoutExpiresAt=link.ExpiresAt; CheckoutInterval=interval;
    }
}
public sealed class ProcessedBillingEvent
{
    public string Id { get; private set; } = null!;
    public DateTimeOffset ProcessedAt { get; private set; }
    private ProcessedBillingEvent() { }
    public ProcessedBillingEvent(string id, DateTimeOffset processedAt)
    { Id=AssertionConcern.NotBlank(id,"Evento inválido.");ProcessedAt=processedAt; }
}
