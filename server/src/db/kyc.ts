import { db } from "./database";

// A simple, in-house identity verification queue -- not a third-party
// KYC/AML vendor integration (deliberately, per product decision). A
// player fills in their identity details and uploads a photo of an ID
// document; an admin reviews it by eye and approves or rejects. The photo
// is stored as a base64 data URL directly in the same SQLite database as
// everything else, same pattern as the rest of this app's "just SQLite,
// no external storage" design -- fine at this scale, would want to move to
// object storage (S3-compatible) if submission volume grows.

db.exec(`
CREATE TABLE IF NOT EXISTS kyc_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  address TEXT NOT NULL,
  id_type TEXT NOT NULL,
  id_number TEXT NOT NULL,
  id_image_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_submissions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_submissions(status, id);
`);

export type KycStatus = "unverified" | "pending" | "approved" | "rejected";

export interface KycSubmissionInput {
  fullName: string;
  dateOfBirth: string;
  address: string;
  idType: string;
  idNumber: string;
  idImageData: string; // data:image/...;base64,... -- validated below
}

export class KycError extends Error {}

const MAX_IMAGE_BYTES = 5_000_000; // ~5MB decoded; body-size cap upstream is the hard limit
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function validateImageDataUrl(dataUrl: string): void {
  const match = /^data:(image\/[a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new KycError("ID photo must be a valid image upload");
  const [, mime, b64] = match;
  if (!ALLOWED_IMAGE_TYPES.includes(mime)) throw new KycError("ID photo must be a JPEG, PNG, or WebP image");
  // base64 expands data ~4/3; approximate decoded size without actually decoding.
  const approxBytes = (b64.length * 3) / 4;
  if (approxBytes > MAX_IMAGE_BYTES) throw new KycError("ID photo is too large");
}

const insertStmt = db.prepare(
  `INSERT INTO kyc_submissions (user_id, username, full_name, date_of_birth, address, id_type, id_number, id_image_data, status, submitted_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
);
const latestForUserStmt = db.prepare(
  `SELECT * FROM kyc_submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1`
);
const getByIdStmt = db.prepare(`SELECT * FROM kyc_submissions WHERE id = ?`);
const listPendingStmt = db.prepare(
  `SELECT id, user_id, username, full_name, id_type, submitted_at FROM kyc_submissions WHERE status = 'pending' ORDER BY id ASC`
);
const resolveStmt = db.prepare(
  `UPDATE kyc_submissions SET status = ?, resolved_at = ?, resolved_by = ?, rejection_reason = ? WHERE id = ?`
);

export interface KycSubmissionRow {
  id: number;
  user_id: string;
  username: string;
  full_name: string;
  date_of_birth: string;
  address: string;
  id_type: string;
  id_number: string;
  id_image_data: string;
  status: KycStatus;
  submitted_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  rejection_reason: string | null;
}

/**
 * Player submits (or resubmits, after a rejection) their identity details
 * and ID photo. Blocked while a submission is already pending review, or
 * once one has been approved -- an approved player is verified; there's no
 * "re-verify" flow needed for this scope.
 */
export function submitKyc(userId: string, username: string, input: KycSubmissionInput): KycSubmissionRow {
  const fullName = (input.fullName ?? "").trim();
  const dateOfBirth = (input.dateOfBirth ?? "").trim();
  const address = (input.address ?? "").trim();
  const idType = (input.idType ?? "").trim();
  const idNumber = (input.idNumber ?? "").trim();

  if (fullName.length < 2 || fullName.length > 100) throw new KycError("Full name is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) throw new KycError("Date of birth is required");
  if (address.length < 5 || address.length > 300) throw new KycError("Address is required");
  if (!idType) throw new KycError("ID type is required");
  if (idNumber.length < 2 || idNumber.length > 60) throw new KycError("ID number is required");
  validateImageDataUrl(input.idImageData ?? "");

  const existing = latestForUserStmt.get(userId) as unknown as KycSubmissionRow | undefined;
  if (existing?.status === "pending") throw new KycError("Your verification is already pending review");
  if (existing?.status === "approved") throw new KycError("You're already verified");

  const result = insertStmt.run(
    userId,
    username,
    fullName,
    dateOfBirth,
    address,
    idType,
    idNumber,
    input.idImageData.trim(),
    Date.now()
  );
  return getByIdStmt.get(Number(result.lastInsertRowid)) as unknown as KycSubmissionRow;
}

/** The player's own latest submission, or null if they've never submitted one. */
export function getMyLatestKyc(userId: string): KycSubmissionRow | null {
  return (latestForUserStmt.get(userId) as unknown as KycSubmissionRow | undefined) ?? null;
}

/** A player's overall status: the status of their latest submission, or "unverified" if none exists. */
export function getKycStatus(userId: string): KycStatus {
  return (latestForUserStmt.get(userId) as unknown as KycSubmissionRow | undefined)?.status ?? "unverified";
}

export interface KycPendingSummary {
  id: number;
  user_id: string;
  username: string;
  full_name: string;
  id_type: string;
  submitted_at: number;
}

/** Admin queue: pending submissions, without the (large) image payload -- see getKycDetail for that. */
export function listPendingKyc(): KycPendingSummary[] {
  return listPendingStmt.all() as unknown as KycPendingSummary[];
}

/** Full detail for one submission, including the ID photo -- for the admin review screen. */
export function getKycDetail(id: number): KycSubmissionRow | null {
  return (getByIdStmt.get(id) as unknown as KycSubmissionRow | undefined) ?? null;
}

export function approveKyc(id: number, resolvedBy: string): KycSubmissionRow {
  const row = getByIdStmt.get(id) as unknown as KycSubmissionRow | undefined;
  if (!row) throw new KycError("Submission not found");
  if (row.status !== "pending") throw new KycError("Submission already resolved");
  resolveStmt.run("approved", Date.now(), resolvedBy, null, id);
  return getByIdStmt.get(id) as unknown as KycSubmissionRow;
}

export function rejectKyc(id: number, resolvedBy: string, reason: string): KycSubmissionRow {
  const row = getByIdStmt.get(id) as unknown as KycSubmissionRow | undefined;
  if (!row) throw new KycError("Submission not found");
  if (row.status !== "pending") throw new KycError("Submission already resolved");
  resolveStmt.run("rejected", Date.now(), resolvedBy, (reason ?? "").trim().slice(0, 500) || null, id);
  return getByIdStmt.get(id) as unknown as KycSubmissionRow;
}

const scrubStmt = db.prepare(
  `UPDATE kyc_submissions SET full_name = '[deleted]', date_of_birth = '[deleted]', address = '[deleted]',
    id_number = '[deleted]', id_image_data = '' WHERE user_id = ?`
);

/** Called from account deletion: the identity document itself (name, DOB,
 * address, ID number, ID photo) has no reason to keep existing once the
 * account behind it is gone, even though the submission ROW stays (status +
 * timestamps) for admin audit history of what was reviewed and when. */
export function scrubKycForUser(userId: string): void {
  scrubStmt.run(userId);
}
