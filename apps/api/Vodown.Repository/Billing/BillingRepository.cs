using Microsoft.EntityFrameworkCore;
using Vodown.Service.Billing;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
namespace Vodown.Repository.Billing;
public sealed class BillingRepository(VodownDbContext db) : IBillingRepository
{
    public async Task<T> WithUserLockAsync<T>(UserId userId,Func<CancellationToken,Task<T>> action,CancellationToken cancellationToken)
    {
        await using var transaction=await db.Database.BeginTransactionAsync(cancellationToken);
        // Transaction-scoped locks also serialize requests from different API instances.
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({userId.Value.ToString()},0))",cancellationToken);
        var result=await action(cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return result;
    }
    public Task<BillingCustomer?> FindCustomerAsync(UserId userId,CancellationToken ct)=>db.BillingCustomers.SingleOrDefaultAsync(x=>x.UserId==userId,ct);
    public Task<BillingCustomer?> FindByStripeCustomerAsync(string customerId,CancellationToken ct)=>db.BillingCustomers.AsNoTracking().SingleOrDefaultAsync(x=>x.StripeCustomerId==customerId,ct);
    public void AddCustomer(BillingCustomer customer)=>db.BillingCustomers.Add(customer);
    public Task<bool> WasProcessedAsync(string eventId,CancellationToken ct)=>db.ProcessedBillingEvents.AnyAsync(x=>x.Id==eventId,ct);
    public void RecordEvent(ProcessedBillingEvent billingEvent)=>db.ProcessedBillingEvents.Add(billingEvent);
    public async Task SaveStateAsync(UserId userId,BillingState state,DateTimeOffset observedAt,CancellationToken ct)
    {
        foreach(var purchase in state.Purchases)
        {
            var license=await db.LifetimeLicenses.SingleOrDefaultAsync(x=>x.CheckoutId==purchase.CheckoutId,ct);
            if(license is null) {license=new(userId,purchase.CheckoutId,purchase.PaymentIntentId);db.LifetimeLicenses.Add(license);}
            if(license.UserId!=userId)throw new DomainException("Compra pertence a outra conta.");
            license.Synchronize(purchase.IsValid,observedAt);
        }
        var snapshot=state.Subscription;
        var existing=await db.Subscriptions.SingleOrDefaultAsync(x=>x.UserId==userId,ct);
        if(snapshot is null)
        {
            existing?.Synchronize(SubscriptionStatus.Inactive,observedAt,false,observedAt);
            return;
        }
        if(existing is null)
        { existing=new(userId,snapshot.SubscriptionId,snapshot.CustomerId);db.Subscriptions.Add(existing); }
        else existing.UpdateProviderReference(snapshot.SubscriptionId,snapshot.CustomerId);
        existing.Synchronize(snapshot.Status,snapshot.PaidThrough,snapshot.CancelAtPeriodEnd,observedAt);
    }
}
