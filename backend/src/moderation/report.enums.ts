// GEN-09: OTHER needs a written explanation in `details`.
export enum ReportReason {
  SPAM = 'SPAM',
  HARASSMENT = 'HARASSMENT',
  HATE_SPEECH = 'HATE_SPEECH',
  INAPPROPRIATE = 'INAPPROPRIATE',
  MISINFORMATION = 'MISINFORMATION',
  OTHER = 'OTHER',
}

export const REPORT_REASONS = Object.values(ReportReason);

// OPEN until an admin decides; the other states record the decision.
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
