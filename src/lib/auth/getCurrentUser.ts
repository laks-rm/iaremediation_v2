import { getServerSession } from "next-auth/next";

import { authOptions } from "../../app/api/auth/[...nextauth]/route";
import { prisma } from "../db/prisma";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return null;
  }

  const user = await prisma.users.findFirst({
    where: { email, is_active: true },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      is_admin: true,
      is_internal_auditor: true,
    },
  });

  if (!user) {
    return null;
  }

  return user;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
