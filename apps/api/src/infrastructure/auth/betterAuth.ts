import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { env } from "../../config/env.js";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";

const googleEnabled =
  Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);

/** Public origin used for MCP resource metadata (same host as the app). */
const publicOrigin = env.WEB_ORIGIN.replace(/\/$/, "");

export function createAuth() {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        oauthApplication: schema.oauthApplication,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [
      env.WEB_ORIGIN,
      "http://localhost:3000",
      "https://cursor.com",
      "https://www.cursor.com",
    ],
    emailAndPassword: {
      enabled: true,
    },
    ...(googleEnabled
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID!,
              clientSecret: env.GOOGLE_CLIENT_SECRET!,
              prompt: "select_account" as const,
            },
          },
        }
      : {}),
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: googleEnabled ? ["google"] : [],
      },
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
        secure: env.BETTER_AUTH_URL.startsWith("https://"),
        httpOnly: true,
      },
    },
    plugins: [
      mcp({
        // Web login (email/password or Google) — required before MCP tokens issue
        loginPage: "/login",
        resource: `${publicOrigin}/mcp`,
        oidcConfig: {
          allowDynamicClientRegistration: true,
          loginPage: "/login",
          consentPage: "/oauth/consent",
        },
      }),
    ],
  });
}

export function isGoogleAuthEnabled() {
  return googleEnabled;
}

export type Auth = ReturnType<typeof createAuth>;
