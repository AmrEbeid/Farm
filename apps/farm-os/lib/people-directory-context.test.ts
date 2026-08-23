// SPEC-0033 R4c — the people directory's URL contract.
//
// Two things are being proved here. First, that the directory has exactly ONE spelling per state, so
// a bookmark, a share and a cache key all agree. Second — and this is the security half — that a
// `?from=` value supplied by a caller can never become a link or a redirect off the site: every
// returned path is REBUILT from validated parts, so a hostile value degrades to `/people` instead of
// being echoed.

import { describe, expect, it } from "vitest";
import {
  PEOPLE_DIRECTORY_MAX_PAGE,
  PEOPLE_DIRECTORY_PATH,
  parsePeopleDirectoryContext,
  parsePeoplePage,
  parsePeopleQuery,
  parsePeopleReturnTo,
  parsePersonTab,
  peopleDirectoryHref,
  peopleDirectoryOffset,
  peoplePageCount,
  personHref,
  personHrefFromDirectory,
  readPeopleDirectoryRequest,
  readPersonRequest,
} from "./people-directory-context";
import { PEOPLE_DIRECTORY_PAGE_SIZE } from "./people-snapshot-reads";

const PERSON = "22222222-2222-4222-8222-222222222221";

describe("directory url state", () => {
  it("keeps a page number only when it is a real page in range", () => {
    expect(parsePeoplePage(undefined)).toBe(1);
    expect(parsePeoplePage("0")).toBe(1);
    expect(parsePeoplePage("-3")).toBe(1);
    expect(parsePeoplePage("1.5")).toBe(1);
    expect(parsePeoplePage("٢")).toBe(1);
    expect(parsePeoplePage("2")).toBe(2);
    expect(parsePeoplePage(String(PEOPLE_DIRECTORY_MAX_PAGE))).toBe(PEOPLE_DIRECTORY_MAX_PAGE);
    expect(parsePeoplePage(String(PEOPLE_DIRECTORY_MAX_PAGE + 1))).toBe(1);
  });

  it("cleans search text instead of refusing the page the user just opened", () => {
    expect(parsePeopleQuery(undefined)).toBe("");
    expect(parsePeopleQuery("  عامل  ")).toBe("عامل");
    // A control character is not text. It becomes a space and is trimmed away.
    expect(parsePeopleQuery(`عامل${String.fromCharCode(0)}`)).toBe("عامل");
    expect(parsePeopleQuery(String.fromCharCode(9, 10, 13))).toBe("");
    expect(parsePeopleQuery("س".repeat(200))).toHaveLength(60);
  });

  it("has exactly one url per state, with defaults omitted", () => {
    expect(peopleDirectoryHref()).toBe("/people");
    expect(peopleDirectoryHref({ page: 1, filter: "all", query: "" })).toBe("/people");
    expect(peopleDirectoryHref({ filter: "active" })).toBe("/people?filter=active");
    expect(peopleDirectoryHref({ query: "عامل", page: 3 }))
      .toBe(`/people?q=${encodeURIComponent("عامل")}&page=3`);
  });

  it("redirects any non-canonical spelling to the one canonical url", () => {
    expect(readPeopleDirectoryRequest({}).redirectTo).toBeNull();
    expect(readPeopleDirectoryRequest({ filter: "active", page: "2" }).redirectTo).toBeNull();
    expect(readPeopleDirectoryRequest({ page: "1" }).redirectTo).toBe("/people");
    expect(readPeopleDirectoryRequest({ filter: "all" }).redirectTo).toBe("/people");
    expect(readPeopleDirectoryRequest({ q: "" }).redirectTo).toBe("/people");
    expect(readPeopleDirectoryRequest({ filter: "nonsense" }).redirectTo).toBe("/people");
    expect(readPeopleDirectoryRequest({ page: "0" }).redirectTo).toBe("/people");
  });

  it("does not loop on an encoding difference", () => {
    // `+` and `%20` are the same space. Rebuilding both sides with URLSearchParams is what stops a
    // canonical request from looking non-canonical and redirecting to itself forever.
    const request = readPeopleDirectoryRequest({ q: "عامل حقل" });
    expect(request.redirectTo).toBeNull();
    expect(request.context.query).toBe("عامل حقل");
  });

  it("turns a validated page into an offset and an exact total into a page count", () => {
    expect(peopleDirectoryOffset(1)).toBe(0);
    expect(peopleDirectoryOffset(3)).toBe(2 * PEOPLE_DIRECTORY_PAGE_SIZE);
    expect(peoplePageCount("0")).toBe(1);
    expect(peoplePageCount("20")).toBe(1);
    expect(peoplePageCount("21")).toBe(2);
    // Exact in BigInt space. One person beyond a page size of 2^53 needs a SECOND page; read as a
    // JS double the extra person rounds away and the answer would be one page.
    expect(peoplePageCount("9007199254740993", 9007199254740992)).toBe(2);
  });

  it("parses a whole directory request in one call", () => {
    expect(parsePeopleDirectoryContext({ q: " مشرف ", filter: "assigned", page: "4" }))
      .toEqual({ query: "مشرف", filter: "assigned", page: 4 });
  });
});

