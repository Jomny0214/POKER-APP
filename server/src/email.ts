// Minimal wrapper around Resend's HTTP API (https://resend.com) for
// transactional email -- currently just the "forgot password" link.
//
// Setup: create a free Resend account, get an API key, and add it to
// Railway as an env var:
//   RESEND_API_KEY=re_xxxxxxxx
// Optionally also set RESEND_FROM_EMAIL once a sending domain is verified
// on Resend (until then, their shared onboarding@resend.dev sender works
// for testing but Resend restricts it to sending only to the account
// owner's own verified email -- fine for the admin to test with, not for
// real players, so verify a domain before relying on this for players).
//
// If RESEND_API_KEY isn't set at all, sendEmail() logs the message instead
// of sending it, so the server never crashes over missing config -- it just
// can't actually deliver mail until the key is added.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Apex Poker <onboarding@resend.dev>";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log(`[email:not-configured] Would send to ${to}: "${subject}"\n${html}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[email] Resend send failed (${res.status}): ${text}`);
    }
  } catch (err) {
    console.error("[email] Resend request failed", err);
  }
  // Deliberately never throws: a forgot-password request must still return
  // its generic "check your email" response to the caller even if the
  // email provider hiccups, both to avoid leaking which addresses are
  // registered and so a Resend outage doesn't surface as a server error.
}
