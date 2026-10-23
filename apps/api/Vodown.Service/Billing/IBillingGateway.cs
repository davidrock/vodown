using Vodown.Shared.Domain;
namespace Vodown.Service.Billing;
public interface IBillingGateway
{
    bool IsConfigured { get; }
    Task<IReadOnlyList<PlanPrice>> GetPricesAsync(CancellationToken cancellationToken);
    Task<string> CreateCustomerAsync(UserId userId, CancellationToken cancellationToken);
    Task<BillingState> GetStateAsync(BillingCustomer customer, CancellationToken cancellationToken);
    Task<string?> ResolveCustomerAsync(BillingEvent billingEvent,CancellationToken cancellationToken);
    Task<CheckoutLink?> GetOpenCheckoutAsync(string checkoutId, CancellationToken cancellationToken);
    Task ExpireCheckoutAsync(string checkoutId, CancellationToken cancellationToken);
    Task<CheckoutLink> CreateCheckoutAsync(BillingCustomer customer, BillingPlan interval, Guid requestId, CancellationToken cancellationToken);
    Task<string> CreatePortalAsync(BillingCustomer customer, Guid requestId, CancellationToken cancellationToken);
    BillingEvent VerifyEvent(string payload, string signature);
}
