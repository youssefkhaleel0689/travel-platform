/**
 * The contract between ACC-13 (an admin creates a moderator account, C2) and
 * the two modules that own the link collections: flights (A2) owns
 * `airlineModeratorAssignment`, hotels (B1) owns `hotelModeratorAssignment`.
 *
 * ACC-13 creates the user document, which is the accounts module's job, but the
 * link from that user to the one airline or hotel it manages belongs to the
 * provider module. Schema section 2.2 is explicit that the link is never copied
 * onto the user, so administration must not write either collection directly.
 * It asks through this port instead.
 *
 * That is what lets the endpoint be built and tested while only one of the two
 * provider modules exists: an unwired type answers 501 rather than 500.
 *
 * To plug a module in: implement ModeratorAssignmentPort in one class, provide
 * it under AIRLINE_MODERATOR_ASSIGNMENT_PORT or
 * HOTEL_MODERATOR_ASSIGNMENT_PORT, and export the token. Nothing in
 * administration changes.
 */
export interface ModeratorAssignmentPort {
  /**
   * Checked before the moderator account is created, so a bad provider id
   * cannot leave an account behind with nothing to manage.
   *
   * Throws 404 when no such airline or hotel exists, and 400
   * PROVIDER_DEACTIVATED when it exists but is deactivated (ACC-15): a
   * deactivated provider gets no new moderator.
   *
   * `actingAdminId` is the admin making the request. A provider module hides a
   * deactivated provider from everyone but an admin and its own moderator, so
   * the check has to be made as that admin for the 400 to be reachable at all.
   */
  assertAssignable(providerId: string, actingAdminId: string): Promise<void>;

  /**
   * Writes the link. The unique index on moderatorId is what enforces "exactly
   * one": a moderator who already manages a provider gets 409.
   */
  assign(moderatorId: string, providerId: string): Promise<void>;
}

/**
 * Wired today by AirlineModeratorAssignmentAdapter, on top of the
 * AirlinesService that FlightsModule exports.
 */
export const AIRLINE_MODERATOR_ASSIGNMENT_PORT =
  'AIRLINE_MODERATOR_ASSIGNMENT_PORT';

/** Unwired: the hotels module does not exist yet (B1, HTL-01). */
export const HOTEL_MODERATOR_ASSIGNMENT_PORT =
  'HOTEL_MODERATOR_ASSIGNMENT_PORT';
