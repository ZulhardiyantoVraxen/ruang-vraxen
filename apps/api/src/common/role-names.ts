/**
 * Everything else in this platform treats divisions/roles as pure data (see
 * schema.prisma's header comment) - roles are created at runtime, never a
 * hardcoded enum. These four names are the one deliberate exception: the
 * UI/UX design hand-off (tasks.service.broadcast -> approvals.service.decide)
 * has to recognize "this is the design role" and "this is who it hands off
 * to" by something, and matching the exact seeded name is simpler than a new
 * schema flag for a single workflow. If the seed names ever change, update
 * here too.
 */
export const ROLE_NAMES = {
  UIUX_DESIGNER: "Desainer UI/UX",
  ANALYST: "Analis",
  DEVELOPER: "Developer",
  PM_SOFTWARE: "PM Software",
} as const;
