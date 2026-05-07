/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appConnectionActions from "../appConnectionActions.js";
import type * as appConnections from "../appConnections.js";
import type * as auth from "../auth.js";
import type * as automationActions from "../automationActions.js";
import type * as automations from "../automations.js";
import type * as calendar from "../calendar.js";
import type * as calendarPreferences from "../calendarPreferences.js";
import type * as chatAttachments from "../chatAttachments.js";
import type * as chats from "../chats.js";
import type * as crons from "../crons.js";
import type * as desktopApi from "../desktopApi.js";
import type * as googleAuth from "../googleAuth.js";
import type * as googleTools from "../googleTools.js";
import type * as http from "../http.js";
import type * as inboxItems from "../inboxItems.js";
import type * as jiraWebhook from "../jiraWebhook.js";
import type * as noteComments from "../noteComments.js";
import type * as notes from "../notes.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as onboarding from "../onboarding.js";
import type * as projects from "../projects.js";
import type * as recipes from "../recipes.js";
import type * as search from "../search.js";
import type * as templates from "../templates.js";
import type * as transcriptSessions from "../transcriptSessions.js";
import type * as trash from "../trash.js";
import type * as userPreferences from "../userPreferences.js";
import type * as workspaces from "../workspaces.js";
import type * as yandexCalendar from "../yandexCalendar.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appConnectionActions: typeof appConnectionActions;
  appConnections: typeof appConnections;
  auth: typeof auth;
  automationActions: typeof automationActions;
  automations: typeof automations;
  calendar: typeof calendar;
  calendarPreferences: typeof calendarPreferences;
  chatAttachments: typeof chatAttachments;
  chats: typeof chats;
  crons: typeof crons;
  desktopApi: typeof desktopApi;
  googleAuth: typeof googleAuth;
  googleTools: typeof googleTools;
  http: typeof http;
  inboxItems: typeof inboxItems;
  jiraWebhook: typeof jiraWebhook;
  noteComments: typeof noteComments;
  notes: typeof notes;
  notificationPreferences: typeof notificationPreferences;
  onboarding: typeof onboarding;
  projects: typeof projects;
  recipes: typeof recipes;
  search: typeof search;
  templates: typeof templates;
  transcriptSessions: typeof transcriptSessions;
  trash: typeof trash;
  userPreferences: typeof userPreferences;
  workspaces: typeof workspaces;
  yandexCalendar: typeof yandexCalendar;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
