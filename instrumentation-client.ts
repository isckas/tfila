import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
