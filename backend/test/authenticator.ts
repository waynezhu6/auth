import { createHash, generateKeyPairSync, randomBytes, sign } from "crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

// A software passkey for tests: does what a phone or laptop does when the
// browser calls navigator.credentials.create() and .get(). P-256 (ES256), no
// attestation, always reports user presence and verification.
export class SoftAuthenticator {
  private key = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private rawId = randomBytes(16);
  private counter = 0;
  private userHandle = "";

  constructor(
    private origin: string,
    private rpId: string,
  ) {}

  get id(): string {
    return this.rawId.toString("base64url");
  }

  create(options: PublicKeyCredentialCreationOptionsJSON, origin = this.origin): RegistrationResponseJSON {
    this.userHandle = options.user.id;
    const jwk = this.key.publicKey.export({ format: "jwk" });
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, bytes(Buffer.from(jwk.x!, "base64url"))],
      [-3, bytes(Buffer.from(jwk.y!, "base64url"))],
    ]);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.rawId.length);
    const authData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([0x45]), // user present, user verified, attested credential data
      this.counterBytes(),
      Buffer.alloc(16), // AAGUID
      idLength,
      this.rawId,
      Buffer.from(isoCBOR.encode(cose)),
    ]);
    const clientDataJSON = this.clientData("webauthn.create", options.challenge, origin);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, string> | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", new Map<string, string>()],
        ["authData", bytes(authData)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  get(options: PublicKeyCredentialRequestOptionsJSON, origin = this.origin): AuthenticationResponseJSON {
    this.counter++;
    const authData = Buffer.concat([this.rpIdHash(), Buffer.from([0x05]), this.counterBytes()]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.key.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    };
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private rpIdHash(): Buffer {
    return sha256(Buffer.from(this.rpId));
  }

  private counterBytes(): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(this.counter);
    return b;
  }
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

// The CBOR encoder wants plain Uint8Arrays, not Buffers.
function bytes(b: Buffer): Uint8Array {
  return new Uint8Array(b);
}
