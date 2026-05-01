import { getCurrentUser } from "./getCurrentUser";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireRole(roles: string[]) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new AuthError("Unauthorized", 401);
  }

  if (!roles.includes(currentUser.role)) {
    throw new AuthError("Forbidden", 403);
  }

  return currentUser;
}

export async function requireAdmin() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new AuthError("Unauthorized", 401);
  }

  if (currentUser.is_admin !== true) {
    throw new AuthError("Forbidden", 403);
  }

  return currentUser;
}
