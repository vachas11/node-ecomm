import crypto from 'crypto';

/**
 * Generate a random token and its hash
 * @returns Object with raw token and hashed token
 */
export function generateTokenWithHash(): { token: string; hash: string } {
  // Generate a random 32-byte token
  const token = crypto.randomBytes(32).toString('hex');

  // Hash the token
  const hash = hashToken(token);

  return { token, hash };
}

/**
 * Hash a token using SHA-256
 * @param token - The raw token to hash
 * @returns Hashed token
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
