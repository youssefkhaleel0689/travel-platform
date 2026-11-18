// GEN-07: the closed list of admin actions the audit log records. A closed
// list, like NotificationType, so the admin screen always knows how to render
// a row and nobody can log a typo as a new kind of action.
export enum AuditAction {
  /** ACC-16 */
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  /** ACC-16 */
  ACCOUNT_REACTIVATED = 'ACCOUNT_REACTIVATED',
  /** ACC-07a */
  ACCOUNT_PASSWORD_RESET = 'ACCOUNT_PASSWORD_RESET',
  /** ACC-13 */
  MODERATOR_CREATED = 'MODERATOR_CREATED',
  /** ACC-15: a hotel or an airline was deactivated (B1 / A2 call this). */
  PROVIDER_DEACTIVATED = 'PROVIDER_DEACTIVATED',
  /** ACC-15 */
  PROVIDER_REACTIVATED = 'PROVIDER_REACTIVATED',
  /** GEN-10: content hidden, directly or by resolving a report. */
  CONTENT_HIDDEN = 'CONTENT_HIDDEN',
  /** GEN-10: hidden content made visible again. */
  CONTENT_RESTORED = 'CONTENT_RESTORED',
  /** GEN-10: content deleted, directly or by resolving a report. */
  CONTENT_DELETED = 'CONTENT_DELETED',
  /** GEN-10: a report closed without touching the content. */
  REPORT_DISMISSED = 'REPORT_DISMISSED',
}

export const AUDIT_ACTIONS = Object.values(AuditAction);

/** What the action was done to. */
export enum AuditEntityType {
  ACCOUNT = 'ACCOUNT',
  HOTEL = 'HOTEL',
  AIRLINE = 'AIRLINE',
  POST = 'POST',
  COMMENT = 'COMMENT',
  REVIEW = 'REVIEW',
  ITINERARY = 'ITINERARY',
  REPORT = 'REPORT',
}

export const AUDIT_ENTITY_TYPES = Object.values(AuditEntityType);
