import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { prisma } from "../../../../lib/db/prisma";
import { verifyPassword } from "../../../../lib/auth/password";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim();
        const password = credentials?.password;

        if (!email || !password) {
          return null;
        }

        const user = await prisma.users.findFirst({
          where: {
            email: {
              equals: email,
              mode: "insensitive",
            },
          },
          select: {
            id: true,
            email: true,
            name: true,
            password_hash: true,
            failed_login_attempts: true,
            locked_until: true,
            role: true,
            is_admin: true,
            is_internal_auditor: true,
            is_active: true,
          },
        });

        if (!user || !user.is_active) {
          return null;
        }

        const now = new Date();

        if (user.locked_until && user.locked_until > now) {
          return null;
        }

        const passwordMatches = await verifyPassword(password, user.password_hash);

        if (!passwordMatches) {
          const failedAttempts =
            user.locked_until && user.locked_until <= now
              ? 1
              : user.failed_login_attempts + 1;
          const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;

          await prisma.users.update({
            where: { id: user.id },
            data: {
              failed_login_attempts: failedAttempts,
              locked_until: shouldLock
                ? new Date(now.getTime() + LOCK_DURATION_MS)
                : null,
            },
          });

          return null;
        }

        await prisma.users.update({
          where: { id: user.id },
          data: {
            failed_login_attempts: 0,
            locked_until: null,
            last_login_at: now,
          },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          is_admin: user.is_admin,
          is_internal_auditor: user.is_internal_auditor,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.is_admin = user.is_admin;
        token.is_internal_auditor = user.is_internal_auditor;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.is_admin = token.is_admin;
        session.user.is_internal_auditor = token.is_internal_auditor;
      }

      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
