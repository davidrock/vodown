namespace Vodown.Shared.Domain;
public sealed record UserId
{
    public Guid Value { get; }
    public UserId(Guid value)
    {
        AssertionConcern.Require(value != Guid.Empty, "O usuário é obrigatório.");
        Value = value;
    }
}
