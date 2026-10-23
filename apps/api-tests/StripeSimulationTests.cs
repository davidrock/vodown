using Stripe;
using Vodown.Repository.Billing;
using Vodown.Service.Billing;
using Vodown.Shared.Domain;
using Xunit;
namespace Vodown.Tests;

[Collection("Stripe simulation")]
public sealed class StripeSimulationTests:IDisposable
{
    private readonly HttpClient http=new(){Timeout=TimeSpan.FromSeconds(3)};
    private readonly string root=Environment.GetEnvironmentVariable("VODOWN_STRIPE_SIMULATION")??"http://127.0.0.1:4900/stripe";
    private readonly BillingCustomer customer=new(new(Guid.Parse("11111111-1111-4111-8111-111111111111")),"cus_fixture");
    private StripeGateway Gateway()=>new(new StripeSettings{SecretKey="sk_test_simulation",MonthlyPriceId="price_monthly",AnnualPriceId="price_annual",LifetimePriceId="price_lifetime"},
        new(()=>new StripeClient("sk_test_simulation",httpClient:new SystemNetHttpClient(http,maxNetworkRetries:0),apiBase:root)));
    private async Task SetMode(string mode)=>(await http.PostAsync($"{root}/__fixtures/{mode}",null)).EnsureSuccessStatusCode();
    [SimulationFact] public async Task ReadsAllThreePricesOverRealHttp()
    {
        await SetMode("empty");var prices=await Gateway().GetPricesAsync(default);
        Assert.Equal(new long[]{500,2500,10000},prices.Select(x=>x.AmountMinor));
    }
    [SimulationFact] public async Task SerializesCheckoutFormAndReadsHostedUrl()
    {
        await SetMode("empty");var gateway=Gateway();
        var result=await gateway.CreateCheckoutAsync(customer,BillingPlan.Annual,Guid.NewGuid(),default);
        Assert.StartsWith("https://checkout.stripe.com/",result.Url);
        Assert.NotNull(await gateway.GetOpenCheckoutAsync(result.Id,default));
        await gateway.ExpireCheckoutAsync(result.Id,default);
        Assert.Null(await gateway.GetOpenCheckoutAsync(result.Id,default));
        Assert.StartsWith("https://billing.stripe.com/",await gateway.CreatePortalAsync(customer,Guid.NewGuid(),default));
    }
    [SimulationFact] public async Task ReadsItemLevelSubscriptionPeriod()
    {
        await SetMode("active");var state=await Gateway().GetStateAsync(customer,default);
        Assert.NotNull(state.Subscription);Assert.True(state.Subscription.BlocksNewCheckout);
        Assert.True(state.Subscription.PaidThrough>DateTimeOffset.UtcNow);
    }
    [SimulationTheory]
    [InlineData("lifetime",true)]
    [InlineData("refunded",false)]
    [InlineData("disputed",false)]
    [InlineData("dispute-won",true)]
    public async Task LifetimeRefundAndDisputeUseLatestProviderState(string mode,bool expected)
    {
        await SetMode(mode);var state=await Gateway().GetStateAsync(customer,default);
        Assert.Single(state.Purchases);Assert.Equal(expected,state.HasLifetime);
    }
    [SimulationFact] public async Task UpstreamServerFailureIsNotInterpretedAsFreeOrPaid()
    {
        await SetMode("upstream-error");
        await Assert.ThrowsAsync<StripeException>(()=>Gateway().GetStateAsync(customer,default));
    }
    public void Dispose()=>http.Dispose();
}
public sealed class SimulationFactAttribute:FactAttribute
{public SimulationFactAttribute(){if(Environment.GetEnvironmentVariable("VODOWN_STRIPE_SIMULATION") is null)Skip="Run the local Stripe Postman simulation.";}}
public sealed class SimulationTheoryAttribute:TheoryAttribute
{public SimulationTheoryAttribute(){if(Environment.GetEnvironmentVariable("VODOWN_STRIPE_SIMULATION") is null)Skip="Run the local Stripe Postman simulation.";}}
