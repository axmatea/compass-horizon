import { IS_MOCK } from "@/lib/client/api";

/** Visible only when the client runs on mock data (NEXT_PUBLIC_LV_MOCK=1). */
export function MockBadge() {
  if (!IS_MOCK) return null;
  // In development the Next.js dev indicator sits in the same corner.
  const dev = process.env.NODE_ENV !== "production";
  return (
    <p className={dev ? "ld-mock ld-mock--dev" : "ld-mock"} title="This build uses mock data. Nothing on this page is from the live API.">
      Mock
    </p>
  );
}
