import * as schema from "../db/auth-schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";
import { drizzle } from "drizzle-orm/d1";
import { hashPassword, verifyStoredPassword } from "./password";

export function createAuth(env: Env) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DATABASE, { schema }), {
      provider: "sqlite",
    }),
    baseURL: env.BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyStoredPassword },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      sendOnSignIn: true,
    },
    plugins: [
      emailOTP({
        otpLength: 8,
        expiresIn: 600,
        storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp }) {
          if (env.MAIL_MODE === "console") {
            console.log("LOCAL verification code", email, otp);
            return;
          }
          if (!env.RESEND_API_KEY || !env.MAIL_FROM)
            throw new Error("Email delivery is not configured");
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: env.MAIL_FROM,
              to: [email],
              subject: "Your Spaced verification code",
              text: `Your verification code is ${otp}. It expires in 10 minutes.`,
            }),
          });
          if (!response.ok) throw new Error("Email delivery failed");
        },
      }),
    ],
  });
}
