using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vodown.Repository.Migrations
{
    /// <inheritdoc />
    public partial class InitialSubscriptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "vodown");

            migrationBuilder.CreateTable(
                name: "subscriptions",
                schema: "vodown",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    stripe_subscription_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    stripe_customer_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    paid_through = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    cancel_at_period_end = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_subscriptions", x => x.user_id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_subscriptions_stripe_subscription_id",
                schema: "vodown",
                table: "subscriptions",
                column: "stripe_subscription_id",
                unique: true);

            // Billing writes belong exclusively to the backend; no browser role can upgrade a plan.
            migrationBuilder.Sql("ALTER TABLE vodown.subscriptions ENABLE ROW LEVEL SECURITY;");
            migrationBuilder.Sql("REVOKE ALL ON SCHEMA vodown FROM PUBLIC;");
            migrationBuilder.Sql("REVOKE ALL ON vodown.subscriptions FROM PUBLIC;");
            migrationBuilder.Sql("""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                        REVOKE ALL ON SCHEMA vodown FROM anon;
                        REVOKE ALL ON vodown.subscriptions FROM anon;
                    END IF;
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                        REVOKE ALL ON SCHEMA vodown FROM authenticated;
                        REVOKE ALL ON vodown.subscriptions FROM authenticated;
                    END IF;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "subscriptions",
                schema: "vodown");
        }
    }
}
