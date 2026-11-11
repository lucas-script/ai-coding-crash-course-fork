import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import { adminOverviewAccess } from "./admin-instructor-overview";

describe("adminOverviewAccess", () => {
  it("lets an admin view an instructor", () => {
    expect(adminOverviewAccess(UserRole.Admin, UserRole.Instructor)).toBe("ok");
  });

  it("forbids non-admins, whoever the target is", () => {
    for (const viewer of [UserRole.Student, UserRole.Instructor, undefined]) {
      expect(adminOverviewAccess(viewer, UserRole.Instructor)).toBe("forbidden");
      expect(adminOverviewAccess(viewer, undefined)).toBe("forbidden");
    }
  });

  it("reports unknown or non-instructor targets as not found to admins", () => {
    for (const target of [undefined, UserRole.Student, UserRole.Admin]) {
      expect(adminOverviewAccess(UserRole.Admin, target)).toBe("not-found");
    }
  });
});
