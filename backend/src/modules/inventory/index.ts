import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { InventoryStore } from "./store.js";

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
  prof: z.string(),
  level: z.number(),
  location: z.string(),
  item: z.string(),
  noun: z.string(),
  type: z.string(),
  amount: z.number(),
  stack: z.string(),
  status: z.string(),
  marked: z.string(),
  worn: z.string(),
});

const resourceRowSchema = z.object({
  character: z.string(),
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
  prof: z.string(),
  level: z.number(),
  source: z.string(),
  amount: z.number(),
  currency: z.string(),
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
            schema: z.array(z.object({ character: z.string(), bank: z.string(), silvers: z.number() })),
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
      }),
    },
    responses: {
      200: { content: { "application/json": { schema: z.array(searchRowSchema) } }, description: "Search results" },
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
};

export function createInventoryModule(store: InventoryStore): Module {
  return {
    name: "inventory",
    prefix: "/api/modules/inventory",
    scopes: [{ name: "inventory.read", description: "Read character inventory, bank, resources, tickets" }],
    routeScopes: {
      "GET /summary": ["inventory.read"],
      "GET /characters": ["inventory.read"],
      "GET /locations": ["inventory.read"],
      "GET /bank": ["inventory.read"],
      "GET /search": ["inventory.read"],
      "GET /resources": ["inventory.read"],
      "GET /tickets": ["inventory.read"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(routes.summary, (c) => c.json(store.summary()));
      router.openapi(routes.characters, (c) =>
        c.json(store.characters() as unknown as Array<z.infer<typeof charSchema>>),
      );
      router.openapi(routes.locations, (c) => c.json(store.locations() as unknown as { name: string }[]));
      router.openapi(routes.bank, (c) =>
        c.json(store.bank() as unknown as { character: string; bank: string; silvers: number }[]),
      );
      router.openapi(routes.search, (c) => {
        const { q, character, location } = c.req.valid("query");
        return c.json(store.search(q || "", character, location) as unknown as Array<z.infer<typeof searchRowSchema>>);
      });
      router.openapi(routes.resources, (c) =>
        c.json(store.resources() as unknown as Array<z.infer<typeof resourceRowSchema>>),
      );
      router.openapi(routes.tickets, (c) =>
        c.json(store.tickets() as unknown as Array<z.infer<typeof ticketRowSchema>>),
      );
    },
  };
}
