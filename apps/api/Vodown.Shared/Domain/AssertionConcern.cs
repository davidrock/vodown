namespace Vodown.Shared.Domain;
public static class AssertionConcern
{
    public static void Require(bool condition, string message)
    { if (!condition) throw new DomainException(message); }
    public static string NotBlank(string? value, string message, int maxLength = 200)
    {
        Require(!string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength, message);
        return value!.Trim();
    }
}
