import { redirect } from "next/navigation";

/**
 * The chat used to live here. It is now a dock available on every page, so
 * this route redirects rather than 404s: anyone who bookmarked it lands on the
 * dashboard with the analyst one click away in the corner.
 */
export default function AskPage() {
  redirect("/");
}
