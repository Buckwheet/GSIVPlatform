import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import { type InventoryStore, SearchSyntaxError } from "./store.js";

const charSchema = z.object({
  id: z.number(),
  name: z.string(),
  game: z.string(),
  account: z.string(),
  prof: z.string(),
  race: z.string(),
  level: z.number(),
  exp: z.number(),
  area: z.string(),
  subscription: z.string(),
  citizenship: z.string(),
  society: z.string(),
  society_rank: z.string(),
  timestamp: z.number(),
});

const searchRowSchema = z.object({
  character: z.string(),
  account: z.string(),
  prof: z.string(),
  level: z.number(),
  loc: z.string(),
  location: z.string(),
  location_name: z.string(),
  path: z.string(),
  item: z.string(),
  noun: z.string(),
  type: z.string(),
  amount: z.number(),
  stack: z.string(),
  status: z.string(),
  marked: z.string(),
  registered: z.string(),
  worn: z.string(),
  hidden: z.string(),
  timestamp: z.number(),
});

const resourceRowSchema = z.object({
  character: z.string(),
  account: z.string(),
  prof: z.string(),
  level: z.number(),
  energy: z.string(),
  weekly: z.number(),
  total: z.number(),
  suffused: z.number(),
  favor: z.number(),
  bonus: z.number(),
});

const ticketRowSchema = z.object({
  character: z.string(),
  account: z.string(),
  prof: z.string(),
  level: z.number(),
  source: z.string(),
  amount: z.number(),
  currency: z.string(),
});

const lumnisRowSchema = z.object({
  character: z.string(),
  account: z.string(),
  prof: z.string(),
  level: z.number(),
  status: z.string(),
  triple: z.number(),
  double: z.number(),
  total: z.number(),
  start_day: z.string(),
  start_time: z.string(),
  last_schedule: z.string(),
});

const overviewSchema = z.object({
  stats: z.object({
    characters: z.number(),
    accounts: z.number(),
    items: z.number(),
    totalSilver: z.number(),
    dataAsOf: z.string().nullable(),
    tableFreshness: z.array(
      z.object({ table: z.string(), asOf: z.string().nullable(), daysOld: z.number().nullable() }),
    ),
  }),
  perCharacter: z.array(
    z.object({
      character: z.string(),
      account: z.string(),
      prof: z.string(),
      level: z.number(),
      race: z.string(),
      totalSilver: z.number(),
      itemCount: z.number(),
      resourceTotal: z.number().nullable(),
      energy: z.string().nullable(),
      lumnisTotal: z.number().nullable(),
      lumnisStatus: z.string().nullable(),
      ticketCount: z.number(),
      lastScan: z.number().nullable(),
    }),
  ),
  distributions: z.object({
    itemTypes: z.array(z.object({ label: z.string(), count: z.number() })),
    itemLocations: z.array(z.object({ label: z.string(), count: z.number() })),
    townBanks: z.array(z.object({ label: z.string(), amount: z.number() })),
    richest: z.array(z.object({ character: z.string(), totalSilver: z.number() })),
    topHoards: z.array(z.object({ character: z.string(), itemCount: z.number() })),
  }),
  notices: z.array(z.object({ level: z.enum(["info", "warn"]), message: z.string() })),
});

