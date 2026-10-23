using Vodown.Shared.Domain;
namespace Vodown.Service.Billing;
public interface IBillingRepository
{
    Task<T> WithUserLockAsync<T>(UserId userId, Func<CancellationToken,Task<T>> action, CancellationToken cancellationToken);
    Task<BillingCustomer?> FindCustomerAsync(UserId userId,CancellationToken cancellationToken);
    Task<BillingCustomer?> FindByStripeCustomerAsync(string customerId,CancellationToken cancellationToken);
    void AddCustomer(BillingCustomer customer);
    Task<bool> WasProcessedAsync(string eventId,CancellationToken cancellationToken);
    Task SaveStateAsync(UserId userId,BillingState state,DateTimeOffset observedAt,CancellationToken cancellationToken);
    void RecordEvent(ProcessedBillingEvent billingEvent);
}
