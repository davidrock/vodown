using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Vodown.API;
using Vodown.Repository;
using Vodown.Service.Entitlements;
using Vodown.Service.Subscriptions;
using Vodown.Service.Billing;
using Vodown.Repository.Billing;

var builder = WebApplication.CreateBuilder(args);
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    foreach (var network in builder.Configuration.GetSection("ReverseProxy:KnownNetworks").Get<string[]>() ?? [])
        options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
});
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddControllers().AddJsonOptions(options =>
    options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase, false)));
builder.Services.AddOpenApi();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<EntitlementService>();
builder.Services.AddScoped<ISubscriptionRepository, SubscriptionRepository>();
builder.Services.AddScoped<IBillingRepository,BillingRepository>();
builder.Services.AddScoped<BillingService>();
var stripeSettings=builder.Configuration.GetSection("Stripe").Get<StripeSettings>()??new();
builder.Services.AddSingleton(stripeSettings);
builder.Services.AddHttpClient("stripe",client=>client.Timeout=TimeSpan.FromSeconds(12));
builder.Services.AddScoped<Stripe.IStripeClient>(services=>
{
    if(!stripeSettings.SecretKey.StartsWith("sk_test_",StringComparison.Ordinal))throw new BillingUnavailableException("Somente Stripe de testes está habilitado nesta etapa.");
    return new Stripe.StripeClient(stripeSettings.SecretKey,httpClient:new Stripe.SystemNetHttpClient(services.GetRequiredService<IHttpClientFactory>().CreateClient("stripe"),maxNetworkRetries:1));
});
builder.Services.AddScoped<IBillingGateway,StripeGateway>();
builder.Services.AddScoped(services=>new Lazy<Stripe.IStripeClient>(()=>services.GetRequiredService<Stripe.IStripeClient>()));
builder.Services.AddDbContext<VodownDbContext>(options =>
{
    var connection = builder.Configuration.GetConnectionString("Vodown");
    if (string.IsNullOrWhiteSpace(connection)) throw new DatabaseNotConfiguredException();
    options.UseNpgsql(connection,npgsql=>npgsql.MigrationsHistoryTable("__EFMigrationsHistory","vodown"));
});
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("postgres");

var supabaseUrl = builder.Configuration["Supabase:Url"]?.TrimEnd('/');
if (!Uri.TryCreate(supabaseUrl, UriKind.Absolute, out var authUri) || authUri.Scheme != "https")
    throw new InvalidOperationException("Configure uma URL HTTPS válida em Supabase:Url.");
var issuer = $"{supabaseUrl}/auth/v1";
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.RequireHttpsMetadata = true;
    options.ConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(
        $"{issuer}/.well-known/jwks.json", new SupabaseConfigurationRetriever(), new HttpDocumentRetriever { RequireHttps = true });
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true, ValidIssuer = issuer,
        ValidateAudience = true, ValidAudience = "authenticated",
        ValidateLifetime = true, RequireExpirationTime = true,
        ValidateIssuerSigningKey = true, RequireSignedTokens = true,
        ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.RsaSha256],
        ClockSkew = TimeSpan.FromSeconds(30), NameClaimType = "sub"
    };
});
builder.Services.AddAuthorizationBuilder().AddPolicy("Member", policy => policy.RequireAuthenticatedUser()
    .RequireClaim("role", "authenticated")
    .RequireAssertion(context => Guid.TryParse(context.User.FindFirst("sub")?.Value, out var id) && id != Guid.Empty
        && context.User.FindFirst("is_anonymous")?.Value != "true"));
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseForwardedHeaders();
app.UseExceptionHandler();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    // Container probes use HTTP internally; business endpoints remain HTTPS-only.
    app.UseWhen(context => !context.Request.Path.StartsWithSegments("/health"), branch => branch.UseHttpsRedirection());
}
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/health/live", () => Results.Ok(new { status = "ok", service = "vodown-api" })).AllowAnonymous();
app.MapHealthChecks("/health/ready").AllowAnonymous();
app.MapControllers();
if (app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("Development:AllowLocalProActivation"))
{
    var localConnection = new Npgsql.NpgsqlConnectionStringBuilder(app.Configuration.GetConnectionString("Vodown"));
    if (localConnection.Host is not ("localhost" or "127.0.0.1") || localConnection.Database != "vodown")
        throw new InvalidOperationException("Licença de desenvolvimento exige o banco Vodown local.");
    app.MapPost("/v1/development/local-pro", async (HttpContext context, VodownDbContext db, CancellationToken cancellationToken) =>
    {
        if (context.Connection.RemoteIpAddress is not { } address || !System.Net.IPAddress.IsLoopback(address))
            return Results.NotFound();
        var id = Guid.Parse(context.User.FindFirst("sub")!.Value);
        var key = $"development-local-{id}";
        var license = await db.LifetimeLicenses.FindAsync([key], cancellationToken);
        if (license is null)
        {
            license = new LifetimeLicense(new Vodown.Shared.Domain.UserId(id), key, key);
            db.LifetimeLicenses.Add(license);
        }
        license.Synchronize(true, DateTimeOffset.UtcNow);
        await db.SaveChangesAsync(cancellationToken);
        return Results.Ok(new { scope = "local-development", plan = "pro" });
    }).RequireAuthorization("Member");
}
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.Run();
public partial class Program;
