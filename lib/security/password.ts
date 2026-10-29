import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

//
// Workers runtime constraint (verified 2026-10-28, wrangler tail): a single
// scrypt verify at N=2^17, r=8 costs ~10 CPU-seconds inside a Workers isolate
// — exactly the per-request CPU budget on the workers.dev endpoint — so every
// FAILED login attempt killed its invocation (`outcome: exceededCpu`, CF 1102)
// before the throttling layer could even score it. That CPU burn was the real
// trigger of the intermittent 500s described below; the serialization below
// fixed the memory race but one derivation alone still exceeded the budget.
//
// New hashes therefore use N=2^14, r=8, p=1 (~16 MiB, ~8x less CPU, ~1.2s in
// workerd): comfortably inside the CPU budget while keeping scrypt's strong
// password-hardening properties for interactive logins. verifyPassword reads
// N/r/p from the stored hash, so previously created hashes still verify; any
// legacy-strength hash is transparently upgraded on the user's next
// successful login (modules/identity/service.ts → needsRehash).
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
// Hard ceiling only (not a pre-allocation): must admit legacy N=2^17 (≈134 MiB
// working set) so pre-upgrade hashes keep verifying.
const MAX_MEM = 256 * 1024 * 1024;
const MAX_ACCEPTED_N = 2 ** 20;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, len: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, len, { N: n, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * All password hashing/verification runs one ~16 MiB scrypt derivation at a
 * time per isolate, via a promise chain. This keeps the isolate's memory use
 * bounded under concurrent bursts (Workers isolates have a ~128 MB ceiling);
 * under load it also means wall time grows linearly instead of racing derivations.
 */
let scryptChain: Promise<unknown> = Promise.resolve();

function runExclusively<T>(fn: () => Promise<T>): Promise<T> {
  const run = scryptChain.then(fn, fn); // run regardless of the previous result
  scryptChain = run.catch(() => {}); // keep the chain alive after failures
  return run;
}

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  return runExclusively(async () => {
    const salt = randomBytes(16);
    const key = await derive(password, salt, N, R, P, KEY_LEN);
    return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const params = hashParamsOf(stored);
  if (!params) return false;
  const expected = Buffer.from(stored.split("$")[5], "base64");
  if (expected.length === 0) return false;
  // Only the ~16 MiB derivation is serialized; parse/reject paths above stay cheap.
  return runExclusively(async () => {
    try {
      const actual = await derive(
        password,
        Buffer.from(stored.split("$")[4], "base64"),
        params.n,
        params.r,
        params.p,
        expected.length,
      );
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  });
}

export type ScryptParams = { n: number; r: number; p: number };

/**
 * Parses the stored-hash parameters without deriving anything. Returns null for
 * anything that is not a well-formed `scrypt$N$r$p$...` hash with accepted
 * parameter ranges — callers that only need the metadata never touch scrypt.
 */
export function hashParamsOf(stored: string): ScryptParams | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every(Number.isInteger) || n < 2 || n > MAX_ACCEPTED_N || r < 1 || p < 1) {
    return null;
  }
  return { n, r, p };
}

/**
 * True when a stored hash no longer matches the runtime's hashing parameters
 * (pre-2026-10-28 CPU-constrained upgrade, or malformed). The login flow uses
 * this to transparently upgrade legacy hashes after a successful verification.
 * Malformed hashes can never verify, so marking them `true` is safe: rehashing
 * only ever runs after `verifyPassword` returns true.
 */
export function needsRehash(stored: string): boolean | null {
  const params = hashParamsOf(stored);
  if (!params) return true;
  return params.n !== N || params.r !== R || params.p !== P;
}
