import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, KeyObject } from "crypto";
import { db } from "./database";

// A single Ed25519 keypair, generated once and persisted in the same SQLite
// database as everything else (so it survives redeploys on the same volume,
// same as user accounts and table history do). The private key never leaves
// this process -- it's only ever used here, to sign a hand's result the
// moment it settles. The public key is safe to hand out (see
// GET /api/verify/publickey) so anyone -- a player, an auditor -- can check a
// hand's signature independently, without trusting the server's word for it.
db.exec(`
CREATE TABLE IF NOT EXISTS signing_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// hand_history predates hand-signing, so on an existing database these
// columns need to be added rather than assumed -- CREATE TABLE IF NOT EXISTS
// in database.ts won't add columns to a table that already exists.
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("hand_history", "hash", "hash TEXT");
ensureColumn("hand_history", "signature", "signature TEXT");

let cachedPrivateKey: KeyObject | null = null;
let cachedPublicKeyPem: string | null = null;

function loadOrCreateKeypair(): { privateKey: KeyObject; publicKeyPem: string } {
  if (cachedPrivateKey && cachedPublicKeyPem) {
    return { privateKey: cachedPrivateKey, publicKeyPem: cachedPublicKeyPem };
  }
  const row = db.prepare(`SELECT public_key, private_key FROM signing_keys WHERE id = 1`).get() as
    | { public_key: string; private_key: string }
    | undefined;
  if (row) {
    cachedPrivateKey = createPrivateKey(row.private_key);
    cachedPublicKeyPem = row.public_key;
    return { privateKey: cachedPrivateKey, publicKeyPem: cachedPublicKeyPem };
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  db.prepare(`INSERT INTO signing_keys (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)`).run(
    publicKeyPem,
    privateKeyPem,
    Date.now()
  );
  cachedPrivateKey = privateKey;
  cachedPublicKeyPem = publicKeyPem;
  return { privateKey, publicKeyPem };
}

/** SHA-256 of a hand's canonical JSON data blob, hex-encoded. */
export function hashHandData(dataJson: string): string {
  return createHash("sha256").update(dataJson, "utf8").digest("hex");
}

/**
 * Signs a settled hand's data JSON. Called once, right when the hand is
 * recorded into hand_history -- the hash+signature are stored alongside the
 * data so the record can be checked at any later time.
 */
export function signHandData(dataJson: string): { hash: string; signature: string } {
  const { privateKey } = loadOrCreateKeypair();
  const hash = hashHandData(dataJson);
  const signature = cryptoSign(null, Buffer.from(hash, "hex"), privateKey).toString("base64");
  return { hash, signature };
}

/** The server's public signing key, PEM-encoded, for independent verification. */
export function getPublicKeyPem(): string {
  return loadOrCreateKeypair().publicKeyPem;
}

/**
 * Re-hashes a stored hand record and checks it against its stored signature.
 * Returns false if the data was altered after the fact, or if the signature
 * doesn't match the server's public key.
 */
export function verifyHandSignature(dataJson: string, hash: string, signature: string): boolean {
  if (hashHandData(dataJson) !== hash) return false;
  const { publicKeyPem } = loadOrCreateKeypair();
  try {
    const publicKey = createPublicKey(publicKeyPem);
    return cryptoVerify(null, Buffer.from(hash, "hex"), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
