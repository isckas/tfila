import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Admin sign-in for tfila.co.",
};

interface PageProps {
  searchParams: Promise<{ sent?: string; error?: string }>;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = params.error;

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold mb-2">Admin sign-in</h1>
      <p className="text-sm text-neutral-600 mb-6">
        Enter your email. We&apos;ll send a one-time sign-in link (valid 15 minutes).
      </p>

      {sent && (
        <div className="mb-6 rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Check your inbox. If the email is on the admin allow-list, a sign-in link is on its way.
        </div>
      )}

      {error && (
        <div className="mb-6 rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error === "invalid"
            ? "That link is invalid or expired. Request a new one below."
            : error === "missing"
              ? "Missing token in URL."
              : "Something went wrong. Try again."}
        </div>
      )}

      <form method="post" action="/api/admin/request-link" className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-neutral-800">Email</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            placeholder="you@example.com"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Send link
        </button>
      </form>
    </main>
  );
}
