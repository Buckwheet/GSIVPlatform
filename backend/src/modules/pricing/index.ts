import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Module } from "../../core/types.js";
import type { PricingScraper } from "./scraper.js";
import type { PricingStore } from "./store.js";

const saleRowSchema = z.object({
  id: z.number(),
  item_id: z.string(),
  name: z.string(),
  town: z.string(),
  shop: z.string(),
  cost: z.number().nullable(),
  enchant: z.number().nullable(),
  worn: z.string().nullable(),
  wear_location: z.string().nullable(),
  material: z.string().nullable(),
  item_type: z.string().nullable(),
  is_weapon: z.number(),
  is_armor: z.number(),
  is_jewelry: z.number(),
  enhancives: z.string(),
  removed_date: z.string(),
  scraped_at: z.string(),
});

const listingSchema = z.object({
  id: z.number(),
  gem_type: z.string(),
  count: z.number(),
  price_per_gem: z.number(),
  total_price: z.number(),
  character: z.string(),
  shop: z.string(),
  town: z.string().nullable(),
  listed_date: z.string(),
  removed_date: z.string().nullable(),
  days_on_market: z.number().nullable(),
  confirmed_sold: z.number(),
});

const statusRoute = createRoute({
  method: "get",
  path: "/status",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ last_scraped_at: z.string().nullable(), total_sales: z.number() }) },
      },
      description: "status",
    },
  },
});

const salesRoute = createRoute({
  method: "get",
  path: "/sales",
  request: {
    query: z.object({
      q: z.string().optional(),
      town: z.string().optional(),
      shop: z.string().optional(),
      min_cost: z.coerce.number().optional(),
      max_cost: z.coerce.number().optional(),
      min_enchant: z.coerce.number().optional(),
      enhancive: z.string().optional(),
      is_weapon: z.string().optional(),
      is_armor: z.string().optional(),
      is_jewelry: z.string().optional(),
      days: z.coerce.number().optional(),
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ total: z.number(), page: z.number(), limit: z.number(), sales: z.array(saleRowSchema) }),
        },
      },
      description: "sales search",
    },
  },
});

const gemTypesRoute = createRoute({
  method: "get",
  path: "/gems/types",
  responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "gem type summaries" } },
});

const gemSalesRoute = createRoute({
  method: "get",
  path: "/gems/sales",
  request: {
    query: z.object({
      gem_type: z.string().optional(),
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "gem sales" } },
});

const gemIntelligenceRoute = createRoute({
  method: "get",
  path: "/gems/intelligence",
  request: { query: z.object({ gem_type: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.any() } }, description: "gem intelligence" },
    400: { description: "gem_type required" },
  },
});

const priceRecRoute = createRoute({
  method: "get",
  path: "/gems/price-recommendation",
  request: { query: z.object({ gem_type: z.string(), count: z.coerce.number().optional() }) },
  responses: {
    200: { content: { "application/json": { schema: z.any() } }, description: "price recommendation" },
    400: { description: "gem_type required" },
  },
});

const createListingRoute = createRoute({
  method: "post",
  path: "/listings",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            gem_type: z.string(),
            count: z.number(),
            price_per_gem: z.number(),
            total_price: z.number(),
            character: z.string(),
            shop: z.string(),
            town: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { content: { "application/json": { schema: listingSchema } }, description: "created" },
    400: { description: "missing fields" },
  },
});

const getListingsRoute = createRoute({
  method: "get",
  path: "/listings",
  request: {
    query: z.object({
      shop: z.string().optional(),
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ listings: z.array(listingSchema), total: z.number() }) } },
      description: "listings",
    },
  },
});

const sellThroughRoute = createRoute({
  method: "get",
  path: "/listings/sell-through",
  request: { query: z.object({ shop: z.string() }) },
  responses: {
    200: { content: { "application/json": { schema: z.any() } }, description: "sell-through stats" },
    400: { description: "shop required" },
    404: { description: "no listings" },
  },
});

const townsRoute = createRoute({
  method: "get",
  path: "/towns",
  responses: { 200: { content: { "application/json": { schema: z.array(z.string()) } }, description: "towns" } },
});