describe("the return path is rebuilt, never echoed", () => {
  it("defaults to the bare directory for anything it does not recognise", () => {
    for (const raw of [
      undefined,
      "",
      "not-a-path",
      "https://evil.example/people",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/inventory",
      "/people/22222222-2222-4222-8222-222222222221",
      "/people-other",
      `/people?q=${"x".repeat(400)}`,
      `/people${String.fromCharCode(10)}`,
    ]) {
      expect(parsePeopleReturnTo(raw), String(raw)).toBe(PEOPLE_DIRECTORY_PATH);
    }
  });

  it("keeps a legal directory state and drops everything else about it", () => {
    expect(parsePeopleReturnTo("/people?filter=active&page=2")).toBe("/people?filter=active&page=2");
    expect(parsePeopleReturnTo("/people?filter=active&page=2#anchor")).toBe("/people?filter=active&page=2");
    // An unknown parameter is not preserved: the returned url is rebuilt from validated parts only.
    expect(parsePeopleReturnTo("/people?filter=active&evil=1")).toBe("/people?filter=active");
    // And an illegal value inside a legal parameter is normalised away rather than carried.
    expect(parsePeopleReturnTo("/people?filter=nonsense&page=0")).toBe("/people");
  });

  it("carries directory state into a person link and back again", () => {
    expect(personHrefFromDirectory(PERSON, { query: "", filter: "all", page: 1 }))
      .toBe(`/people/${PERSON}`);
    const href = personHrefFromDirectory(PERSON, { query: "مشرف", filter: "active", page: 2 });
    expect(href.startsWith(`/people/${PERSON}?from=`)).toBe(true);
    const from = new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("from");
    expect(parsePeopleReturnTo(from ?? undefined))
      .toBe(`/people?q=${encodeURIComponent("مشرف")}&filter=active&page=2`);
  });
});

describe("the person file's own url state", () => {
  it("falls back to the overview for an unknown tab", () => {
    expect(parsePersonTab(undefined)).toBe("overview");
    expect(parsePersonTab("operations")).toBe("overview");
    expect(parsePersonTab("work")).toBe("work");
    expect(parsePersonTab("activity")).toBe("activity");
    expect(parsePersonTab("team")).toBe("team");
  });

  it("has exactly one url per (tab, return path) pair", () => {
    expect(personHref(PERSON, "overview", null)).toBe(`/people/${PERSON}`);
    expect(personHref(PERSON, "overview", "/people")).toBe(`/people/${PERSON}`);
    expect(personHref(PERSON, "team", null)).toBe(`/people/${PERSON}?tab=team`);
    expect(personHref(PERSON, "work", "/people?filter=active"))
      .toBe(`/people/${PERSON}?tab=work&from=${encodeURIComponent("/people?filter=active")}`);
  });

  it("canonicalizes the person request and never trusts the caller's own from bytes", () => {
    expect(readPersonRequest(PERSON, {}).redirectTo).toBeNull();
    expect(readPersonRequest(PERSON, { tab: "team" }).redirectTo).toBeNull();
    expect(readPersonRequest(PERSON, { tab: "overview" }).redirectTo).toBe(`/people/${PERSON}`);
    expect(readPersonRequest(PERSON, { tab: "nonsense" }).redirectTo).toBe(`/people/${PERSON}`);
    const hostile = readPersonRequest(PERSON, { from: "https://evil.example" });
    expect(hostile.from).toBe(PEOPLE_DIRECTORY_PATH);
    expect(hostile.redirectTo).toBe(`/people/${PERSON}`);
  });
});
