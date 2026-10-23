using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Vodown.Service.Entitlements;
using Vodown.Service.Subscriptions;
using Vodown.Shared.Domain;
using Xunit;

namespace Vodown.Tests;
public sealed class ApiTests : IClassFixture<TestApi>
{
    private readonly TestApi factory;
    public ApiTests(TestApi factory) { this.factory = factory; }
    [Fact] public async Task LivenessDoesNotPretendTheDatabaseIsReady()
    {
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
    }
    [Fact] public async Task MissingTokenIsUnauthorized()
    {
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v1/me/entitlements")).StatusCode);
    }
    [Fact] public async Task SignedMemberTokenReturnsFreeFromTheRepository()
    {
        using var client = Client();
        var plan = await client.GetFromJsonAsync<Entitlements>("/v1/me/entitlements");
        Assert.Equal(Entitlements.Free, plan);
    }
    [Theory]
    [InlineData("extension", 1, HttpStatusCode.OK)]
    [InlineData("extension", 2, HttpStatusCode.Forbidden)]
    [InlineData("desktop", 1, HttpStatusCode.Forbidden)]
    [InlineData("extension", 0, HttpStatusCode.BadRequest)]
    [InlineData("unknown", 1, HttpStatusCode.BadRequest)]
    public async Task DownloadAuthorizationEnforcesPlanAndValidatesInput(string clientType, int count, HttpStatusCode expected)
    {
        using var client = Client();
        var response = await client.PostAsJsonAsync("/v1/me/download-authorizations", new { client = clientType, lessonCount = count });
        Assert.Equal(expected, response.StatusCode);
    }
    [Theory]
    [InlineData("wrong-issuer")]
    [InlineData("wrong-audience")]
    [InlineData("expired")]
    [InlineData("wrong-signature")]
    public async Task InvalidTokensCannotReachPermissions(string scenario)
    {
        using var client = Client(scenario);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v1/me/entitlements")).StatusCode);
    }
    [Fact] public async Task MissingClientDoesNotSilentlyBecomeAnExtensionRequest()
    {
        using var client = Client();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/v1/me/download-authorizations", new { lessonCount = 1 })).StatusCode);
    }
    [Theory]
    [InlineData("service-role")]
    [InlineData("anonymous")]
    [InlineData("invalid-user")]
    public async Task AuthenticatedNonMembersAreForbidden(string scenario)
    {
        using var client = Client(scenario);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/v1/me/entitlements")).StatusCode);
    }
    private HttpClient Client(string scenario = "valid")
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", factory.Token(scenario));
        return client;
    }
}
public sealed class TestApi : WebApplicationFactory<Program>
{
    private const string Issuer = "https://oqwidyxobduhddbvopkt.supabase.co/auth/v1";
    private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<ISubscriptionRepository>();
            services.AddScoped<ISubscriptionRepository, NoSubscription>();
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                var configuration = new OpenIdConnectConfiguration { Issuer = Issuer };
                configuration.SigningKeys.Add(new ECDsaSecurityKey(key) { KeyId = "test-only" });
                options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(configuration);
            });
        });
    }
    public string Token(string scenario)
    {
        var now = DateTime.UtcNow;
        using var wrongKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var credentials = new SigningCredentials(new ECDsaSecurityKey(scenario == "wrong-signature" ? wrongKey : key) { KeyId = "test-only" }, SecurityAlgorithms.EcdsaSha256);
        var claims = new[] {
            new Claim("sub", scenario == "invalid-user" ? "not-a-guid" : Guid.NewGuid().ToString()),
            new Claim("role", scenario == "service-role" ? "service_role" : "authenticated"),
            new Claim("is_anonymous", scenario == "anonymous" ? "true" : "false", ClaimValueTypes.Boolean)
        };
        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
            issuer: scenario == "wrong-issuer" ? "https://untrusted.example" : Issuer,
            audience: scenario == "wrong-audience" ? "other-app" : "authenticated", claims: claims,
            notBefore: now.AddHours(-2), expires: scenario == "expired" ? now.AddHours(-1) : now.AddMinutes(5), signingCredentials: credentials));
    }
    protected override void Dispose(bool disposing) { base.Dispose(disposing); if (disposing) key.Dispose(); }
    private sealed class NoSubscription : ISubscriptionRepository
    { public Task<bool> HasLifetimeLicenseAsync(UserId userId,CancellationToken ct)=>Task.FromResult(false); public Task<Subscription?> FindByUserAsync(UserId userId, CancellationToken cancellationToken) => Task.FromResult<Subscription?>(null); }
}
