export type RequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "completed"
  | "expired";

export type ViewerRole = "requester" | "owner";

export type ListingStatus = "available" | "reserved" | "given" | "paused" | "removed";

const TRANSITIONS: Record<RequestStatus, Partial<Record<RequestStatus, ViewerRole[]>>> = {
  pending: {
    accepted: ["owner"],
    declined: ["owner"],
    cancelled: ["requester"],
  },
  accepted: {
    completed: ["owner", "requester"],
    cancelled: ["owner", "requester"],
  },
  declined: {},
  cancelled: {},
  completed: {},
  expired: {},
};

export function canTransition(
  role: ViewerRole,
  from: RequestStatus,
  to: RequestStatus,
): boolean {
  const allowedRoles = TRANSITIONS[from]?.[to];
  return Boolean(allowedRoles?.includes(role));
}

export function allowedTargets(role: ViewerRole, from: RequestStatus): RequestStatus[] {
  return (Object.keys(TRANSITIONS[from] ?? {}) as RequestStatus[]).filter((to) =>
    canTransition(role, from, to),
  );
}

/** Listing status implied by the request lifecycle. */
export function listingStatusFor(
  current: ListingStatus,
  requestStatus: RequestStatus,
): ListingStatus {
  switch (requestStatus) {
    case "accepted":
      return "reserved";
    case "completed":
      return "given";
    case "declined":
    case "cancelled":
      return current === "given" || current === "removed" ? current : "available";
    default:
      // pending y expired no alteran la disponibilidad del ejemplar.
      return current;
  }
}