const routes = {
  summary: createRoute({
    method: "get",
    path: "/summary",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ characters: z.number(), items: z.number(), totalSilver: z.number() }),
          },
        },
        description: "Inventory summary counts",
      },
    },
  }),
  characters: createRoute({
    method: "get",
    path: "/characters",
    responses: { 200: { content: { "application/json": { schema: z.array(charSchema) } }, description: "Characters" } },
  }),
  locations: createRoute({
    method: "get",
    path: "/locations",
    responses: {
      200: {
        content: { "application/json": { schema: z.array(z.object({ name: z.string() })) } },
        description: "Locations",
      },
    },
  }),
  bank: createRoute({
    method: "get",
    path: "/bank",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                character: z.string(),
                account: z.string(),
                prof: z.string(),
                level: z.number(),
                bank: z.string(),
                silvers: z.number(),
              }),
            ),
          },
        },
        description: "Bank silvers",
      },
    },
  }),
  search: createRoute({
    method: "get",
    path: "/search",
    request: {
      query: z.object({
        q: z.string().optional(),
        character: z.string().optional(),
        location: z.string().optional(),
        filter: z.string().optional(),
      }),
    },
    responses: {
      200: { content: { "application/json": { schema: z.array(searchRowSchema) } }, description: "Search results" },
      400: { description: "Invalid filter expression (see error message)" },
    },
  }),
  resources: createRoute({
    method: "get",
    path: "/resources",
    responses: {
      200: { content: { "application/json": { schema: z.array(resourceRowSchema) } }, description: "Resources" },
    },
  }),
  tickets: createRoute({
    method: "get",
    path: "/tickets",
    responses: {
      200: { content: { "application/json": { schema: z.array(ticketRowSchema) } }, description: "Tickets" },
    },
  }),
  lumnis: createRoute({
    method: "get",
    path: "/lumnis",
    responses: {
      200: { content: { "application/json": { schema: z.array(lumnisRowSchema) } }, description: "Lumnis status" },
    },
  }),
  overview: createRoute({
    method: "get",
    path: "/overview",
    responses: {
      200: {
        content: { "application/json": { schema: overviewSchema } },
        description: "Unified overview of everything invdb collects",
      },
    },
  }),
};

export function createInventoryModule(store: InventoryStore): Module {
  return {
    name: "inventory",
    prefix: "/api/modules/inventory",
    scopes: [{ name: "inventory.read", description: "Read character inventory, bank, resources, tickets" }],
    nav: { path: "/inventory", title: "Inventory", group: "operations", order: 10, icon: "🎒" },
    routeScopes: {
      "GET /summary": ["inventory.read"],
      "GET /characters": ["inventory.read"],
      "GET /locations": ["inventory.read"],
      "GET /bank": ["inventory.read"],
      "GET /search": ["inventory.read"],
      "GET /resources": ["inventory.read"],
      "GET /tickets": ["inventory.read"],
      "GET /lumnis": ["inventory.read"],
      "GET /overview": ["inventory.read"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(routes.summary, (c) => c.json(store.summary()));
      router.openapi(routes.characters, (c) =>
        c.json(store.characters() as unknown as Array<z.infer<typeof charSchema>>),
      );
      router.openapi(routes.locations, (c) => c.json(store.locations() as unknown as { name: string }[]));
      router.openapi(routes.bank, (c) =>
        c.json(
          store.bank() as unknown as {
            character: string;
            account: string;
            prof: string;
            level: number;
            bank: string;
            silvers: number;
          }[],
        ),
      );
      router.openapi(routes.search, (c) => {
        const { q, character, location, filter } = c.req.valid("query");
        try {
          const rows = filter !== undefined ? store.searchFilter(filter) : store.search(q || "", character, location);
          return c.json(rows as unknown as Array<z.infer<typeof searchRowSchema>>);
        } catch (err) {
          if (err instanceof SearchSyntaxError) {
            return c.json({ error: err.message }, 400);
          }
          throw err;
        }
      });
      router.openapi(routes.resources, (c) =>
        c.json(store.resources() as unknown as Array<z.infer<typeof resourceRowSchema>>),
      );
      router.openapi(routes.tickets, (c) =>
        c.json(store.tickets() as unknown as Array<z.infer<typeof ticketRowSchema>>),
      );
      router.openapi(routes.lumnis, (c) => c.json(store.lumnis() as unknown as Array<z.infer<typeof lumnisRowSchema>>));
      router.openapi(routes.overview, (c) => c.json(store.overview() as unknown as z.infer<typeof overviewSchema>));
    },
  };
}
