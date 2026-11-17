// Sanity ceilings for one passenger's extra bags, so a typo cannot reach the service. The
// airline's own limits (FLT-08) and the cabin's bag weight are checked by the service.
export const MAX_EXTRA_BAGS = 20;
export const MAX_BAG_WEIGHT_KG = 100;

// Passport or national ID: letters and digits only, after trimming and upper-casing.
export const DOCUMENT_NUMBER = /^[A-Z0-9]{5,30}$/;
