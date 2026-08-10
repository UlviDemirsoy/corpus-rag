import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "../../config/env.js";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";

export function createAuth() {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      crossSubDomainCookies: {
        enabled: false,
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        // Only mark Secure on HTTPS; Docker local demo uses http://localhost
        secure: env.BETTER_AUTH_URL.startsWith("https://"),
        httpOnly: true,
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
