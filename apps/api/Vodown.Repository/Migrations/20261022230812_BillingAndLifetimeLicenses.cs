using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Vodown.Repository.Migrations
{
    /// <inheritdoc />
    public partial class BillingAndLifetimeLicenses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "billing_customers",
                schema: "vodown",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    stripe_customer_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    checkout_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    checkout_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    checkout_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    checkout_interval = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_billing_customers", x => x.user_id);
                });

            migrationBuilder.CreateTable(
                name: "lifetime_licenses",
                schema: "vodown",
                columns: table => new
                {
                    checkout_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    payment_intent_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    is_valid = table.Column<bool>(type: "boolean", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lifetime_licenses", x => x.checkout_id);
                });

            migrationBuilder.CreateTable(
                name: "processed_billing_events",
                schema: "vodown",
                columns: table => new
                {
                    event_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    processed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_processed_billing_events", x => x.event_id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_billing_customers_stripe_customer_id",
                schema: "vodown",
                table: "billing_customers",
                column: "stripe_customer_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_lifetime_licenses_payment_intent_id",
                schema: "vodown",
                table: "lifetime_licenses",
                column: "payment_intent_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_lifetime_licenses_user_id",
                schema: "vodown",
                table: "lifetime_licenses",
                column: "user_id");
            foreach (var table in new[] { "billing_customers", "lifetime_licenses", "processed_billing_events" })
            {
                migrationBuilder.Sql($"ALTER TABLE vodown.{table} ENABLE ROW LEVEL SECURITY;");
                migrationBuilder.Sql($"REVOKE ALL ON vodown.{table} FROM PUBLIC;");
                migrationBuilder.Sql($"""
                    DO $$ BEGIN
                        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                            REVOKE ALL ON vodown.{table} FROM anon;
                        END IF;
                        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                            REVOKE ALL ON vodown.{table} FROM authenticated;
                        END IF;
                    END $$;
                    """);
            }

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "billing_customers",
                schema: "vodown");

            migrationBuilder.DropTable(
                name: "lifetime_licenses",
                schema: "vodown");

            migrationBuilder.DropTable(
                name: "processed_billing_events",
                schema: "vodown");
        }
    }
}
