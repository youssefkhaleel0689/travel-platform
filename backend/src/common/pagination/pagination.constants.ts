// Fixed page size required by GEN-05; clients cannot change it.
export const PAGE_SIZE = 10;

// The highest page a list accepts. Far past any real list, and small enough
// that (page - 1) * PAGE_SIZE stays a valid MongoDB skip (a huge page was a 500).
export const MAX_PAGE = 100_000;
