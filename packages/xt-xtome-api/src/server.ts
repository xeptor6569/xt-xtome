import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { HttpError } from "./http.js";
import { registerRoutes, type RouteDeps } from "./routes.js";

export async function buildServer(deps: RouteDeps & { webDist: string | null }): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
  await app.register(multipart, {
    limits: { fileSize: 256 * 1024 * 1024, files: 1 },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({ error: error.message });
      return;
    }
    const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 500;
    const message = statusCode >= 500 ? "Request failed." : error instanceof Error ? error.message : "Request failed.";
    if (statusCode >= 500) {
      app.log.error(error);
    }
    reply.code(Number.isInteger(statusCode) ? statusCode : 500).send({ error: message });
  });
  registerRoutes(app, deps);

  if (deps.webDist && existsSync(deps.webDist)) {
    await app.register(fastifyStatic, {
      root: path.resolve(deps.webDist),
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        reply.code(404).send({ error: "Not found." });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}
