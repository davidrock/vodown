using Vodown.Shared.Domain;
namespace Vodown.Service.Subscriptions;
public enum SubscriptionStatus { Inactive, Trialing, Active, PastDue, Canceled, Unpaid }
public sealed class Subscription
{
    public UserId UserId { get; private set; } = null!;
    public string StripeSubscriptionId { get; private set; } = null!;
    public string StripeCustomerId { get; private set; } = null!;
    public SubscriptionStatus Status { get; private set; }
    public DateTimeOffset PaidThrough { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }
    public bool CancelAtPeriodEnd { get; private set; }
    private Subscription() { }
    public Subscription(UserId userId, string subscriptionId, string customerId)
    {
        UserId = userId ?? throw new ArgumentNullException(nameof(userId));
        StripeSubscriptionId = AssertionConcern.NotBlank(subscriptionId, "Assinatura inválida.");
        StripeCustomerId = AssertionConcern.NotBlank(customerId, "Cliente de cobrança inválido.");
    }
    // Called only by trusted billing synchronization, never from a user's plan request.
    public void UpdateProviderReference(string subscriptionId,string customerId)
    {
        AssertionConcern.Require(StripeCustomerId==customerId,"O cliente da assinatura não corresponde à conta.");
        StripeSubscriptionId=AssertionConcern.NotBlank(subscriptionId,"Assinatura inválida.");
    }
    public void Synchronize(SubscriptionStatus status, DateTimeOffset paidThrough, bool cancelAtPeriodEnd, DateTimeOffset observedAt)
    {
        AssertionConcern.Require(Enum.IsDefined(status), "Estado de assinatura inválido.");
        AssertionConcern.Require(paidThrough != default && observedAt != default, "Datas de assinatura inválidas.");
        AssertionConcern.Require(observedAt >= UpdatedAt, "Atualização de assinatura desatualizada.");
        Status = status; PaidThrough = paidThrough; CancelAtPeriodEnd = cancelAtPeriodEnd; UpdatedAt = observedAt;
    }
    public bool GrantsProAt(DateTimeOffset now) =>
        (Status is SubscriptionStatus.Active or SubscriptionStatus.Trialing) && PaidThrough > now;
}
