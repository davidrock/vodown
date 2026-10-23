namespace Vodown.Repository.Billing;
public sealed class StripeSettings
{
    public string SecretKey { get; set; } = "";
    public string WebhookSecret { get; set; } = "";
    public string MonthlyPriceId { get; set; } = "";
    public string AnnualPriceId { get; set; } = "";
    public string LifetimePriceId { get; set; } = "";
    public string WebBaseUrl { get; set; } = "http://localhost:3000";
    public string PortalConfigurationId { get; set; } = "";
}
