import { describe, expect, it } from "vitest"
import { parseCloudflareJwks } from "../src/auth/cloudflare-jwks-fetcher.js"

const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUHrvPkM4rsH5qAowogeKKGrtbAtQwDQYJKoZIhvcNAQEL
BQAwIjEgMB4GA1UEAwwXc3RlZWwtbWFuYWdlci1qd2tzLXRlc3QwHhcNMjYwNzIx
MDkwNjUxWhcNMzYwNzE4MDkwNjUxWjAiMSAwHgYDVQQDDBdzdGVlbC1tYW5hZ2Vy
LWp3a3MtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJNUPb0n
sZuEgeasr1agY/n+W8ut8xuznoiy8pLAkwIJl/0+8buW+VByy0DxPL3fjg9Zr0Wk
M31WITMSH9V8sjZkcZhvLVvRnl0J8l87mRbbpF+lMxDhyao1AhSGEDzAPGKXrRTF
694AVa+Y+jncg3rpXYz025tkTT+clkxPtKwbHh3SyQVFkdusq+8pPtklC6Bu2Ned
Y9vr6syrWyC9nqwdP+/I3OHIOqJ7W7NSvKv4aousU0xLnKnNyA3vIHqytHnq/REO
HXvEWMIvab8m/llP/PHnKbryToIkc7RXXl4GSVaQjaOEs6dlc8BQRAvL0bPhObav
NFy5KfnldUYuhJkCAwEAAaNTMFEwHQYDVR0OBBYEFPIM8RnX3q1Xw7InjdK/eC81
r57gMB8GA1UdIwQYMBaAFPIM8RnX3q1Xw7InjdK/eC81r57gMA8GA1UdEwEB/wQF
MAMBAf8wDQYJKoZIhvcNAQELBQADggEBADjRH091jdjfsW6fDhYix6qVgsJZ7hwq
zq6qneHrKxNeg8q7YHsVTJkDAXcLPhN8gPqMqqjYIcpoweMunxUF+BGXqXTdr6Yb
LFPjC6WCYbZQh9K+dtAwIGpy5fd2kDIYKX4X/5zHHNXrvZlUUFRD7nZSSDB5jy6Z
gURXEbc1ljfujfZlU0VW084n/n267kOkjNeDAIinI4VE2Ehoa3YQvcEes7qpR3gv
yF7ygHHl/cMkTR8T71nvis1KzXAq34kIqqlFmrvhGo/fWWnYbMA41yPcPyp5YfIp
SOVz8jjxgke6sm9kXapCUPS1qJzw4w4rP4lRyYVshF80uYnRsZWfPao=
-----END CERTIFICATE-----`

const RSA_MODULUS =
  "k1Q9vSexm4SB5qyvVqBj-f5by63zG7OeiLLyksCTAgmX_T7xu5b5UHLLQPE8vd-OD1mvRaQzfVYhMxIf1XyyNmRxmG8tW9GeXQnyXzuZFtukX6UzEOHJqjUCFIYQPMA8YpetFMXr3gBVr5j6OdyDeuldjPTbm2RNP5yWTE-0rBseHdLJBUWR26yr7yk-2SULoG7Y151j2-vqzKtbIL2erB0_78jc4cg6ontbs1K8q_hqi6xTTEucqc3IDe8gerK0eer9EQ4de8RYwi9pvyb-WU_88ecpuvJOgiRztFdeXgZJVpCNo4Szp2VzwFBEC8vRs-E5tq80XLkp-eV1Ri6EmQ"

describe("Cloudflare JWKS document parser", () => {
  it("binds each RSA JWK to its unexpired public certificate", () => {
    // Given
    const document = jwksDocument(RSA_MODULUS)
    const now = Date.UTC(2027, 0, 1)

    // When
    const parsed = parseCloudflareJwks(document, now)

    // Then
    expect(parsed).toEqual([
      expect.objectContaining({
        kid: "test-kid",
        n: RSA_MODULUS,
        notAfterMilliseconds: Date.parse("Jul 18 09:06:51 2036 GMT"),
      }),
    ])
  })

  it("rejects a mismatched or expired certificate binding", () => {
    // Given
    const mismatched = jwksDocument(`${RSA_MODULUS.slice(0, -1)}A`)
    const valid = jwksDocument(RSA_MODULUS)

    // When / Then
    expect(() => parseCloudflareJwks(mismatched, Date.UTC(2027, 0, 1))).toThrowError(
      "JWKS certificate key mismatch",
    )
    expect(() => parseCloudflareJwks(valid, Date.UTC(2040, 0, 1))).toThrowError(
      "JWKS certificate validity rejected",
    )
  })
})

function jwksDocument(modulus: string): unknown {
  const certificate = { cert: CERTIFICATE, kid: "test-kid" }
  return {
    keys: [
      {
        alg: "RS256",
        e: "AQAB",
        kid: "test-kid",
        kty: "RSA",
        n: modulus,
        use: "sig",
      },
    ],
    public_cert: certificate,
    public_certs: [certificate],
  }
}
