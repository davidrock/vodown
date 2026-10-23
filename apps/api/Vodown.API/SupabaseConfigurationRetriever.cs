using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
namespace Vodown.API;
public sealed class SupabaseConfigurationRetriever : IConfigurationRetriever<OpenIdConnectConfiguration>
{
    public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(string address, IDocumentRetriever retriever, CancellationToken cancel)
    {
        var document = await retriever.GetDocumentAsync(address, cancel);
        var configuration = new OpenIdConnectConfiguration { Issuer = address.Replace("/.well-known/jwks.json", "", StringComparison.Ordinal) };
        foreach (var key in new JsonWebKeySet(document).GetSigningKeys()) configuration.SigningKeys.Add(key);
        return configuration;
    }
}