const scrapeRoute = createRoute({
  method: "post",
  path: "/scrape",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ newItems: z.number(), skipped: z.number(), errors: z.number() }) },
      },
      description: "scrape result",
    },
  },
});

export function createPricingModule(store: PricingStore, scraper: PricingScraper): Module {
  return {
    name: "pricing",
    prefix: "/api/modules/pricing",
    scopes: [
      { name: "pricing.read", description: "Read sales, gem intelligence, listings" },
      { name: "pricing.write", description: "Create listings" },
      { name: "pricing.scrape", description: "Trigger the removed-items scraper" },
    ],
    routeScopes: {
      "GET /status": ["pricing.read"],
      "GET /sales": ["pricing.read"],
      "GET /gems/types": ["pricing.read"],
      "GET /gems/sales": ["pricing.read"],
      "GET /gems/intelligence": ["pricing.read"],
      "GET /gems/price-recommendation": ["pricing.read"],
      "GET /listings": ["pricing.read"],
      "GET /listings/sell-through": ["pricing.read"],
      "GET /towns": ["pricing.read"],
      "POST /listings": ["pricing.write"],
      "POST /scrape": ["pricing.scrape"],
    },
    registerRoutes(router: OpenAPIHono, _deps: unknown): void {
      router.openapi(statusRoute, (c) => c.json(store.status()));
      router.openapi(salesRoute, (c) => {
        const q = c.req.valid("query");
        const result = store.searchSales({
          q: q.q,
          town: q.town,
          shop: q.shop,
          min_cost: q.min_cost,
          max_cost: q.max_cost,
          min_enchant: q.min_enchant,
          enhancive: q.enhancive,
          is_weapon: q.is_weapon === "1",
          is_armor: q.is_armor === "1",
          is_jewelry: q.is_jewelry === "1",
          days: q.days,
          page: q.page,
          limit: q.limit,
        });
        return c.json(
          result as unknown as {
            total: number;
            page: number;
            limit: number;
            sales: Array<z.infer<typeof saleRowSchema>>;
          },
        );
      });
      router.openapi(gemTypesRoute, (c) => c.json(store.gemTypes()));
      router.openapi(gemSalesRoute, (c) => {
        const q = c.req.valid("query");
        const limit = q.limit ?? 100;
        const offset = ((q.page ?? 1) - 1) * limit;
        return c.json(store.gemSales(q.gem_type, limit, offset));
      });
      router.openapi(gemIntelligenceRoute, (c) => {
        const { gem_type } = c.req.valid("query");
        if (!gem_type) return c.json({ error: "gem_type required" }, 400);
        return c.json(store.gemIntelligence(gem_type));
      });
      router.openapi(priceRecRoute, (c) => {
        const { gem_type, count } = c.req.valid("query");
        if (!gem_type) return c.json({ error: "gem_type required" }, 400);
        return c.json(store.priceRecommendation(gem_type, Math.max(1, count ?? 10)));
      });
      router.openapi(createListingRoute, (c) => {
        const body = c.req.valid("json");
        if (
          !body.gem_type ||
          !body.count ||
          !body.price_per_gem ||
          !body.total_price ||
          !body.character ||
          !body.shop
        ) {
          return c.json({ error: "missing required fields" }, 400);
        }
        return c.json(store.createListing(body), 201);
      });
      router.openapi(getListingsRoute, (c) => {
        const q = c.req.valid("query");
        const limit = q.limit ?? 100;
        const offset = ((q.page ?? 1) - 1) * limit;
        return c.json(store.getListings(q.shop, limit, offset));
      });
      router.openapi(sellThroughRoute, (c) => {
        const { shop } = c.req.valid("query");
        if (!shop) return c.json({ error: "shop required" }, 400);
        const stats = store.sellThroughStats(shop);
        if (!stats) return c.json({ error: "no listings found" }, 404);
        return c.json(stats);
      });
      router.openapi(townsRoute, (c) => c.json(store.towns()));
      router.openapi(scrapeRoute, async (c) => c.json(await scraper.scrapeRemoved()));
    },
  };
}
