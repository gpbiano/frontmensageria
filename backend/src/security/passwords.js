import crypto from "crypto";

const ITERATIONS = 210000;
const KEYLEN = 32;
const DIGEST = "sha256";

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(String(password), salt, ITERATIONS, KEYLEN, DIGEST)
    .toString("hex");

  // formato: pbkdf2$sha256$iters$salt$hash
  return `pbkdf2$${DIGEST}$${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    if (!stored) return false;
    const parts = String(stored).split("$");
    if (parts.length !== 5) return false;

    const [algo, digest, itersStr, salt, hash] = parts;
    if (algo !== "pbkdf2") return false;

    const iters = Number(itersStr);
    if (!Number.isFinite(iters) || iters < 10000) return false;

    const computed = crypto
      .pbkdf2Sync(String(password), salt, iters, KEYLEN, digest)
      .toString("hex");

    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(computed, "hex"));
  } catch {
    return false;
  }
}
