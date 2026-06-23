import { Client } from "@elastic/elasticsearch";
import { config } from "./config.js";

let client: Client | null = null;

export function esClient(): Client {
  if (client) return client;
  client = new Client({
    node: config.es.url,
    auth:
      config.es.username && config.es.password
        ? { username: config.es.username, password: config.es.password }
        : undefined,
    requestTimeout: 600_000, // bulk-indexing embeds via ELSER in-cluster; keep generous
  });
  return client;
}

export const INDEX = config.es.index;
