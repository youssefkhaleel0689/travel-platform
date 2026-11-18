// GEN-09: why a user reports content. A closed list so the admin queue can
// be filtered and counted; OTHER needs a written explanation in `details`.
export enum ReportReason {
  SPAM = 'SPAM',
  HARASSMENT = 'HARASSMENT',
  HATE_SPEECH = 'HATE_SPEECH',
  INAPPROPRIATE = 'INAPPROPRIATE',
  MISINFORMATION = 'MISINFORMATION',
  OTHER = 'OTHER',
}

export const REPORT_REASONS = Object.values(ReportReason);

// Schema section 6: reports.status. OPEN until an admin decides; the closed
// states say what was decided (GEN-10).
export enum ReportStatus {
  OPEN = 'OPEN',
  DISMISSED = 'DISMISSED',
  HIDDEN = 'HIDDEN',
  DELETED = 'DELETED',
}

export const REPORT_STATUSES = Object.values(ReportStatus);

/** GEN-10: what an admin decides about a report. */
export enum ReportDecision {
  DISMISS = 'DISMISS',
  HIDE = 'HIDE',
  DELETE = 'DELETE',
}

export const REPORT_DETAILS_MAX_LENGTH = 500;
