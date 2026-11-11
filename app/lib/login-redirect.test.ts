import { describe, it, expect } from "vitest";
import { UserRole } from "~/db/schema";
import { getLoginDestination } from "./login-redirect";

describe("getLoginDestination", () => {
  it("sends instructors to the instructor area when no redirectTo is given", () => {
    expect(getLoginDestination(UserRole.Instructor, null)).toBe("/instructor");
  });

  it("sends students and admins to the course catalog when no redirectTo is given", () => {
    expect(getLoginDestination(UserRole.Student, null)).toBe("/courses");
    expect(getLoginDestination(UserRole.Admin, null)).toBe("/courses");
  });

  it("honours a relative redirectTo for every role", () => {
    for (const role of [UserRole.Instructor, UserRole.Student, UserRole.Admin]) {
      expect(getLoginDestination(role, "/redeem/ABC")).toBe("/redeem/ABC");
    }
  });

  it("ignores unsafe redirectTo values and falls back to the role default", () => {
    for (const unsafe of ["https://evil.example", "//evil.example", "/\\evil.example", ""]) {
      expect(getLoginDestination(UserRole.Instructor, unsafe)).toBe("/instructor");
      expect(getLoginDestination(UserRole.Student, unsafe)).toBe("/courses");
    }
  });
});
