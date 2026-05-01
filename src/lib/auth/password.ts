import bcrypt from "bcrypt";
import { z } from "zod";

const BCRYPT_COST = 12;

export const passwordSchema = z.string().min(12).refine(
  (password) => {
    const checks = [
      /[A-Z]/.test(password),
      /[a-z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password),
    ];

    return checks.filter(Boolean).length >= 3;
  },
  {
    message:
      "Password must include at least 3 of 4: uppercase letter, lowercase letter, digit, special character",
  },
);

export async function hashPassword(password: string): Promise<string> {
  const validatedPassword = passwordSchema.parse(password);

  return bcrypt.hash(validatedPassword, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
