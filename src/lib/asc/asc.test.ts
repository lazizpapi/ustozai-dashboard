/**
 * App Store Connect auth and report parsing.
 *
 * These run without a real key: the JWT tests sign with a throwaway P-256 pair,
 * and the report tests use a hand-built TSV in Apple's documented column shape.
 * That means the whole iOS path is verified before the real credential exists.
 */

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";

import { createAscToken, decodePrivateKey } from "./jwt";
import { ReportGoneError, parseSalesTsv } from "./sales";
import type { AscConfig } from "@/lib/env";

function throwawayConfig(): AscConfig {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  return {
    ASC_KEY_ID: "XU5DWY2V9H",
    ASC_ISSUER_ID: "b179e47a-d2c0-4e67-97db-2ff50d5176ef",
    ASC_VENDOR_NUMBER: "80123456",
    ASC_PRIVATE_KEY_B64: Buffer.from(pem, "utf8").toString("base64"),
  };
}

describe("decodePrivateKey", () => {
  it("accepts a base64 encoded PKCS8 key", () => {
    const config = throwawayConfig();
    expect(decodePrivateKey(config.ASC_PRIVATE_KEY_B64)).toContain("BEGIN PRIVATE KEY");
  });

  it("names the mistake when handed a certificate signing request", () => {
    // This is the single most common wrong file. A .certSigningRequest holds a
    // public key and comes from Keychain Access; it has nothing to do with the
    // App Store Connect API. The error has to say so rather than fail on a
    // confusing PKCS8 parse error twenty frames deeper.
    const csr = Buffer.from(
      "-----BEGIN CERTIFICATE REQUEST-----\nMIICmDCCAYAC\n-----END CERTIFICATE REQUEST-----",
      "utf8",
    ).toString("base64");

    expect(() => decodePrivateKey(csr)).toThrow(/certificate signing request/);
  });

  it("rejects anything that is not a PEM private key", () => {
    const notAKey = Buffer.from("XU5DWY2V9H", "utf8").toString("base64");
    expect(() => decodePrivateKey(notAKey)).toThrow(/BEGIN PRIVATE KEY/);
  });
});

describe("createAscToken", () => {
  it("signs with ES256 and carries the key id in the header", async () => {
    const config = throwawayConfig();
    const header = decodeProtectedHeader(await createAscToken(config));

    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(config.ASC_KEY_ID);
    expect(header.typ).toBe("JWT");
  });

  it("sets the issuer and the audience Apple requires", async () => {
    const config = throwawayConfig();
    const claims = decodeJwt(await createAscToken(config));

    expect(claims.iss).toBe(config.ASC_ISSUER_ID);
    expect(claims.aud).toBe("appstoreconnect-v1");
  });

  it("expires inside Apple's 20 minute ceiling", async () => {
    // Apple rejects any token valid more than 20 minutes out. Drifting past
    // this would fail every request with an opaque 401.
    const claims = decodeJwt(await createAscToken(throwawayConfig()));
    const lifetime = (claims.exp ?? 0) - Math.floor(Date.now() / 1000);

    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(20 * 60);
  });
});

describe("ReportGoneError", () => {
  it("names the date and reads as a retention outcome, not a failure", () => {
    // Measured against this account: day minus 365 returns 200 and day minus
    // 366 returns 410 "Daily reports are available for 365 days". A backfill
    // must stop on that rather than counting a year of them as errors, which
    // is what put a false alarm in the health panel the first time.
    const error = new ReportGoneError("2025-08-11");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ReportGoneError");
    expect(error.date).toBe("2025-08-11");
    expect(error.message).toContain("retention");
  });

  it("is distinguishable from an ordinary error by instanceof", () => {
    // This is the check collect.ts uses to decide stop-cleanly versus count-as-failed.
    const gone: unknown = new ReportGoneError("2025-08-11");
    const other: unknown = new Error("salesReports 500");

    expect(gone instanceof ReportGoneError).toBe(true);
    expect(other instanceof ReportGoneError).toBe(false);
  });
});

describe("parseSalesTsv", () => {
  const header = [
    "Provider",
    "Provider Country",
    "SKU",
    "Developer",
    "Title",
    "Version",
    "Product Type Identifier",
    "Units",
    "Developer Proceeds",
    "Begin Date",
    "End Date",
    "Customer Currency",
    "Country Code",
    "Currency of Proceeds",
    "Apple Identifier",
  ].join("\t");

  const row = (type: string, units: string, country: string, appleId = "6504815934") =>
    [
      "APPLE", "UZ", "ustozai", "Ustoz EDU", "Ustoz AI", "2.2.6",
      type, units, "0", "08/10/2026", "08/10/2026", "UZS", country, "USD", appleId,
    ].join("\t");

  it("sums first downloads by country", () => {
    const tsv = [header, row("1F", "120", "UZ"), row("1F", "8", "US")].join("\n");
    const result = parseSalesTsv(tsv, "6504815934");

    const uz = result.find((r) => r.country === "uz");
    expect(uz).toMatchObject({ units: 120, downloadType: "download", date: "2026-08-10" });
    expect(result.find((r) => r.country === "us")?.units).toBe(8);
  });

  it("separates updates from downloads instead of inflating installs", () => {
    const tsv = [header, row("1F", "100", "UZ"), row("7F", "4000", "UZ")].join("\n");
    const result = parseSalesTsv(tsv, "6504815934");

    expect(result.find((r) => r.downloadType === "download")?.units).toBe(100);
    expect(result.find((r) => r.downloadType === "update")?.units).toBe(4000);
  });

  it("excludes in-app purchases, which are not installs", () => {
    const tsv = [header, row("1F", "50", "UZ"), row("IA1", "999", "UZ")].join("\n");
    const result = parseSalesTsv(tsv, "6504815934");

    expect(result).toHaveLength(1);
    expect(result[0].units).toBe(50);
  });

  it("ignores rows belonging to a different app", () => {
    const tsv = [header, row("1F", "50", "UZ"), row("1F", "999", "UZ", "111111")].join("\n");
    expect(parseSalesTsv(tsv, "6504815934")[0].units).toBe(50);
  });

  it("converts Apple's MM/DD/YYYY dates to ISO", () => {
    const tsv = [header, row("1F", "1", "UZ")].join("\n");
    expect(parseSalesTsv(tsv, "6504815934")[0].date).toBe("2026-08-10");
  });

  it("returns nothing for a header-only report rather than throwing", () => {
    expect(parseSalesTsv(header, "6504815934")).toEqual([]);
    expect(parseSalesTsv("", "6504815934")).toEqual([]);
  });

  it("throws when the expected columns are absent", () => {
    // Apple warns that column positions can move, so we index by name. If a
    // name we depend on disappears, fail loudly instead of writing zeroes.
    expect(() => parseSalesTsv("Foo\tBar\n1\t2", "6504815934")).toThrow(/missing expected columns/);
  });

  it("reads columns by name even when their order changes", () => {
    const shuffled = ["Units", "Country Code", "Begin Date", "Product Type Identifier"].join("\t");
    const tsv = [shuffled, ["42", "UZ", "08/10/2026", "1F"].join("\t")].join("\n");

    expect(parseSalesTsv(tsv, "6504815934")[0]).toMatchObject({ units: 42, country: "uz" });
  });
});
